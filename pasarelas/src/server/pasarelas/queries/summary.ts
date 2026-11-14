import "server-only";
import { hrefWith } from "@/components/ui/url";
import {
  RECENT_DEPOSIT_DAYS,
  ZERO,
  add,
  addDays,
  sub,
  dec,
  isZero,
  monthKey,
  monthLabel,
  moneyInTransit,
  summarize,
  toMoney,
  transitCurrencies,
  transitLabel,
  transitPhase,
} from "@/lib/pasarelas";
import type {
  Currency,
  CurrencySummary,
  DepositGroup,
  ISODate,
  InTransit,
  LeanTx,
  Money,
  PayConfig,
  RetainedRow,
  TransitItem,
  TransitPhase,
  TransitRows,
} from "@/lib/pasarelas";
import { LEAN_TX_COLUMNS, toLeanTx, type Db } from "../dto";
import { SAVE_BATCH_SIZE } from "../tx-save";
import { EXACT_COUNT, readAll as readAllRows, type PageRead } from "./paging";
import { chunked, leanTx, parseTxFilters, type TxFilters } from "./transactions";

/**
 * Lo que pinta el Resumen (`/pasarelas`). Arriba, «Dinero en camino»: lo que está por caer ahora mismo, sin
 * importar el período ni los filtros (`moneyInTransit` del motor). Los totales del período salen del motor
 * (`summarize`) sobre TODAS las filas del filtro (`leanTx`, con el mismo constructor de filtros que la lista de
 * cobros); los repartos, de lo asignado a los cobros del período, de lo liquidado en el período y del saldo de toda
 * la historia (vista `pay_beneficiary_balances`). Todo se entrega en UNA moneda: nunca un total mezclado.
 */

const TX_LIST = "/pasarelas/cobros";

/** Los días que una pasarela puede retener como mucho (`pay_gateways_retention_days_check`). */
const MAX_RETENTION_DAYS = 365;

/** Las claves de la URL que el Resumen filtra, en el orden en que pasan a los enlaces de la lista de cobros. */
const SCOPE_KEYS = ["periodo", "desde", "hasta", "empresa", "canal", "pasarela"] as const;

type SearchParams = Record<string, string | string[] | undefined>;

/** Lo asignado o lo liquidado a un beneficiario en una moneda. */
export type BeneficiaryAmount = { beneficiaryId: string; currency: Currency; amount: Money };

/** Una fila de `pay_beneficiary_balances`: toda la historia (sin papelera ni fallidos). */
export type BeneficiaryBalance = {
  beneficiaryId: string;
  currency: Currency;
  assigned: Money;
  settled: Money;
  balance: Money;
};

/** Un beneficiario en la moneda del Resumen: asignado y liquidado en el período; saldo de toda la historia. */
export type SplitRow = { beneficiaryId: string; assigned: Money; settled: Money; balance: Money };

/**
 * Un mes del período (`AAAA-MM`), con su texto (`nov 2026`). Los meses sin cobros van en cero. `fees` son las
 * comisiones del negocio y `buyerFees`, las que pagaron los compradores: `gross − fees − buyerFees = net`.
 */
export type MonthRow = {
  month: string;
  label: string;
  gross: Money;
  fees: Money;
  buyerFees: Money;
  net: Money;
  count: number;
};

/** Cuántos cobros y el enlace a la lista de cobros que muestra exactamente esos. */
export type Notice = { count: number; href: string };

export type SummaryNotices = {
  /** Cobros del período (en cualquier moneda) sin comprobante. */
  withoutReceipt: Notice | null;
  /** Por caer con la fecha estimada ya pasada, de toda la historia. */
  overdue: Notice | null;
  /** Con la disputa abierta, de toda la historia. */
  disputes: Notice | null;
  /** Empresas activas sin esquema de reparto por defecto activo (`companiesWithoutScheme`). */
  companiesWithoutScheme: { id: string; name: string; schemeInactive: boolean }[];
  /** El año en curso y el siguiente, si no tienen ningún feriado cargado. */
  yearsWithoutHolidays: number[];
};

/** Un cobro de «Dinero en camino»: la fila mínima y su referencia, para nombrarlo en la lista. */
export type TransitTx = LeanTx & { reference: string | null };

