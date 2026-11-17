import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp } from "@/lib/pasarelas/money";
import type { Money } from "@/lib/pasarelas/types";

/**
 * Los límites de los pagos a las partes del reparto, para el navegador y para el servidor: la acción
 * `recordPayouts` los exige y «Pagar…» del «Reparto del filtro» parte un pago grande para caber en ellos.
 */

/** Los cobros de un pago (una liquidación) como mucho: una página de la lista de Cobros cabe holgada. */
export const MAX_PAYOUT_ITEMS = 500;

/** Los pagos de una sola llamada como mucho (`pay_record_payouts`): se guardan todos juntos, o ninguno. */
export const MAX_PAYOUTS = 200;

/** En tramos de hasta `MAX_PAYOUT_ITEMS`, en su orden: los primeros llenos y el último con lo que queda. */
function slices<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += MAX_PAYOUT_ITEMS) {
    chunks.push(items.slice(start, start + MAX_PAYOUT_ITEMS));
  }
  return chunks;
}

/**
 * Lo de cada cobro (con su signo: negativo, lo que se le pagó de más y se descuenta) partido en pagos de hasta
 * `MAX_PAYOUT_ITEMS` cobros. Hasta 500, un solo pago con todo: lo pagado de más se descuenta ahí, como en «Pagar
 * repartos…». Con más, lo que se le paga y lo que se le descuenta van en pagos aparte, cada uno en tramos de 500 en
 * su orden (primero lo que se le paga): ningún pago puede sumar cero (la base no lo deja). Ninguno vacío.
 */
export function payoutChunks<T extends { amount: Money }>(items: readonly T[]): T[][] {
  if (items.length <= MAX_PAYOUT_ITEMS) return items.length === 0 ? [] : [[...items]];
  const discounted = (item: T) => cmp(item.amount, ZERO) < 0;
  return [...slices(items.filter((item) => !discounted(item))), ...slices(items.filter(discounted))];
}
