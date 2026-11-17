import { formatDate } from "@/lib/pasarelas/dates";
import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp, formatMoney, neg } from "@/lib/pasarelas/money";
import type { PayoutStatus } from "@/lib/pasarelas/payouts";
import type { Currency, ISODate, Money } from "@/lib/pasarelas/types";
import { cobros } from "./plural";

/**
 * Los textos de los pagos a las partes del reparto: la marca de la lista y lo que dice «Deshacer». Funciones puras:
 * las usan el servidor y el navegador.
 */

/** La marca de un cobro en la lista: «Reparto pagado», o «Reparto: 2 de 4 pagados». */
export function payoutMarkText(status: PayoutStatus): string {
  const total = status.parts.length;
  if (!status.pending) return "Reparto pagado";
  return `Reparto: ${status.paidCount} de ${total} ${total === 1 ? "pagado" : "pagados"}`;
}

/** Un monto sin su signo, como se dice en un texto que ya dice qué es («Devolvió…», «descuento de…»). */
export function unsigned(amount: Money): Money {
  return cmp(amount, ZERO) < 0 ? neg(amount) : amount;
}

/**
 * ¿Lo de un cobro va en contra de su liquidación? Un pago (total positivo) paga la falta NETA de una parte: lo que
 * se le pagó de más en un cobro entra con monto negativo y se descuenta del pago. Una devolución (total negativo)
 * puede llevar, igual, lo que se le debía en otro cobro, que se resta de lo que devuelve. Ni el total ni lo de un
 * cobro son nunca cero.
 */
export function isDiscount(total: Money, part: Money): boolean {
  return cmp(total, ZERO) * cmp(part, ZERO) < 0;
}

/** Otro cobro que paga una liquidación, como lo leen las pantallas. */
export type CoveredTx = {
  occurredOn: ISODate;
  grossOriginal: Money;
  currency: Currency;
  reference: string | null;
};

/** «el cobro E10-b», o «el cobro del mar 10 nov 2026 por $1.000,00» si no tiene referencia. */
export function coveredTxName(tx: CoveredTx): string {
  return tx.reference === null
    ? `el cobro del ${formatDate(tx.occurredOn)} por ${formatMoney(tx.grossOriginal, tx.currency)}`
    : `el cobro ${tx.reference}`;
}

/** «este», «este y el otro», «este, el otro y el último». */
const listed = (parts: string[]): string => `${parts.slice(0, -1).join(", ")} y ${parts.at(-1) ?? ""}`;

const COUNT_WORDS = ["", "", "los dos", "los tres", "los cuatro", "los cinco"];

/** Un pago ligado a un cobro, como lo enseña «Deshacer» en el detalle de ese cobro. */
export type UndoPayment = {
  beneficiaryName: string;
  paidOn: ISODate;
  currency: Currency;
  /** El total de la liquidación. */
  amount: Money;
  /** Lo de este cobro. */
  here: Money;
  /** Los otros cobros que paga, con lo de cada uno. */
  others: readonly (CoveredTx & { amount: Money })[];
};

/**
 * Lo que dice la confirmación de «Deshacer»: si el pago es solo de este cobro, que se borra y vuelve a faltar; si
 * cubre varios, cuáles se desmarcan y cuánto de cada uno. Qué se deshace lo dice el total: un pago, o una devolución
 * (negativa), que se nombra como tal. Lo de un cobro que va en contra del total (`isDiscount`) se dice como descuento.
 */
export function undoPayoutText(p: UndoPayment): string {
  const refund = cmp(p.amount, ZERO) < 0;
  const money = (amount: Money) => formatMoney(unsigned(amount), p.currency);
  const part = (amount: Money) => (isDiscount(p.amount, amount) ? `descuento de ${money(amount)}` : money(amount));
  const what = refund ? `la devolución de ${p.beneficiaryName}` : `el pago a ${p.beneficiaryName}`;
  const head = `${what} de ${money(p.amount)} del ${formatDate(p.paidOn)}`;
  if (p.others.length === 0) {
    const back = refund ? "vuelve a quedar como estaba" : "vuelve a faltarle eso";
    return `Se borra ${head}, y en este cobro ${back}. No se puede deshacer.`;
  }
  const count = p.others.length + 1;
  const all = COUNT_WORDS[count] ?? `los ${count}`;
  const covered = [`este (${part(p.here)})`, ...p.others.map((tx) => `${coveredTxName(tx)} (${part(tx.amount)})`)];
  const sentence = `${head.charAt(0).toUpperCase()}${head.slice(1)}`;
  return `${sentence} cubre ${count} cobros, y se desmarcan ${all}: ${listed(covered)}. No se puede deshacer.`;
}

/**
 * Lo que dice «Pagar…» del «Reparto del filtro» cuando en algunos cobros a la parte se le pagó de más: cuánto, y
 * cómo se descuenta. Hasta 500 cobros, de este mismo pago. Con más (`apart`), `payoutChunks` lo registra en un pago
 * aparte, de monto negativo, que en la ficha de la parte sale como «Devolución»: lo dice antes de registrarlo.
 */
export function overpaidText(overpaid: { count: number; amount: Money; currency: Currency }, apart: boolean): string {
  const amount = formatMoney(overpaid.amount, overpaid.currency);
  const head = `En ${cobros(overpaid.count)} del filtro se le pagó de más ${amount}`;
  return apart
    ? `${head}: se descuenta del total y va en un pago aparte, que en su ficha sale como «Devolución».`
    : `${head}: se descuenta de este pago.`;
}
