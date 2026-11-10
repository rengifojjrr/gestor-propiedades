import "server-only";
import { hrefWith } from "@/components/ui/url";
import {
  ZERO,
  add,
  addDays,
  cmp,
  dec,
  isOverdue,
  isZero,
  monthKey,
  monthLabel,
  summarize,
  toMoney,
  upcomingDeposits,
} from "@/lib/pasarelas";
import type { Currency, CurrencySummary, DepositGroup, ISODate, LeanTx, Money, PayConfig } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { chunked, leanTx, parseTxFilters, type TxFilters } from "./transactions";

/**
 * Lo que pinta el Resumen (`/pasarelas`). Los totales del período salen del motor (`summarize`) sobre TODAS las
 * filas del filtro (`leanTx`, con el mismo constructor de filtros que la lista de cobros); los repartos, de lo
 * asignado a los cobros del período, de lo liquidado en el período y del saldo de toda la historia (vista
 * `pay_beneficiary_balances`). Todo se entrega en UNA moneda: nunca un total mezclado.
 */

/** Los días de «próximos depósitos», contando hoy. */
export const SUMMARY_DAYS = 14;

const TX_LIST = "/pasarelas/cobros";
/** El tope de filas por petición de la API. */
const PAGE_SIZE = 1000;
const EXACT_COUNT = { count: "exact" } as const;

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

/** Un mes del período (`AAAA-MM`), con su texto (`nov 2026`). Los meses sin cobros van en cero. */
export type MonthRow = { month: string; label: string; gross: Money; fees: Money; net: Money; count: number };

/** Cuántos cobros y el enlace a la lista de cobros que muestra exactamente esos. */
export type Notice = { count: number; href: string };

export type SummaryNotices = {
  /** Cobros del período (en cualquier moneda) sin comprobante. */
  withoutReceipt: Notice | null;
  /** Por caer con la fecha estimada ya pasada, de toda la historia. */
  overdue: Notice | null;
  /** Con la disputa abierta, de toda la historia. */
  disputes: Notice | null;
  /** Empresas activas sin esquema de reparto por defecto. */
  companiesWithoutScheme: { id: string; name: string }[];
  /** El año en curso y el siguiente, si no tienen ningún feriado cargado. */
  yearsWithoutHolidays: number[];
};

export type SummaryView = {
  period: { from: ISODate; to: ISODate };
  /** Todas las monedas que aparecen en algo de la pantalla, en orden alfabético. */
  currencies: Currency[];
  /** La moneda en que se pinta todo; `null` si no hay nada que pintar. */
  currency: Currency | null;
  /** La que rige sin `moneda` en la URL: la de más bruto en el período. */
  defaultCurrency: Currency | null;
  /** El resumen del período en `currency`; `null` si no hubo cobros que cuenten. */
  summary: CurrencySummary | null;
  months: MonthRow[];
  /** Lo atrasado y lo que cae en los próximos días, en `currency`. No depende del período. */
  deposits: DepositGroup[];
  /** Los días que cubre `deposits` (además de lo atrasado), ambos incluidos. */
  depositWindow: { from: ISODate; to: ISODate };
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
 * repartos). Por defecto, la de más bruto en el período (a igual bruto, la primera por orden alfabético); sin
 * cobros en el período, la primera disponible. La pedida rige solo si está disponible.
 */
export function chooseCurrency(
  byCurrency: Record<Currency, CurrencySummary>,
  others: readonly Currency[],
  requested: Currency | undefined,
): { currencies: Currency[]; currency: Currency | null; defaultCurrency: Currency | null } {
  const currencies = [...new Set([...Object.keys(byCurrency), ...others])].sort(byText);
  const ranked = Object.entries(byCurrency).sort(
    ([a, x], [b, y]) => cmp(y.totals.gross, x.totals.gross) || byText(a, b),
  );
  const defaultCurrency = ranked[0]?.[0] ?? currencies[0] ?? null;
  const currency = requested !== undefined && currencies.includes(requested) ? requested : defaultCurrency;
  return { currencies, currency, defaultCurrency };
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

/**
 * Todas las filas de una lectura, por tramos de 1000 (el tope de la API) hasta tener las que la propia lectura
 * dice que hay. Si un tramo llega sin ese total no se puede saber si están todas: se lanza.
 */
async function readAll<Row>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[]; count: number | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const { data, count } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (count === null) throw new Error("Una lectura del Resumen llegó sin el total de filas (count).");
    rows.push(...data);
    if (data.length === 0 || rows.length >= count) return rows;
  }
}

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
 * El Resumen: los totales y gráficos del período, los próximos depósitos (lo atrasado y lo que cae en 14 días, sin
 * importar el período: lo que cae mañana puede ser de un cobro del mes pasado), los repartos y los avisos. Los
 * filtros de empresa, canal y pasarela rigen en todo, salvo en lo liquidado y el saldo, que no son de un cobro.
 */
export async function loadSummary(
  supabase: Db,
  sp: SearchParams,
  today: ISODate,
  cfg: PayConfig,
): Promise<SummaryView> {
  const scope = summaryScope(sp, today);
  const { from = today, to = today, ...where } = scope.filters;
  const [periodRows, pendingRows, disputedRows, balances, settlements] = await Promise.all([
    leanTx(supabase, scope.filters, today, cfg),
    leanTx(supabase, { ...where, status: "por_caer" }, today, cfg),
    leanTx(supabase, { ...where, status: "en_disputa" }, today, cfg),
    beneficiaryBalances(supabase),
    periodSettlements(supabase, { from, to }),
  ]);
  const allocations = await periodAllocations(supabase, periodRows);

  const byCurrency = summarize(periodRows, today);
  const groups = upcomingDeposits(pendingRows, today, SUMMARY_DAYS);
  const { currencies, currency, defaultCurrency } = chooseCurrency(
    byCurrency,
    [
      ...groups.map((group) => group.currency),
      ...allocations.map((line) => line.currency),
      ...settlements.map((line) => line.currency),
      ...balances.filter((row) => !isZero(row.balance)).map((row) => row.currency),
    ],
    scope.requestedCurrency,
  );
  const summary = currency === null ? null : (byCurrency[currency] ?? null);
  const list = (changes: Record<string, string | null>) => hrefWith(TX_LIST, scope.query, changes);
  const overdueRows = pendingRows.filter((row) => isOverdue(row, today));
  const year = Number(today.slice(0, 4));

  return {
    period: { from, to },
    currencies,
    currency,
    defaultCurrency,
    summary,
    months: monthRows({ from, to }, summary?.byMonth ?? []),
    deposits: groups.filter((group) => group.currency === currency),
    depositWindow: { from: today, to: addDays(today, SUMMARY_DAYS - 1) },
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
      companiesWithoutScheme: cfg.companies
        .filter((company) => company.active && company.defaultSchemeId === null)
        .map(({ id, name }) => ({ id, name })),
      yearsWithoutHolidays: [year, year + 1].filter(
        (candidate) => !cfg.holidays.some((day) => day.startsWith(`${candidate}-`)),
      ),
    },
    links: { pending: list({ estado: "por_caer", moneda: currency }) },
  };
}