/**
 * Un grupo por fecha y cuenta para marcar depositado (o una de sus partes), con sus cobros uno por uno y su propia
 * fase: la de su ventana, de la más temprana de sus cobros (`from`) a su fecha (`date`).
 */
export type TransitGroup = DepositPart & { phase: TransitPhase; label: string; items: TransitItem<TransitTx>[] };

/**
 * «Dinero en camino» en una moneda, listo para pintar: lo del motor, con los grupos ya partidos en lotes que se
 * marcan depositado de una vez y cada uno con sus cobros, y los enlaces de las tarjetas que tienen filtro en la
 * lista de cobros («atrasado» y «por caer»; `null` si no hay ningún cobro).
 */
export type TransitView = Omit<InTransit<TransitTx>, "items" | "soon" | "later"> & {
  soon: TransitGroup[];
  later: TransitGroup[];
  links: { overdue: string | null; total: string | null };
};

export type SummaryView = {
  period: { from: ISODate; to: ISODate };
  /** Todas las monedas que aparecen en algo de la pantalla, en orden alfabético. */
  currencies: Currency[];
  /** La moneda en que se pinta todo; `null` si no hay nada que pintar. */
  currency: Currency | null;
  /** La que rige sin `moneda` en la URL: la de más cobros en el período (ver `chooseCurrency`). */
  defaultCurrency: Currency | null;
  /** Las monedas con cobros en el período, en orden alfabético. */
  periodCurrencies: Currency[];
  /** El resumen del período en `currency`; `null` si no hubo cobros que cuenten. */
  summary: CurrencySummary | null;
  months: MonthRow[];
  /** «Dinero en camino» en `currency`, sin importar el período ni los filtros; `null` sin moneda. */
  transit: TransitView | null;
  splits: SplitRow[];
  notices: SummaryNotices;
  links: { pending: string };
};

// ─── De la URL al alcance ───────────────────────────────────────────────────────────────────────────────────

/**
 * Lo que filtra el Resumen: período, empresa, canal y pasarela (con `parseTxFilters`, la misma lectura que la
 * lista de cobros), y la moneda pedida. Lo demás que traiga la URL (estado, cuenta, búsqueda…) no cuenta aquí.
 * `query` son esas claves tal como llegaron, para que un enlace a la lista vea exactamente los mismos cobros.
 */
export function summaryScope(
  sp: SearchParams,
  today: ISODate,
): { filters: TxFilters; requestedCurrency: Currency | undefined; query: URLSearchParams } {
  const { filters } = parseTxFilters(sp, today);
  const { from, to, companyId, channelId, gatewayId, currency } = filters;
  const scoped: TxFilters = Object.fromEntries(
    Object.entries({ from, to, companyId, channelId, gatewayId }).filter(([, value]) => value !== undefined),
  );
  const query = new URLSearchParams();
  for (const key of SCOPE_KEYS) {
    const value = sp[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && first !== "") query.set(key, first);
  }
  return { filters: scoped, requestedCurrency: currency, query };
}

// ─── Piezas puras ───────────────────────────────────────────────────────────────────────────────────────────

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * La moneda en que se pinta el Resumen. Las disponibles son las del período y las de `others` (depósitos,
 * repartos). Por defecto, la de más cobros en el período (no la de más bruto: montos de monedas distintas no se
 * comparan); a igual número de cobros, la de más empresas (`companyCurrencies`: la moneda de cada empresa activa),
 * y luego la primera por orden alfabético. Sin cobros en el período, la misma regla entre las disponibles. La
 * pedida rige solo si está disponible.
 */
export function chooseCurrency(
  byCurrency: Record<Currency, CurrencySummary>,
  others: readonly Currency[],
  requested: Currency | undefined,
  companyCurrencies: readonly Currency[],
): { currencies: Currency[]; currency: Currency | null; defaultCurrency: Currency | null } {
  const currencies = [...new Set([...Object.keys(byCurrency), ...others])].sort(byText);
  const txCount = (currency: Currency): number => byCurrency[currency]?.totals.count ?? 0;
  const companies = (currency: Currency): number => companyCurrencies.filter((used) => used === currency).length;
  const [defaultCurrency = null] = [...currencies].sort(
    (a, b) => txCount(b) - txCount(a) || companies(b) - companies(a) || byText(a, b),
  );
  const currency = requested !== undefined && currencies.includes(requested) ? requested : defaultCurrency;
  return { currencies, currency, defaultCurrency };
}

