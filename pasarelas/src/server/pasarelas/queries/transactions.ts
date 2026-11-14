import "server-only";
import { PostgrestError } from "@supabase/supabase-js";
import { ZERO, dec, isISODate, parseMoney, periodRange, toMoney } from "@/lib/pasarelas";
import type {
  Currency,
  DisplayStatus,
  ISODate,
  LeanTx,
  Money,
  PayConfig,
  PeriodPreset,
  TxSnapshot,
} from "@/lib/pasarelas";
import {
  ALLOCATION_COLUMNS,
  EVENT_COLUMNS,
  LEAN_TX_COLUMNS,
  RECEIPT_COLUMNS,
  TX_COLUMNS,
  TX_LIST_COLUMNS,
  toLeanTx,
  toTxDetail,
  toTxListItem,
  toTxSnapshot,
  type Db,
  type TxDetail,
  type TxListItem,
} from "../dto";
import { zCurrency, zId } from "../zod";
import { loadPayConfig } from "./config";
import { EXACT_COUNT, readAll } from "./paging";

/**
 * Las lecturas de cobros. La lista (`listTx`, de 50 en 50) y los totales (`leanTx`, todas las filas del filtro)
 * pasan por el mismo `applyTxFilters`: cada filtro tiene una sola definición.
 */

export type TxFilters = {
  /** Fecha del cobro (en Nueva York), ambas incluidas. */
  from?: ISODate;
  to?: ISODate;
  companyId?: string;
  channelId?: string;
  gatewayId?: string;
  bankAccountId?: string;
  currency?: Currency;
  status?: DisplayStatus | "por_caer" | "atrasado";
  receipt?: "con" | "sin";
  estimatedOn?: ISODate;
  /** Lo que la persona escribió en la búsqueda. Se limpia al aplicarlo. */
  q?: string;
  /** `true` = SOLO la papelera. Por defecto la papelera no aparece. */
  trashed?: boolean;
};

export type TxSort = "fecha_desc" | "fecha_asc" | "monto_desc" | "monto_asc" | "estimada_asc";

const LIST_PAGE_SIZE = 50;
/** El tope de filas por petición de la API. */
const LEAN_PAGE_SIZE = 1000;
/** Cuántos ids caben holgados en la URL de una petición (un uuid son 36 caracteres). */
const ID_CHUNK_SIZE = 100;
const MAX_SEARCH_LENGTH = 80;

// ─── De la URL a los filtros ────────────────────────────────────────────────────────────────────────────────

// Los valores que admite cada parámetro de lista cerrada. Como `Record`, el compilador exige que estén todos.
const PERIODS: Record<PeriodPreset, true> = {
  este_mes: true,
  mes_anterior: true,
  "30d": true,
  "90d": true,
  "365d": true,
  este_anio: true,
  personalizado: true,
};
const STATUSES: Record<NonNullable<TxFilters["status"]>, true> = {
  fallido: true,
  en_disputa: true,
  reembolsado: true,
  depositado: true,
  en_transito: true,
  registrado: true,
  por_caer: true,
  atrasado: true,
};
const RECEIPTS: Record<NonNullable<TxFilters["receipt"]>, true> = { con: true, sin: true };
const SORTS: Record<TxSort, true> = {
  fecha_desc: true,
  fecha_asc: true,
  monto_desc: true,
  monto_asc: true,
  estimada_asc: true,
};

/** Una página de la lista: un entero desde 1, sin ceros delante y de 6 cifras como mucho. */
const PAGE = /^[1-9]\d{0,5}$/;

/**
 * Lo que queda de una búsqueda para compararla con textos: letras, dígitos, espacio y `-_.@#/:` (lo demás rompería
 * el filtro de PostgREST o haría de comodín), con los espacios juntados y 80 caracteres como mucho.
 */
