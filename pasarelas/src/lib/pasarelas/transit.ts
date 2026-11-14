/**
 * «Dinero en camino»: lo que está por caer AHORA, sin importar el período. Por cada cobro, en qué fase va (atrasado,
 * hoy, próximo), cuánto le falta y cuánto del camino ya pasó; arriba, las cifras de cada fase; por cuenta destino; los
 * grupos para marcar depositado; lo detenido por disputas; lo que retienen las pasarelas y lo marcado depositado en
 * los últimos días.
 *
 * La app no ve el banco: «llegó» es lo que el dueño marcó «depositado», y las fechas son las estimadas de cada cobro
 * (su ventana `estimatedDepositFrom` … `estimatedDepositOn`). Todo va por moneda: nunca se suman monedas distintas.
 * El monto es siempre lo que llega al banco: neto − retenido.
 */
import { retentionReleaseOn } from "./breakdown";
import { addDays, daysBetween, formatDate, type DateWindow } from "./dates";
import { ZERO } from "./decimal";
import { add, cmp, sub } from "./money";
import { upcomingDeposits, type DepositGroup } from "./stats";
import { isPending } from "./status";
import type { Currency, ISODate, LeanTx, Money } from "./types";

/** «Próximos 7 días»: lo que no cae hoy y cuya fecha más tardía llega a lo sumo dentro de 7 días. */
export const TRANSIT_WEEK_DAYS = 7;
/** En la lista, lo que cae dentro de más de 14 días va plegado bajo «Más adelante». */
export const TRANSIT_LIST_DAYS = 14;
/** «Marcado depositado en los últimos 30 días», contando hoy. */
export const RECENT_DEPOSIT_DAYS = 30;

/** En qué va un cobro: ya debió llegar, puede llegar hoy o todavía no. */
export type TransitPhase = "atrasado" | "hoy" | "proximo";
/** Las cuatro tarjetas: la fase, con lo próximo partido en los próximos 7 días y lo que viene después. */
export type TransitBucket = "atrasado" | "hoy" | "semana" | "despues";

/** Lo que llega al banco de unos cobros, y cuántos son. */
export type TransitAmount = { payout: Money; count: number };

export type TransitItem<T extends LeanTx = LeanTx> = {
  tx: T;
  /** Lo que llega al banco: el neto menos lo que retiene la pasarela. */
  payout: Money;
  /** La ventana estimada; de un solo día, `from` = `to`. */
  window: DateWindow;
  phase: TransitPhase;
  bucket: TransitBucket;
  /** «Debió llegar hace 4 días», «Puede llegar hoy», «Hoy o hasta el mié 18», «Llega mañana», «Llega en 3–7 días». */
  label: string;
  /** Cuánto del camino ya pasó, de 0 a 100: de la fecha del cobro a la más tardía de la ventana. Atrasado, 100. */
  progress: number;
};

/** Lo que va a una cuenta destino (`null`: sin cuenta), y cuánto de eso ya debió llegar. */
export type TransitAccount = { bankAccountId: string | null; total: TransitAmount; overdue: TransitAmount };

/** Lo retenido de un cobro, con los días de su regla congelada (`rules.gateway.retention.days`). */
export type RetainedRow = { id: string; occurredOn: ISODate; currency: Currency; retention: Money; days: number };

/**
 * Lo que se lee para la sección. Las reglas de qué entra las aplica `moneyInTransit`, no la lectura: `open` son los
 * cobros sin depositar (de ahí salen lo por caer y lo detenido por disputa), `deposited` los depositados recientes y
 * `retained` los cobros con algo retenido.
 */
export type TransitRows<T extends LeanTx> = {
  open: readonly T[];
  deposited: readonly LeanTx[];
  retained: readonly RetainedRow[];
};