/**
 * Las empresas activas cuyos cobros nuevos no se reparten solos: sin esquema por defecto, o con uno desactivado (o
 * que ya no existe), que no se ofrece al registrar. `schemeInactive`: tienen uno, pero no está activo.
 */
export function companiesWithoutScheme(
  cfg: Pick<PayConfig, "companies" | "schemes">,
): { id: string; name: string; schemeInactive: boolean }[] {
  const active = new Set(cfg.schemes.filter((scheme) => scheme.active).map((scheme) => scheme.id));
  return cfg.companies
    .filter((company) => company.active && (company.defaultSchemeId === null || !active.has(company.defaultSchemeId)))
    .map(({ id, name, defaultSchemeId }) => ({ id, name, schemeInactive: defaultSchemeId !== null }));
}

/** Un grupo para marcar depositado; `part` dice cuál de sus partes es, si no cabe en un solo lote. */
export type DepositPart = DepositGroup & { part: { index: number; of: number } | null };

/**
 * Los grupos para marcar depositado, con los de más de `size` cobros (lo más que se marca depositado de una vez)
 * partidos en partes de `size` como mucho, cada una con su neto, lo que llega al banco y desde cuándo pueden caer
 * sus cobros (la más temprana de sus ventanas). `rows`: los cobros de esos grupos.
 */
export function depositParts(
  groups: readonly DepositGroup[],
  rows: readonly LeanTx[],
  size: number = SAVE_BATCH_SIZE,
): DepositPart[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return groups.flatMap((group): DepositPart[] => {
    if (group.ids.length <= size) return [{ ...group, part: null }];
    const parts = chunked(group.ids, size);
    return parts.map((ids, index) => ({
      ...group,
      // Las fechas AAAA-MM-DD se ordenan como texto: la menor es la más temprana.
      from: ids.map((id) => byId.get(id)?.estimatedDepositFrom ?? group.date).sort()[0] ?? group.date,
      ids,
      count: ids.length,
      net: add(...ids.map((id) => byId.get(id)?.net ?? ZERO)),
      payout: add(
        ...ids.map((id) => {
          const row = byId.get(id);
          return row === undefined ? ZERO : sub(row.net, row.retention);
        }),
      ),
      part: { index: index + 1, of: parts.length },
    }));
  });
}

/**
 * «Dinero en camino» listo para pintar: cada grupo partido en lotes (`depositParts`), cada lote con su fase y sus
 * cobros en el orden del motor, y los enlaces a la lista con exactamente los cobros de «Ya debió llegar» y del
 * total (el período justo de esos cobros, en la moneda; sin los filtros del Resumen, que aquí no rigen).
 */
export function transitView(
  transit: InTransit<TransitTx>,
  currency: Currency,
  today: ISODate,
  size: number = SAVE_BATCH_SIZE,
): TransitView {
  const { items, soon, later, ...figures } = transit;
  const byId = new Map(items.map((item) => [item.tx.id, item]));
  const withItems = (groups: readonly DepositGroup[]): TransitGroup[] =>
    depositParts(
      groups,
      items.map((item) => item.tx),
      size,
    ).map((part) => {
      const window = { from: part.from, to: part.date };
      return {
        ...part,
        phase: transitPhase(window, today),
        label: transitLabel(window, today),
        items: part.ids.flatMap((id) => byId.get(id) ?? []),
      };
    });
  const link = (rows: readonly LeanTx[], estado: string): string | null =>
    rows.length === 0 ? null : hrefWith(TX_LIST, "", { ...spanOf(rows), estado, moneda: currency });
  return {
    ...figures,
    soon: withItems(soon),
    later: withItems(later),
    links: {
      overdue: link(
        items.filter((item) => item.phase === "atrasado").map((item) => item.tx),
        "atrasado",
      ),
      total: link(
        items.map((item) => item.tx),
        "por_caer",
      ),
    },
  };
}

/** El primer día del mes siguiente. */
const nextMonth = (first: ISODate): ISODate => `${monthKey(addDays(first, 31))}-01`;

