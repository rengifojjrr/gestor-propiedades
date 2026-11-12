/**
 * El resumen de un grupo de cobros: totales, rankings, lo que tardan los depósitos y lo que está por caer.
 * Todo va por moneda (nunca se suman monedas distintas) y los cobros fallidos no cuentan en nada.
 *
 * Quién pagó la comisión cambia lo que es del negocio. Si la pagó el comprador (se le cobró de más para cubrirla),
 * lo que pagó de más no es venta: lo facturado de ese cobro es su neto, y su comisión no es un costo del negocio
 * sino «pagada por los compradores» (`businessFigures`). El bruto sigue siendo todo lo cobrado.
 */
import type { Decimal } from "decimal.js";
import { addDays, daysBetween, monthKey } from "./dates";
import { D, ZERO, dec, toMoney } from "./decimal";
import { add, cmp, pctOf } from "./money";
import { isOverdue, isPending } from "./status";
import type { Currency, ISODate, LeanTx, Money, Pct } from "./types";

/**
 * Las cifras de un grupo de cobros de UNA moneda. Siempre `gross = sale + buyerFees` y `sale = net + fees`; sin
 * cobros cuya comisión pagó el comprador, `sale` es el bruto, `fees` son todas las comisiones y `buyerFees` es 0.
 */
export type Figures = {
  count: number;
  /** Todo lo cobrado (el bruto vigente): lo que pasó por la pasarela. */
  gross: Money;
  /** Lo facturado, la venta del negocio: el bruto si pagamos nosotros la comisión; el neto si la pagó el comprador. */
  sale: Money;
  /** Las comisiones del negocio: las de los cobros cuya comisión pagamos nosotros. */
  fees: Money;
  /** Las comisiones que pagaron los compradores. */
  buyerFees: Money;
  net: Money;
};

export type Totals = Figures & {
  /** Bruto ÷ cobros. */
  avgTicket: Money;
  /**
   * Las comisiones del negocio sobre el bruto de los cobros en que las pagó (sin los del comprador, que no le
   * costaron nada); `null` si ese bruto es 0.
   */
  feePct: Pct | null;
  /** Por caer (`isPending`): lo que se ve como registrado o en tránsito. */
  pendingNet: Money;
  pendingCount: number;
  depositedNet: Money;
  depositedCount: number;
};

export type CurrencySummary = {
  totals: Totals;
  /** Por mes del cobro (`AAAA-MM`), en orden ascendente; solo los meses con cobros. */
  byMonth: (Figures & { month: string })[];
  /** De mayor a menor lo facturado (`sale`). */
  byCompany: (Figures & { companyId: string })[];
  /**
   * De mayor a menor bruto. `sharePct`: su parte del bruto de la moneda. `effectiveCostPct`: las comisiones del
   * negocio sobre el bruto de sus cobros en que las pagó (`null` si no hay ninguno con bruto).
   */
  byGateway: (Figures & { gatewayId: string; sharePct: Pct | null; effectiveCostPct: Pct | null })[];
  /**
   * De mayor a menor neto; `null` es «sin cuenta». `sharePct`: su parte del neto de la moneda, de 0 a 100 %; `null`
   * si el neto total es 0 o si alguna cuenta tiene pérdidas (neto negativo). Los días son de sus cobros ya
   * depositados (`null` si todavía no hay ninguno).
   */
  byAccount: {
    bankAccountId: string | null;
    net: Money;
    count: number;
    sharePct: Pct | null;
    avgDays: string | null;
    medianDays: string | null;
  }[];
};

/** Lo que cae (o debió caer) un mismo día en una misma cuenta y moneda. */
export type DepositGroup = {
  /** El día en que cuenta: la fecha estimada (la más tardía de la ventana) de sus cobros. */
  date: ISODate;
  /** Desde cuándo puede caer: la más temprana de las ventanas de sus cobros (`date` si todas son de un día). */
  from: ISODate;
  bankAccountId: string | null;
  currency: Currency;
  net: Money;
  count: number;
  ids: string[];
  overdue: boolean;
};

