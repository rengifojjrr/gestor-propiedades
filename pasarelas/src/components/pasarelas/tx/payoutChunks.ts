/**
 * Los límites de los pagos a las partes del reparto, para el navegador y para el servidor: la acción
 * `recordPayouts` los exige y «Pagar…» del «Reparto del filtro» parte un pago grande para caber en ellos.
 */

/** Los cobros de un pago (una liquidación) como mucho: una página de la lista de Cobros cabe holgada. */
export const MAX_PAYOUT_ITEMS = 500;

/** Los pagos de una sola llamada como mucho (`pay_record_payouts`): se guardan todos juntos, o ninguno. */
export const MAX_PAYOUTS = 200;

/**
 * Lo de cada cobro partido en pagos de hasta `MAX_PAYOUT_ITEMS` cobros, en su orden: los primeros llenos y el último
 * con lo que queda. Ninguno vacío.
 */
export function payoutChunks<T>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += MAX_PAYOUT_ITEMS) {
    chunks.push(items.slice(start, start + MAX_PAYOUT_ITEMS));
  }
  return chunks;
}