/** Todos los meses del período, en orden; los que no tienen cobros, en cero. */
export function monthRows(
  period: { from: ISODate; to: ISODate },
  byMonth: CurrencySummary["byMonth"],
): MonthRow[] {
  const found = new Map(byMonth.map((row) => [row.month, row]));
  const last = monthKey(period.to);
  const rows: MonthRow[] = [];
  for (let first = `${monthKey(period.from)}-01`; monthKey(first) <= last; first = nextMonth(first)) {
    const month = monthKey(first);
    const row = found.get(month);
    rows.push({
      month,
      label: monthLabel(month),
      gross: row?.gross ?? ZERO,
      fees: row?.fees ?? ZERO,
      buyerFees: row?.buyerFees ?? ZERO,
      net: row?.net ?? ZERO,
      count: row?.count ?? 0,
    });
  }
  return rows;
}

/**
 * Los beneficiarios con algo en `currency` (asignado o liquidado en el período, o fila de saldo), en el orden de
 * `order` (los que no están ahí van al final, por id). Lo que falta va en cero.
 */
export function splitRows(
  currency: Currency | null,
  allocated: readonly BeneficiaryAmount[],
  settled: readonly BeneficiaryAmount[],
  balances: readonly BeneficiaryBalance[],
  order: readonly string[],
): SplitRow[] {
  if (currency === null) return [];
  const inCurrency = <T extends { currency: Currency; beneficiaryId: string }>(rows: readonly T[]) =>
    new Map(rows.filter((row) => row.currency === currency).map((row) => [row.beneficiaryId, row]));
  const assignedBy = inCurrency(allocated);
  const settledBy = inCurrency(settled);
  const balanceBy = inCurrency(balances);
  const ids = new Set([...assignedBy.keys(), ...settledBy.keys(), ...balanceBy.keys()]);
  const position = (id: string): number => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  return [...ids]
    .sort((a, b) => position(a) - position(b) || byText(a, b))
    .map((beneficiaryId) => ({
      beneficiaryId,
      assigned: assignedBy.get(beneficiaryId)?.amount ?? ZERO,
      settled: settledBy.get(beneficiaryId)?.amount ?? ZERO,
      balance: balanceBy.get(beneficiaryId)?.balance ?? ZERO,
    }));
}

/** Suma por beneficiario y moneda (cada línea ya viene en centavos). Salen por moneda y luego por beneficiario. */
function sumAmounts(lines: readonly BeneficiaryAmount[]): BeneficiaryAmount[] {
  const sums = new Map<string, BeneficiaryAmount>();
  for (const line of lines) {
    const key = JSON.stringify([line.currency, line.beneficiaryId]);
    const sum = sums.get(key);
    if (sum) sum.amount = add(sum.amount, line.amount);
    else sums.set(key, { ...line, amount: add(line.amount) });
  }
  return [...sums.values()].sort((a, b) => byText(a.currency, b.currency) || byText(a.beneficiaryId, b.beneficiaryId));
}

/** Un `numeric` leído como texto → monto canónico. */
const money = (value: string): Money => toMoney(dec(value));

// ─── Lecturas ───────────────────────────────────────────────────────────────────────────────────────────────

/** Todas las filas de una lectura del Resumen (por tramos: `readAll`). */
const readAll = <Row>(page: PageRead<Row>): Promise<Row[]> => readAllRows(page, "del Resumen");

/**
 * Lo asignado a cada beneficiario, por moneda, en los repartos de esos cobros. Los fallidos no asignan nada (como
 * en `pay_beneficiary_balances`). Los ids van por tramos: cientos no caben en la URL de una petición.
 */
export async function periodAllocations(supabase: Db, rows: readonly LeanTx[]): Promise<BeneficiaryAmount[]> {
  const currencyOf = new Map(rows.filter((row) => row.status !== "fallido").map((row) => [row.id, row.currency]));
  const pages = await Promise.all(
    chunked([...currencyOf.keys()]).map((ids) =>
      readAll((from, to) =>
        supabase
          .from("pay_allocations")
          .select("transaction_id, beneficiary_id, amount::text", EXACT_COUNT)
          .in("transaction_id", ids)
          .order("id")
          .range(from, to)
          .throwOnError(),
      ),
    ),
  );
  return sumAmounts(
    pages.flat().map((line) => ({
      beneficiaryId: line.beneficiary_id,
      currency: currencyOf.get(line.transaction_id) ?? "",
      amount: money(line.amount),
    })),
  );
}

