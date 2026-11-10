/**
 * El resumen de un grupo de cobros: totales, rankings, lo que tardan los depósitos y lo que está por caer.
 * Todo va por moneda (nunca se suman monedas distintas) y los cobros fallidos no cuentan en nada.
 */
import type { Decimal } from "decimal.js";
import { addDays, daysBetween, monthKey } from "./dates";
import { D, ZERO, dec, toMoney } from "./decimal";
import { add, cmp, pctOf } from "./money";
import { isOverdue, isPending } from "./status";
import type { Currency, ISODate, LeanTx, Money, Pct } from "./types";

export type Totals = {
  count: number;
  gross: Money;
  fees: Money;
  net: Money;
  /** Bruto ÷ cobros. */
  avgTicket: Money;
  /** Comisiones sobre el bruto; `null` si el bruto es 0. */
  feePct: Pct | null;
  /** Por caer: registrados y en tránsito. */
  pendingNet: Money;
  pendingCount: number;
  depositedNet: Money;
  depositedCount: number;
};

export type CurrencySummary = {
  totals: Totals;
  /** Por mes del cobro (`AAAA-MM`), en orden ascendente; solo los meses con cobros. */
  byMonth: { month: string; gross: Money; fees: Money; net: Money; count: number }[];
  /** De mayor a menor bruto. */
  byCompany: { companyId: string; gross: Money; fees: Money; net: Money; count: number }[];
  /** De mayor a menor bruto. `sharePct`: su parte del bruto de la moneda. `effectiveCostPct`: comisiones ÷ bruto. */
  byGateway: {
    gatewayId: string;
    gross: Money;
    fees: Money;
    net: Money;
    count: number;
    sharePct: Pct | null;
    effectiveCostPct: Pct | null;
  }[];
  /**
   * De mayor a menor neto; `null` es «sin cuenta». `sharePct`: su parte del neto de la moneda. Los días son de sus
   * cobros ya depositados (`null` si todavía no hay ninguno).
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
  date: ISODate;
  bankAccountId: string | null;
  currency: Currency;
  net: Money;
  count: number;
  ids: string[];
  overdue: boolean;
};

type Sums = Pick<Totals, "count" | "gross" | "fees" | "net">;
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

/** Suma de filas de UNA moneda (quien llama ya las separó). */
function sumRows(rows: readonly LeanTx[]): Sums {
  let gross = ZERO;
  let fees = ZERO;
  let net = ZERO;
  for (const row of rows) {
    gross = add(gross, row.gross);
    fees = add(fees, row.fees);
    net = add(net, row.net);
  }
  return { count: rows.length, gross, fees, net };
}

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
      ...all,
      avgTicket: toMoney(dec(all.gross).div(all.count)),
      feePct: pctOf(all.fees, all.gross),
      pendingNet: pending.net,
      pendingCount: pending.count,
      depositedNet: deposited.net,
      depositedCount: deposited.count,
    },
    byMonth: [...groupBy(rows, (row) => monthKey(row.occurredOn))]
      .map(([month, group]) => ({ month, ...sumRows(group) }))
      .sort((a, b) => byText(a.month, b.month)),
    byCompany: [...groupBy(rows, (row) => row.companyId)]
      .map(([companyId, group]) => ({ companyId, ...sumRows(group) }))
      .sort(largestFirst((company) => company.gross, (company) => company.companyId)),
    byGateway: [...groupBy(rows, (row) => row.gatewayId)]
      .map(([gatewayId, group]) => {
        const sums = sumRows(group);
        return {
          gatewayId,
          ...sums,
          sharePct: pctOf(sums.gross, all.gross),
          effectiveCostPct: pctOf(sums.fees, sums.gross),
        };
      })
      .sort(largestFirst((gateway) => gateway.gross, (gateway) => gateway.gatewayId)),
    byAccount: [...groupBy(rows, (row) => row.bankAccountId)]
      .map(([bankAccountId, group]) => {
        const { net, count } = sumRows(group);
        const { avgDays, medianDays } = lagOf(group) ?? NO_LAG;
        return { bankAccountId, net, count, sharePct: pctOf(net, all.net), avgDays, medianDays };
      })
      .sort(largestFirst((account) => account.net, (account) => accountOrder(account.bankAccountId))),
  };
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

/** Cobros, bruto, comisiones y neto por moneda, sin los fallidos. */
export function totalsOf(
  rows: readonly LeanTx[],
): Record<Currency, Pick<Totals, "count" | "gross" | "fees" | "net">> {
  const totals = new Map<Currency, Sums>();
  for (const [currency, group] of countedByCurrency(rows)) totals.set(currency, sumRows(group));
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
 * `today`) y lo que cae en `[today, today + days − 1]`. Solo cobros por caer, con fecha estimada y bruto vigente
 * mayor que cero. Salen por fecha ascendente, así que lo atrasado va primero; a igual fecha, por moneda y luego por
 * cuenta («sin cuenta» al final). `ids` guarda los cobros de cada grupo en el orden en que llegaron.
 */
export function upcomingDeposits(rows: readonly LeanTx[], today: ISODate, days = 14): DepositGroup[] {
  const lastDay = addDays(today, days - 1);
  const groups = new Map<string, DepositGroup>();
  for (const row of rows) {
    const date = row.estimatedDepositOn;
    if (!isPending(row) || date === null || cmp(row.gross, ZERO) <= 0) continue;
    const overdue = isOverdue(row, today);
    if (!overdue && date > lastDay) continue;
    const key = JSON.stringify([date, row.bankAccountId, row.currency]);
    const group = groups.get(key);
    if (group) {
      group.net = add(group.net, row.net);
      group.count += 1;
      group.ids.push(row.id);
    } else {
      const { bankAccountId, currency } = row;
      groups.set(key, { date, bankAccountId, currency, net: add(row.net), count: 1, ids: [row.id], overdue });
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      byText(a.date, b.date) ||
      byText(a.currency, b.currency) ||
      byText(accountOrder(a.bankAccountId), accountOrder(b.bankAccountId)),
  );
}
