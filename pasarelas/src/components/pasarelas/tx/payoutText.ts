import { formatDate } from "@/lib/pasarelas/dates";
import { cmp, formatMoney, neg } from "@/lib/pasarelas/money";
import type { PayoutStatus } from "@/lib/pasarelas/payouts";
import type { Currency, ISODate, Money } from "@/lib/pasarelas/types";

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
 * cubre varios, cuáles se desmarcan y cuánto de cada uno. Una devolución (negativa) se nombra como tal.
 */
export function undoPayoutText(p: UndoPayment): string {
  const refund = cmp(p.amount, "0.00") < 0;
  const money = (amount: Money) => formatMoney(refund ? neg(amount) : amount, p.currency);
  const what = refund ? `la devolución de ${p.beneficiaryName}` : `el pago a ${p.beneficiaryName}`;
  const head = `${what} de ${money(p.amount)} del ${formatDate(p.paidOn)}`;
  if (p.others.length === 0) {
    const back = refund ? "vuelve a quedar como estaba" : "vuelve a faltarle eso";
    return `Se borra ${head}, y en este cobro ${back}. No se puede deshacer.`;
  }
  const count = p.others.length + 1;
  const all = COUNT_WORDS[count] ?? `los ${count}`;
  const covered = [
    `este (${money(p.here)})`,
    ...p.others.map((tx) => `${coveredTxName(tx)} (${money(tx.amount)})`),
  ];
  const sentence = `${head.charAt(0).toUpperCase()}${head.slice(1)}`;
  return `${sentence} cubre ${count} cobros, y se desmarcan ${all}: ${listed(covered)}. No se puede deshacer.`;
}