/** Las cifras y, aparte, el bruto de los cobros cuya comisión pagó el negocio: sobre él se mide su %. */
type Sums = Figures & { feeBase: Money };
type Lag = { count: number; avgDays: string; medianDays: string };

const NO_LAG = { avgDays: null, medianDays: null };

const isCounted = (row: LeanTx): boolean => row.status !== "fallido";
const isDeposited = (row: LeanTx): boolean => row.status === "depositado";

/** Agrupa las filas por clave. Los grupos salen en el orden en que aparece cada clave y nunca están vacíos. */
function groupBy<K>(rows: readonly LeanTx[], keyOf: (row: LeanTx) => K): Map<K, LeanTx[]> {
  const groups = new Map<K, LeanTx[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

/** Los cobros que cuentan (sin los fallidos), separados por moneda. */
function countedByCurrency(rows: readonly LeanTx[]): Map<Currency, LeanTx[]> {
  return groupBy(rows.filter(isCounted), (row) => row.currency);
}

/**
 * Lo que un cobro es para el negocio según quién pagó la comisión. Si la pagamos nosotros: la venta es el bruto y
 * la comisión, del negocio. Si la pagó el comprador: la venta es el neto (lo que pagó de más no es del negocio) y la
 * comisión la pagaron los compradores.
 */
export function businessFigures(
  row: Pick<LeanTx, "gross" | "fees" | "net" | "feesPaidBy">,
): Pick<Figures, "sale" | "fees" | "buyerFees"> {
  return row.feesPaidBy === "comprador"
    ? { sale: row.net, fees: ZERO, buyerFees: row.fees }
    : { sale: row.gross, fees: row.fees, buyerFees: ZERO };
}

/** Suma de filas de UNA moneda (quien llama ya las separó). */
function sumRows(rows: readonly LeanTx[]): Sums {
  let gross = ZERO;
  let sale = ZERO;
  let fees = ZERO;
  let buyerFees = ZERO;
  let net = ZERO;
  let feeBase = ZERO;
  for (const row of rows) {
    const own = businessFigures(row);
    gross = add(gross, row.gross);
    sale = add(sale, own.sale);
    fees = add(fees, own.fees);
    buyerFees = add(buyerFees, own.buyerFees);
    net = add(net, row.net);
    if (row.feesPaidBy !== "comprador") feeBase = add(feeBase, row.gross);
  }
  return { count: rows.length, gross, sale, fees, buyerFees, net, feeBase };
}

/** Las cifras de una suma, sin el bruto con que se mide el % de las comisiones. */
const figuresOf = ({ feeBase: _base, ...figures }: Sums): Figures => figures;

/** Orden por código de carácter, no por idioma: servidor y navegador dan exactamente lo mismo. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Clave de orden de una cuenta: por id, con «sin cuenta» al final (U+FFFF va después de cualquier id). */
const accountOrder = (bankAccountId: string | null): string => bankAccountId ?? "\uffff";

/** De mayor a menor monto (como decimales, no como texto); a igual monto, por clave ascendente. */
function largestFirst<T>(amountOf: (item: T) => Money, keyOf: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => cmp(amountOf(b), amountOf(a)) || byText(keyOf(a), keyOf(b));
}

/** Promedio de días. Aquí no hay dinero, pero con Decimal el texto que sale es exacto y estable. */
function mean(days: readonly number[]): Decimal {
  return days.reduce((sum, day) => sum.plus(day), new D(0)).div(days.length);
}

/** Días con 1 decimal, mitad hacia arriba. Se redondea ANTES de escribir: −0,04 se escribe "0.0", no "-0.0". */
const oneDecimal = (days: Decimal): string => days.toDecimalPlaces(1, D.ROUND_HALF_UP).toFixed(1);

/**
 * Cuánto tardaron en caer los cobros depositados de `rows`: días de calendario entre la fecha del cobro y la del
 * depósito real. `null` si ninguno está depositado.
 */
function lagOf(rows: readonly LeanTx[]): Lag | null {
  const days: number[] = [];
  for (const row of rows) {
    if (isDeposited(row) && row.depositedOn !== null) days.push(daysBetween(row.occurredOn, row.depositedOn));
  }
  days.sort((a, b) => a - b);
  if (days.length === 0) return null;
  // El valor central si son impares; los dos centrales (y la mediana es su promedio) si son pares.
  const middle = days.slice(Math.floor((days.length - 1) / 2), Math.floor(days.length / 2) + 1);
  return { count: days.length, avgDays: oneDecimal(mean(days)), medianDays: oneDecimal(mean(middle)) };
}

/**
 * El resumen de las filas de UNA moneda, ya sin fallidos. Nunca llega vacío (una moneda sin cobros que cuenten no
 * tiene resumen), así que el ticket promedio siempre divide entre 1 o más.
 */
function summarizeCurrency(rows: readonly LeanTx[]): CurrencySummary {
  const all = sumRows(rows);
  const pending = sumRows(rows.filter(isPending));
  const deposited = sumRows(rows.filter(isDeposited));
  return {
    totals: {
      ...figuresOf(all),
      avgTicket: toMoney(dec(all.gross).div(all.count)),
      feePct: pctOf(all.fees, all.feeBase),
      pendingNet: pending.net,
      pendingCount: pending.count,
      depositedNet: deposited.net,
      depositedCount: deposited.count,
    },
    byMonth: [...groupBy(rows, (row) => monthKey(row.occurredOn))]
      .map(([month, group]) => ({ month, ...figuresOf(sumRows(group)) }))
      .sort((a, b) => byText(a.month, b.month)),
    byCompany: [...groupBy(rows, (row) => row.companyId)]
      .map(([companyId, group]) => ({ companyId, ...figuresOf(sumRows(group)) }))
      .sort(largestFirst((company) => company.sale, (company) => company.companyId)),
    byGateway: [...groupBy(rows, (row) => row.gatewayId)]
      .map(([gatewayId, group]) => {
        const sums = sumRows(group);
        return {
          gatewayId,
          ...figuresOf(sums),
          sharePct: pctOf(sums.gross, all.gross),
          effectiveCostPct: pctOf(sums.fees, sums.feeBase),
        };
      })
      .sort(largestFirst((gateway) => gateway.gross, (gateway) => gateway.gatewayId)),
    byAccount: accountsOf(rows, all.net),
  };
}

/**
 * Las cuentas de las filas de UNA moneda, de mayor a menor neto. La parte del neto solo existe si ninguna cuenta
 * tiene pérdidas: con un neto negativo en alguna, las demás pasarían del 100 % y esa daría un porcentaje negativo.
 */
function accountsOf(rows: readonly LeanTx[], totalNet: Money): CurrencySummary["byAccount"] {
  const accounts = [...groupBy(rows, (row) => row.bankAccountId)].map(([bankAccountId, group]) => {
    const { net, count } = sumRows(group);
    const { avgDays, medianDays } = lagOf(group) ?? NO_LAG;
    return { bankAccountId, net, count, avgDays, medianDays };
  });
  const losses = accounts.some((account) => cmp(account.net, ZERO) < 0);
  return accounts
    .map(({ bankAccountId, net, count, avgDays, medianDays }) => {
      const sharePct = losses ? null : pctOf(net, totalNet);
      return { bankAccountId, net, count, sharePct, avgDays, medianDays };
    })
    .sort(largestFirst((account) => account.net, (account) => accountOrder(account.bankAccountId)));
}

/**
 * El resumen por moneda de un grupo de cobros. Una moneda cuyos cobros son todos fallidos no aparece.
 *
 * `today` es parte del contrato pero ninguna cifra de aquí depende de la fecha: lo que sí depende de ella (lo
 * atrasado y lo que cae en los próximos días) sale de `upcomingDeposits`.
 */
export function summarize(rows: readonly LeanTx[], _today: ISODate): Record<Currency, CurrencySummary> {
  const summary = new Map<Currency, CurrencySummary>();
  for (const [currency, group] of countedByCurrency(rows)) summary.set(currency, summarizeCurrency(group));
  return Object.fromEntries(summary);
}

/**
 * Cobros, bruto, comisiones y neto por moneda, sin los fallidos: los totales de una lista de cobros. Las comisiones
 * son las de todos sus cobros, las haya pagado el negocio o el comprador (las mismas que se ven fila por fila).
 */
export function totalsOf(
  rows: readonly LeanTx[],
): Record<Currency, { count: number; gross: Money; fees: Money; net: Money }> {
  const totals = new Map<Currency, { count: number; gross: Money; fees: Money; net: Money }>();
  for (const [currency, group] of countedByCurrency(rows)) {
    const { count, gross, fees, buyerFees, net } = sumRows(group);
    totals.set(currency, { count, gross, fees: add(fees, buyerFees), net });
  }
  return Object.fromEntries(totals);
}

/**
 * Tiempo real de depósito por clave (pasarela, cuenta…): promedio y mediana, con 1 decimal, de los días de calendario
 * entre la fecha del cobro y la del depósito real. Solo cuentan los cobros depositados; las filas cuya clave es
 * `null` se omiten y una clave sin depósitos no aparece.
 */
export function lagStats(
  rows: readonly LeanTx[],
  keyOf: (r: LeanTx) => string | null,
): Record<string, { count: number; avgDays: string; medianDays: string }> {
  const stats = new Map<string, Lag>();
  for (const [key, group] of groupBy(rows, keyOf)) {
    if (key === null) continue;
    const lag = lagOf(group);
    if (lag !== null) stats.set(key, lag);
  }
  return Object.fromEntries(stats);
}

/**
 * Lo que está por caer, agrupado por fecha estimada, cuenta y moneda: todo lo atrasado (fecha estimada anterior a
 * `today`) y lo que cae en `[today, today + days − 1]`. Solo cobros por caer (`isPending`, la misma regla que la
 * tarjeta «Por caer») y con fecha estimada. Salen por fecha ascendente, así que lo atrasado va primero; a igual
 * fecha, por moneda y luego por cuenta («sin cuenta» al final). `ids` guarda los cobros de cada grupo en el orden
 * en que llegaron.
 *
 * La fecha estimada es la más tardía de la ventana de cada cobro: ahí cuenta, y de ella depende lo atrasado. `from`
 * del grupo es la más temprana de las ventanas de sus cobros.
 */
export function upcomingDeposits(rows: readonly LeanTx[], today: ISODate, days = 14): DepositGroup[] {
  const lastDay = addDays(today, days - 1);
  const groups = new Map<string, DepositGroup>();
  for (const row of rows) {
    const date = row.estimatedDepositOn;
    if (!isPending(row) || date === null) continue;
    const overdue = isOverdue(row, today);
    if (!overdue && date > lastDay) continue;
    const key = JSON.stringify([date, row.bankAccountId, row.currency]);
    const from = row.estimatedDepositFrom ?? date;
    const group = groups.get(key);
    if (group) {
      group.net = add(group.net, row.net);
      group.count += 1;
      group.ids.push(row.id);
      if (from < group.from) group.from = from;
    } else {
      const { bankAccountId, currency } = row;
      groups.set(key, { date, from, bankAccountId, currency, net: add(row.net), count: 1, ids: [row.id], overdue });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      byText(a.date, b.date) ||
      byText(a.currency, b.currency) ||
      byText(accountOrder(a.bankAccountId), accountOrder(b.bankAccountId)),
  );
}