export function cleanSearch(q: string): string {
  return q
    .replace(/[^\p{L}\p{N}\s\-_.@#/:]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_LENGTH)
    .trim();
}

/**
 * Los filtros, el orden y la página que pide la URL de una lista de cobros (los parámetros del kit: `periodo`,
 * `desde`, `hasta`, `empresa`, `canal`, `pasarela`, `cuenta`, `moneda`, `estado`, `comprobante`, `estimada`, `q`,
 * `orden`, `pagina`). Todo valor es entrada no confiable: lo que no se entiende se ignora, nunca lanza.
 *
 * Sin `periodo` rige «este mes»; `desde` y `hasta` solo cuentan con `periodo=personalizado`. La papelera no se
 * pide por la URL: la pone la pantalla que la muestra.
 */
export function parseTxFilters(
  sp: Record<string, string | string[] | undefined>,
  today: ISODate,
): { filters: TxFilters; sort: TxSort; page: number } {
  // Un parámetro repetido llega como lista: vale el primero.
  const text = (key: string): string | undefined => {
    const value = sp[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const oneOf = <T extends string>(values: Record<T, true>, key: string): T | undefined => {
    const value = text(key);
    return value !== undefined && Object.hasOwn(values, value) ? (value as T) : undefined;
  };
  const date = (key: string): ISODate | undefined => {
    const value = text(key);
    return isISODate(value) ? value : undefined;
  };
  const id = (key: string): string | undefined => zId.safeParse(text(key)).data;

  const period = periodRange(oneOf(PERIODS, "periodo") ?? "este_mes", today, {
    from: date("desde"),
    to: date("hasta"),
  });
  const q = (text("q") ?? "").trim().slice(0, MAX_SEARCH_LENGTH).trim();
  const filters: TxFilters = {
    from: period.from,
    to: period.to,
    companyId: id("empresa"),
    channelId: id("canal"),
    gatewayId: id("pasarela"),
    bankAccountId: id("cuenta"),
    currency: zCurrency.safeParse(text("moneda")).data,
    status: oneOf(STATUSES, "estado"),
    receipt: oneOf(RECEIPTS, "comprobante"),
    estimatedOn: date("estimada"),
    // Si no queda nada que buscar (solo signos), no es un filtro.
    q: cleanSearch(q) === "" && parseMoney(q) === null ? undefined : q,
  };
  const page = text("pagina") ?? "";
  return {
    // Solo los filtros que vienen: sin claves vacías.
    filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined)),
    sort: oneOf(SORTS, "orden") ?? "fecha_desc",
    page: PAGE.test(page) ? Number(page) : 1,
  };
}

// ─── Los filtros, una sola vez ──────────────────────────────────────────────────────────────────────────────

/** Lo que `applyTxFilters` usa del constructor de consultas de PostgREST sobre `pay_transactions`. */
type TxFilterBuilder<Q> = {
  eq(column: string, value: string | number): Q;
  neq(column: string, value: string): Q;
  gt(column: string, value: string | number): Q;
  gte(column: string, value: string): Q;
  lt(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  is(column: string, value: null): Q;
  not(column: string, operator: string, value: null): Q;
  in(column: string, values: readonly string[]): Q;
  or(filters: string): Q;
};

/** «La disputa no está abierta». La columna puede ser nula, y un nulo no pasa un `neq`. */
const NOT_DISPUTED = "dispute_state.is.null,dispute_state.neq.abierta";
const PENDING = ["registrado", "en_transito"] as const;

/**
 * `isPending` del motor, en columnas: se ve como registrado o en tránsito. Es decir, está en uno de esos dos pasos
 * del ciclo del dinero, la disputa no está abierta y no se reembolsó del todo (le queda bruto vigente).
 */
function pendingOnly<Q extends TxFilterBuilder<Q>>(query: Q): Q {
  return query.in("status", PENDING).or(NOT_DISPUTED).gt("gross_amount", ZERO);
}

/**
 * El estado visible, traducido a columnas en el mismo orden que `displayStatus` del motor. «Por caer» y «atrasado»
 * no son estados visibles, pero salen de ellos: por caer es lo que se ve como registrado o en tránsito (`isPending`
 * del motor) y atrasado es eso mismo con la fecha estimada anterior a `today` (`isOverdue`). Así el filtro «por
 * caer» trae justo los cobros que suma la tarjeta «Por caer».
 */
function applyStatus<Q extends TxFilterBuilder<Q>>(query: Q, status: TxFilters["status"], today: ISODate): Q {
  switch (status) {
    case undefined:
      return query;
    case "fallido":
      return query.eq("status", "fallido");
    case "en_disputa":
      return query.neq("status", "fallido").eq("dispute_state", "abierta");
    case "reembolsado":
      // Reembolso total: sin fallar, el bruto vigente (lo cobrado menos lo reembolsado) queda en cero.
      return query.neq("status", "fallido").or(NOT_DISPUTED).eq("gross_amount", ZERO);
    case "depositado":
    case "en_transito":
    case "registrado":
      return query.eq("status", status).or(NOT_DISPUTED).gt("gross_amount", ZERO);
    case "por_caer":
      return pendingOnly(query);
    case "atrasado":
      // Un cobro sin fecha estimada (nula) no pasa la comparación: no está atrasado.
      return pendingOnly(query).lt("estimated_deposit_on", today);
  }
}

/**
 * La búsqueda como condiciones de PostgREST unidas por «o»: el texto limpio dentro de la referencia o de la nota
 * (sin distinguir mayúsculas), los cobros de las empresas, canales y pasarelas cuyo nombre lo contiene y, si lo
 * escrito es un monto, los de ese bruto original. `null` si no queda nada que buscar.
 */
function searchConditions(q: string, cfg: PayConfig | undefined): string | null {
  const text = cleanSearch(q);
  const conditions: string[] = [];
  if (text !== "") {
    // Entre comillas, los signos admitidos van tal cual; el guion bajo se escapa para que no haga de comodín.
    const pattern = `"*${text.replaceAll("_", "\\\\_")}*"`;
    conditions.push(`reference.ilike.${pattern}`, `note.ilike.${pattern}`);
    const needle = text.toLowerCase();
    const named = (items: readonly { id: string; name: string }[]): string[] =>
      items.filter((item) => item.name.toLowerCase().includes(needle)).map((item) => item.id);
    const byName = [
      ["company_id", named(cfg?.companies ?? [])],
      ["channel_id", named(cfg?.channels ?? [])],
      ["gateway_id", named(cfg?.gateways ?? [])],
    ] as const;
    for (const [column, ids] of byName) if (ids.length > 0) conditions.push(`${column}.in.(${ids.join(",")})`);
  }
  // El monto se lee de lo escrito, antes de limpiarlo: «1.234,56» lleva una coma.
  const amount = parseMoney(q);
  if (amount !== null) conditions.push(`gross_original.eq.${amount}`);
  return conditions.length === 0 ? null : conditions.join(",");
}

/**
 * Aplica los filtros a una consulta sobre `pay_transactions`. Es el único lugar donde se definen: lo usan la
 * lista y los totales. Por defecto deja fuera la papelera. `today` es el día respecto del cual algo está
 * «atrasado»; `cfg` son los nombres para la búsqueda (sin ella, `q` solo mira referencia, nota y monto).
 */
export function applyTxFilters<Q extends TxFilterBuilder<Q>>(
  query: Q,
  filters: TxFilters,
  today: ISODate,
  cfg?: PayConfig,
): Q {
  let q = filters.trashed ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (filters.from !== undefined) q = q.gte("occurred_on", filters.from);
  if (filters.to !== undefined) q = q.lte("occurred_on", filters.to);
  if (filters.companyId !== undefined) q = q.eq("company_id", filters.companyId);
  if (filters.channelId !== undefined) q = q.eq("channel_id", filters.channelId);
  if (filters.gatewayId !== undefined) q = q.eq("gateway_id", filters.gatewayId);
  if (filters.bankAccountId !== undefined) q = q.eq("bank_account_id", filters.bankAccountId);
  if (filters.currency !== undefined) q = q.eq("currency", filters.currency);
  q = applyStatus(q, filters.status, today);
  if (filters.receipt === "con") q = q.gt("receipts_count", 0);
  if (filters.receipt === "sin") q = q.eq("receipts_count", 0);
  if (filters.estimatedOn !== undefined) q = q.eq("estimated_deposit_on", filters.estimatedOn);
  const search = filters.q === undefined ? null : searchConditions(filters.q, cfg);
  return search === null ? q : q.or(search);
}

/** La configuración para resolver los nombres de la búsqueda: la que llega o, si hace falta, recién leída. */
async function searchConfig(
  supabase: Db,
  filters: TxFilters,
  cfg: PayConfig | undefined,
): Promise<PayConfig | undefined> {
  if (cfg !== undefined || filters.q === undefined || cleanSearch(filters.q) === "") return cfg;
  return loadPayConfig(supabase);
}

/** PostgREST responde así cuando se le pide un tramo que empieza después de la última fila. */
const isPastTheEnd = (error: { code: string } | null): boolean => error?.code === "PGRST103";

/**
 * Cuántas filas dice la API que tiene el filtro. Si la respuesta llega sin ese total no se puede saber si se leyeron
 * todas: se lanza, en vez de dar por completa una lectura que pudo cortarse en la primera página.
 */
function totalOf(count: number | null): number {
  if (count === null) {
    throw new Error("La lectura de pay_transactions llegó sin el total de filas (count): no se sabe si están todas.");
  }
  return count;
}

// ─── Lista y totales ────────────────────────────────────────────────────────────────────────────────────────

/** La columna de cada orden. Todos desempatan por `id` en el mismo sentido: el orden es estable entre páginas. */
const ORDER: Record<TxSort, { column: string; ascending: boolean }> = {
  fecha_desc: { column: "occurred_at", ascending: false },
  fecha_asc: { column: "occurred_at", ascending: true },
  monto_desc: { column: "gross_original", ascending: false },
  monto_asc: { column: "gross_original", ascending: true },
  estimada_asc: { column: "estimated_deposit_on", ascending: true },
};

/**
 * Una página (de 50) de los cobros del filtro, y cuántos tiene el filtro en total. Los cobros sin fecha estimada
 * van al final al ordenar por ella. Una página más allá de la última viene vacía, con su total.
 * `cfg`: la configuración ya cargada, para la búsqueda; si no llega y hay búsqueda, se lee.
 */
export async function listTx(
  supabase: Db,
  f: TxFilters,
  sort: TxSort,
  page: number,
  today: ISODate,
  pageSize: number = LIST_PAGE_SIZE,
  cfg?: PayConfig,
): Promise<{ rows: TxListItem[]; total: number }> {
  const names = await searchConfig(supabase, f, cfg);
  const { column, ascending } = ORDER[sort];
  const start = (page - 1) * pageSize;
  const { data, count, error } = await applyTxFilters(
    supabase.from("pay_transactions").select(TX_LIST_COLUMNS, { count: "exact" }),
    f,
    today,
    names,
  )
    .order(column, { ascending, nullsFirst: false })
    .order("id", { ascending })
    .range(start, start + pageSize - 1);
  if (isPastTheEnd(error)) {
    const counted = await applyTxFilters(
      supabase.from("pay_transactions").select("id", { count: "exact", head: true }),
      f,
      today,
      names,
    ).throwOnError();
    return { rows: [], total: totalOf(counted.count) };
  }
  if (error) throw new PostgrestError(error);
  return { rows: data.map(toTxListItem), total: totalOf(count) };
}

/**
 * TODOS los cobros del filtro, como filas mínimas para sumar (del más reciente al más antiguo). La API da 1000
 * filas por petición como mucho: se pide por páginas hasta tener las que el filtro dice que hay.
 * `cfg`: la configuración ya cargada, para la búsqueda; si no llega y hay búsqueda, se lee.
 */
export async function leanTx(supabase: Db, f: TxFilters, today: ISODate, cfg?: PayConfig): Promise<LeanTx[]> {
  const names = await searchConfig(supabase, f, cfg);
  const rows: LeanTx[] = [];
  for (;;) {
    const { data, count, error } = await applyTxFilters(
      supabase.from("pay_transactions").select(LEAN_TX_COLUMNS, { count: "exact" }),
      f,
      today,
      names,
    )
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(rows.length, rows.length + LEAN_PAGE_SIZE - 1);
    // Si entre una página y otra se borraron cobros, la siguiente puede empezar después del final: ya están todos.
    if (isPastTheEnd(error)) return rows;
    if (error) throw new PostgrestError(error);
    const total = totalOf(count);
    rows.push(...data.map(toLeanTx));
    if (data.length === 0 || rows.length >= total) return rows;
  }
}

// ─── Un cobro ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * El cobro con su reparto, sus comprobantes y su historial (del evento más reciente al más antiguo); también si
 * está en la papelera. `null` si no existe, si es de otro usuario o si el id no es un uuid.
 */
export async function getTx(supabase: Db, id: string): Promise<TxDetail | null> {
  const txId = zId.safeParse(id).data;
  if (txId === undefined) return null;
  const [tx, allocations, receipts, events] = await Promise.all([
    supabase.from("pay_transactions").select(TX_COLUMNS).eq("id", txId).maybeSingle().throwOnError(),
    supabase.from("pay_allocations").select(ALLOCATION_COLUMNS).eq("transaction_id", txId).throwOnError(),
    supabase
      .from("pay_transaction_receipts")
      .select(RECEIPT_COLUMNS)
      .eq("transaction_id", txId)
      .order("created_at")
      .order("id")
      .throwOnError(),
    supabase
      .from("pay_transaction_events")
      .select(EVENT_COLUMNS)
      .eq("transaction_id", txId)
      .order("at", { ascending: false })
      .order("id")
      .throwOnError(),
  ]);
  return tx.data === null ? null : toTxDetail(tx.data, allocations.data, receipts.data, events.data);
}

/** La lista partida en tramos de `size` elementos. */
export function chunked<T>(items: readonly T[], size: number = ID_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size));
  return chunks;
}

/**
 * Los cobros completos de esos ids (también los de la papelera), en el orden pedido y sin repetir. Los que no
 * existen, o no son del usuario, no vienen.
 */
export async function getSnapshots(supabase: Db, ids: string[]): Promise<TxSnapshot[]> {
  const wanted = [...new Set(ids)];
  // Por tramos: cientos de ids no caben en la URL de una sola petición.
  const pages = await Promise.all(
    chunked(wanted).map((chunk) => supabase.from("pay_transactions").select(TX_COLUMNS).in("id", chunk).throwOnError()),
  );
  const found = new Map(pages.flatMap((page) => page.data).map((row) => [row.id, row]));
  return wanted.flatMap((id) => {
    const row = found.get(id);
    return row === undefined ? [] : [toTxSnapshot(row)];
  });
}

/** El último cobro que se registró y no está en la papelera (para «Repetir el último»), o `null` si no hay. */
export async function lastTx(supabase: Db): Promise<TxSnapshot | null> {
  const { data } = await supabase
    .from("pay_transactions")
    .select(TX_COLUMNS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle()
    .throwOnError();
  return data === null ? null : toTxSnapshot(data);
}

/** Lo que le cayó a una persona de lo retenido en un cobro. */
export type RetentionShare = { beneficiaryId: string; amount: Money };

/**
 * Lo que le cayó a cada persona de lo retenido en esos cobros (`pay_retention_shares`), por cobro. Los ids van por
 * tramos (no caben en la URL) y cada tramo se lee entero (`readAll`). Un cobro sin retención no está en el mapa.
 */
export async function listRetentionShares(
  supabase: Db,
  txIds: readonly string[],
): Promise<Map<string, RetentionShare[]>> {
  const pages = await Promise.all(
    chunked([...new Set(txIds)]).map((ids) =>
      readAll(
        (from, to) =>
          supabase
            .from("pay_retention_shares")
            .select("transaction_id, beneficiary_id, amount::text", EXACT_COUNT)
            .in("transaction_id", ids)
            .order("id")
            .range(from, to)
            .throwOnError(),
        "de lo retenido",
      ),
    ),
  );
  const byTx = new Map<string, RetentionShare[]>();
  for (const row of pages.flat()) {
    const share = { beneficiaryId: row.beneficiary_id, amount: toMoney(dec(row.amount)) };
    byTx.set(row.transaction_id, [...(byTx.get(row.transaction_id) ?? []), share]);
  }
  return byTx;
}