/** Lo liquidado a cada beneficiario, por moneda, con fecha de pago en el período (ambas fechas incluidas). */
export async function periodSettlements(
  supabase: Db,
  period: { from: ISODate; to: ISODate },
): Promise<BeneficiaryAmount[]> {
  const rows = await readAll((from, to) =>
    supabase
      .from("pay_settlements")
      .select("beneficiary_id, currency, amount::text", EXACT_COUNT)
      .gte("paid_on", period.from)
      .lte("paid_on", period.to)
      .order("id")
      .range(from, to)
      .throwOnError(),
  );
  return sumAmounts(
    rows.map((row) => ({ beneficiaryId: row.beneficiary_id, currency: row.currency, amount: money(row.amount) })),
  );
}

/** El saldo de cada beneficiario por moneda, de toda la historia (vista `pay_beneficiary_balances`). */
export async function beneficiaryBalances(supabase: Db): Promise<BeneficiaryBalance[]> {
  const rows = await readAll((from, to) =>
    supabase
      .from("pay_beneficiary_balances")
      .select("beneficiary_id, currency, assigned::text, settled::text, balance::text", EXACT_COUNT)
      .order("beneficiary_id")
      .order("currency")
      .range(from, to)
      .throwOnError(),
  );
  return rows.map((row) => {
    if (row.beneficiary_id === null || row.currency === null) {
      throw new Error("Una fila de pay_beneficiary_balances llegó sin beneficiario o sin moneda.");
    }
    return {
      beneficiaryId: row.beneficiary_id,
      currency: row.currency,
      assigned: money(row.assigned ?? ZERO),
      settled: money(row.settled ?? ZERO),
      balance: money(row.balance ?? ZERO),
    };
  });
}

/** Los pasos del ciclo del dinero de un cobro que todavía no se depositó ni falló. */
const OPEN = ["registrado", "en_transito"] as const;

/** Lo retenido de un cobro y los días de su regla congelada, leídos del desglose sin traerlo entero. */
const RETAINED_COLUMNS = "id, occurred_on, currency, retention_amount::text, days:breakdown->rules->gateway->retention->days";

/** Lo retenido de un cobro: los días salen de la regla congelada en su desglose. */
function toRetainedRow(row: {
  id: string;
  occurred_on: ISODate;
  currency: Currency;
  retention_amount: string;
  days: unknown;
}): RetainedRow {
  if (typeof row.days !== "number" || !Number.isInteger(row.days)) {
    throw new Error("Un cobro con retención llegó sin los días de su regla congelada (rules.gateway.retention).");
  }
  return {
    id: row.id,
    occurredOn: row.occurred_on,
    currency: row.currency,
    retention: money(row.retention_amount),
    days: row.days,
  };
}

/**
 * Lo que lee «Dinero en camino», de toda la historia y fuera de la papelera (la RLS deja solo lo del usuario): los
 * cobros sin depositar ni fallar, con su referencia (lo por caer y lo detenido por disputa los separa el motor);
 * los depositados desde hace 29 días; y los que tienen algo retenido y pueden no haberlo liberado todavía, con los
 * días de su regla congelada (`breakdown->rules->gateway->retention->days`). Qué cuenta lo decide `moneyInTransit`.
 */
export async function transitRows(supabase: Db, today: ISODate): Promise<TransitRows<TransitTx>> {
  const [open, deposited, retained] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from("pay_transactions")
        .select(`${LEAN_TX_COLUMNS}, reference`, EXACT_COUNT)
        .is("deleted_at", null)
        .in("status", OPEN)
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_transactions")
        .select(LEAN_TX_COLUMNS, EXACT_COUNT)
        .is("deleted_at", null)
        .eq("status", "depositado")
        .gte("deposited_on", addDays(today, 1 - RECENT_DEPOSIT_DAYS))
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
    readAll((from, to) =>
      supabase
        .from("pay_transactions")
        .select(RETAINED_COLUMNS, EXACT_COUNT)
        .is("deleted_at", null)
        .gt("retention_amount", ZERO)
        .gte("occurred_on", addDays(today, -MAX_RETENTION_DAYS))
        .order("id")
        .range(from, to)
        .throwOnError(),
    ),
  ]);
  return {
    open: open.map((row) => ({ ...toLeanTx(row), reference: row.reference })),
    deposited: deposited.map(toLeanTx),
    retained: retained.map(toRetainedRow),
  };
}