/** «Dinero en camino» en UNA moneda. */
export type InTransit<T extends LeanTx = LeanTx> = {
  /** Cada cobro por caer, por la fecha más tardía de su ventana: lo atrasado primero. */
  items: TransitItem<T>[];
  /** Las cuatro tarjetas: suman exactamente `total`. */
  buckets: Record<TransitBucket, TransitAmount>;
  total: TransitAmount;
  /** Por cuenta destino, de más a menos en camino (a igual monto, por id). Sin «sin cuenta». */
  accounts: TransitAccount[];
  /** Lo que no tiene cuenta destino; `null` si no hay. */
  unassigned: TransitAccount | null;
  /** Los grupos por fecha y cuenta para marcar depositado (`upcomingDeposits`): lo atrasado y los próximos 14 días. */
  soon: DepositGroup[];
  /** Los grupos que caen dentro de más de 14 días. */
  later: DepositGroup[];
  /** Lo que estaría por caer pero tiene la disputa abierta: la pasarela lo detiene. No está en camino. */
  held: TransitAmount;
  /** Lo que retienen las pasarelas y todavía no liberan, con el primer y el último día en que se libera. */
  retained: { amount: Money; count: number; from: ISODate; to: ISODate } | null;
  /** Lo marcado depositado en los últimos 30 días: por cuenta (de más a menos; «sin cuenta» al final) y en total. */
  deposited: { total: TransitAmount; accounts: { bankAccountId: string | null; payout: Money; count: number }[] };
};

// ─── Piezas ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Orden por código de carácter, no por idioma: servidor y navegador dan exactamente lo mismo. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Clave de orden de una cuenta: por id, con «sin cuenta» al final (U+FFFF va después de cualquier id). */
const accountOrder = (bankAccountId: string | null): string => bankAccountId ?? "￿";

const payoutOf = (row: LeanTx): Money => sub(row.net, row.retention);

const amountOf = (payouts: readonly Money[]): TransitAmount => ({
  payout: add(ZERO, ...payouts),
  count: payouts.length,
});

/** Agrupa por clave; los grupos salen en el orden en que aparece cada clave. */
function groupBy<T, K>(items: readonly T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** «Días» en singular o plural. */
const days = (n: number): string => (n === 1 ? "1 día" : `${n} días`);

/** `mié 18` en el mes de hoy; `mié 2 dic` en otro mes; `vie 1 ene 2027` en otro año. */
function dayLabel(d: ISODate, today: ISODate): string {
  const [weekday, day, month, year] = formatDate(d).split(" ");
  if (d.slice(0, 7) === today.slice(0, 7)) return `${weekday} ${day}`;
  return d.slice(0, 4) === today.slice(0, 4) ? `${weekday} ${day} ${month}` : `${weekday} ${day} ${month} ${year}`;
}

/** La fase de una ventana hoy: atrasado si hoy > `to`; hoy si `from` ≤ hoy ≤ `to`; próximo si hoy < `from`. */
export function transitPhase(window: DateWindow, today: ISODate): TransitPhase {
  if (today > window.to) return "atrasado";
  return today >= window.from ? "hoy" : "proximo";
}

/**
 * Lo que se dice de un cobro con esa ventana, hoy: «Debió llegar hace 4 días» (desde la más tardía), «Puede llegar
 * hoy» (hoy es la más tardía), «Hoy o hasta el mié 18» (hoy está dentro), «Llega mañana», «Llega en 5 días» (un
 * solo día) o «Llega en 3–7 días» (una ventana). Los días son de calendario.
 */
export function transitLabel(window: DateWindow, today: ISODate): string {
  const phase = transitPhase(window, today);
  if (phase === "atrasado") return `Debió llegar hace ${days(daysBetween(window.to, today))}`;
  if (phase === "hoy") return window.to === today ? "Puede llegar hoy" : `Hoy o hasta el ${dayLabel(window.to, today)}`;
  const first = daysBetween(today, window.from);
  if (window.from !== window.to) return `Llega en ${first}–${daysBetween(today, window.to)} días`;
  return first === 1 ? "Llega mañana" : `Llega en ${days(first)}`;
}

/** Cuánto del camino ya pasó, de 0 a 100, en días enteros. Sin camino (cae el día del cobro o antes), 100. */
function progressOf(occurredOn: ISODate, window: DateWindow, phase: TransitPhase, today: ISODate): number {
  const length = daysBetween(occurredOn, window.to);
  if (phase === "atrasado" || length <= 0) return 100;
  const elapsed = daysBetween(occurredOn, today);
  return Math.min(100, Math.max(0, Math.floor((elapsed * 100) / length)));
}

/** El cobro por caer (con fecha estimada) en su fase. */
function itemOf<T extends LeanTx>(tx: T, to: ISODate, today: ISODate): TransitItem<T> {
  const window = { from: tx.estimatedDepositFrom ?? to, to };
  const phase = transitPhase(window, today);
  const bucket = phase !== "proximo" ? phase : daysBetween(today, to) <= TRANSIT_WEEK_DAYS ? "semana" : "despues";
  return {
    tx,
    payout: payoutOf(tx),
    window,
    phase,
    bucket,
    label: transitLabel(window, today),
    progress: progressOf(tx.occurredOn, window, phase, today),
  };
}

/** Por la fecha más tardía, luego la más temprana, la del cobro y el id: siempre el mismo orden. */
function byWindow(a: TransitItem<LeanTx>, b: TransitItem<LeanTx>): number {
  return (
    byText(a.window.to, b.window.to) ||
    byText(a.window.from, b.window.from) ||
    byText(a.tx.occurredOn, b.tx.occurredOn) ||
    byText(a.tx.id, b.tx.id)
  );
}

/** Con la disputa abierta, pero por caer si no la tuviera: la pasarela lo detiene. */
const isHeld = (row: LeanTx): boolean => row.disputeState === "abierta" && isPending({ ...row, disputeState: null });

/** Marcado depositado entre hace 29 días y hoy (30 días, contando hoy). */
function isRecentDeposit(row: LeanTx, today: ISODate): boolean {
  const on = row.depositedOn;
  return row.status === "depositado" && on !== null && on >= addDays(today, 1 - RECENT_DEPOSIT_DAYS) && on <= today;
}

/** Por la cuenta de cada cobro: cuánto va y cuánto de eso ya debió llegar. */
function accountsOf<T extends LeanTx>(items: readonly TransitItem<T>[]): TransitAccount[] {
  return [...groupBy(items, (item) => item.tx.bankAccountId)]
    .map(([bankAccountId, group]) => ({
      bankAccountId,
      total: amountOf(group.map((item) => item.payout)),
      overdue: amountOf(group.filter((item) => item.phase === "atrasado").map((item) => item.payout)),
    }))
    .sort(
      (a, b) =>
        cmp(b.total.payout, a.total.payout) || byText(accountOrder(a.bankAccountId), accountOrder(b.bankAccountId)),
    );
}

/** Lo retenido que todavía no se libera (el día en que se libera, todavía cuenta). */
function retainedOf(rows: readonly RetainedRow[]): InTransit["retained"] {
  if (rows.length === 0) return null;
  const releases = rows.map((row) => retentionReleaseOn(row.occurredOn, row.days)).sort(byText);
  return {
    amount: add(ZERO, ...rows.map((row) => row.retention)),
    count: rows.length,
    from: releases[0] as ISODate,
    to: releases.at(-1) as ISODate,
  };
}

/** Lo depositado, por cuenta: de más a menos; a igual monto, por id y «sin cuenta» al final. */
function depositedOf(rows: readonly LeanTx[]): InTransit["deposited"] {
  const accounts = [...groupBy(rows, (row) => row.bankAccountId)]
    .map(([bankAccountId, group]) => ({ bankAccountId, ...amountOf(group.map(payoutOf)) }))
    .sort((a, b) => cmp(b.payout, a.payout) || byText(accountOrder(a.bankAccountId), accountOrder(b.bankAccountId)));
  return { total: amountOf(rows.map(payoutOf)), accounts };
}

/**
 * Las filas que cuentan, separadas:
 *  - en camino: lo por caer (`isPending`, la misma regla que «Por caer») con fecha estimada;
 *  - detenido: lo que estaría por caer pero tiene la disputa abierta;
 *  - depositado: lo marcado depositado en los últimos 30 días, contando hoy;
 *  - retenido: lo que las pasarelas todavía no liberan (el día del cobro más los días de su regla, ≥ hoy).
 */
function counted<T extends LeanTx>(rows: TransitRows<T>, today: ISODate) {
  return {
    pending: rows.open.filter((row) => isPending(row) && row.estimatedDepositOn !== null),
    held: rows.open.filter(isHeld),
    deposited: rows.deposited.filter((row) => isRecentDeposit(row, today)),
    retained: rows.retained.filter(
      (row) => cmp(row.retention, ZERO) > 0 && retentionReleaseOn(row.occurredOn, row.days) >= today,
    ),
  };
}

/** Las monedas con algo que contar (en camino, detenido, depositado o retenido), en orden alfabético. */
export function transitCurrencies(rows: TransitRows<LeanTx>, today: ISODate): Currency[] {
  const { pending, held, deposited, retained } = counted(rows, today);
  const all = [...pending, ...held, ...deposited, ...retained];
  return [...new Set(all.map((row) => row.currency))].sort(byText);
}

/**
 * «Dinero en camino» en UNA moneda, con hoy en Nueva York (sin nada en esa moneda, todo en cero). La fase de cada
 * cobro sale de hoy y de su ventana (`from` nulo = un solo día, `to`): atrasado si hoy > `to`; hoy si `from` ≤ hoy ≤
 * `to`; próximo si hoy < `from`. Lo próximo va en «próximos 7 días» si `to` llega a lo sumo dentro de 7 días; si no,
 * en «más adelante». Nada se cuenta dos veces: cada cobro en camino está en una sola fase. Lo que entra, en `counted`.
 */
export function moneyInTransit<T extends LeanTx>(rows: TransitRows<T>, currency: Currency, today: ISODate): InTransit<T> {
  const of = <R extends { currency: Currency }>(list: readonly R[]) => list.filter((row) => row.currency === currency);
  const { pending, held, deposited, retained } = counted(rows, today);
  const items = of(pending)
    .map((tx) => itemOf(tx, tx.estimatedDepositOn as ISODate, today))
    .sort(byWindow);
  const bucket = (name: TransitBucket) =>
    amountOf(items.filter((item) => item.bucket === name).map((item) => item.payout));
  const accounts = accountsOf(items);
  // Sin tope: los grupos cubren hasta la fecha más tardía de todas (lo atrasado entra siempre).
  const span = items.reduce((most, item) => Math.max(most, daysBetween(today, item.window.to) + 1), 1);
  const groups = upcomingDeposits(
    items.map((item) => item.tx),
    today,
    span,
  );
  const lastSoon = addDays(today, TRANSIT_LIST_DAYS);
  return {
    items,
    buckets: { atrasado: bucket("atrasado"), hoy: bucket("hoy"), semana: bucket("semana"), despues: bucket("despues") },
    total: amountOf(items.map((item) => item.payout)),
    accounts: accounts.filter((account) => account.bankAccountId !== null),
    unassigned: accounts.find((account) => account.bankAccountId === null) ?? null,
    soon: groups.filter((group) => group.date <= lastSoon),
    later: groups.filter((group) => group.date > lastSoon),
    held: amountOf(of(held).map(payoutOf)),
    retained: retainedOf(of(retained)),
    deposited: depositedOf(of(deposited)),
  };
}