// ─── El Resumen entero ──────────────────────────────────────────────────────────────────────────────────────

/** Para un enlace a la lista que no depende del período: el período justo de esos cobros. */
function spanOf(rows: readonly LeanTx[]): Record<string, string> {
  const days = rows.map((row) => row.occurredOn).sort(byText);
  return { periodo: "personalizado", desde: days[0] ?? "", hasta: days.at(-1) ?? "" };
}

/** El aviso de esos cobros, o `null` si no hay ninguno. */
function notice(count: number, href: () => string): Notice | null {
  return count === 0 ? null : { count, href: href() };
}

/**
 * El Resumen: «Dinero en camino» (lo que está por caer ahora, de toda la historia, sin los filtros: lo que cae
 * mañana puede ser de un cobro del mes pasado), los totales y gráficos del período, los repartos y los avisos. Los
 * filtros de empresa, canal y pasarela rigen en todo lo demás, salvo en lo liquidado y el saldo, que no son de un
 * cobro.
 */
export async function loadSummary(
  supabase: Db,
  sp: SearchParams,
  today: ISODate,
  cfg: PayConfig,
): Promise<SummaryView> {
  const scope = summaryScope(sp, today);
  const { from = today, to = today, ...where } = scope.filters;
  const [periodRows, overdueRows, disputedRows, balances, settlements, transit] = await Promise.all([
    leanTx(supabase, scope.filters, today, cfg),
    leanTx(supabase, { ...where, status: "atrasado" }, today, cfg),
    leanTx(supabase, { ...where, status: "en_disputa" }, today, cfg),
    beneficiaryBalances(supabase),
    periodSettlements(supabase, { from, to }),
    transitRows(supabase, today),
  ]);
  const allocations = await periodAllocations(supabase, periodRows);

  const byCurrency = summarize(periodRows, today);
  const { currencies, currency, defaultCurrency } = chooseCurrency(
    byCurrency,
    [
      ...transitCurrencies(transit, today),
      ...allocations.map((line) => line.currency),
      ...settlements.map((line) => line.currency),
      ...balances.filter((row) => !isZero(row.balance)).map((row) => row.currency),
    ],
    scope.requestedCurrency,
    cfg.companies.filter((company) => company.active).map((company) => company.currency),
  );
  const summary = currency === null ? null : (byCurrency[currency] ?? null);
  const list = (changes: Record<string, string | null>) => hrefWith(TX_LIST, scope.query, changes);
  const year = Number(today.slice(0, 4));

  return {
    period: { from, to },
    currencies,
    currency,
    defaultCurrency,
    periodCurrencies: Object.keys(byCurrency).sort(byText),
    summary,
    months: monthRows({ from, to }, summary?.byMonth ?? []),
    transit: currency === null ? null : transitView(moneyInTransit(transit, currency, today), currency, today),
    splits: splitRows(
      currency,
      allocations,
      settlements,
      balances,
      cfg.beneficiaries.map((beneficiary) => beneficiary.id),
    ),
    notices: {
      withoutReceipt: notice(periodRows.filter((row) => row.receiptsCount === 0).length, () =>
        list({ comprobante: "sin" }),
      ),
      overdue: notice(overdueRows.length, () => list({ ...spanOf(overdueRows), estado: "atrasado" })),
      disputes: notice(disputedRows.length, () => list({ ...spanOf(disputedRows), estado: "en_disputa" })),
      companiesWithoutScheme: companiesWithoutScheme(cfg),
      yearsWithoutHolidays: [year, year + 1].filter(
        (candidate) => !cfg.holidays.some((day) => day.startsWith(`${candidate}-`)),
      ),
    },
    links: { pending: list({ estado: "por_caer", moneda: currency }) },
  };
}
