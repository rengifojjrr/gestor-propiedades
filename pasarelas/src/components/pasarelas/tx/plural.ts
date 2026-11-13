// Solo el tipo (lo que devuelve `markDeposited`): no trae nada del servidor al navegador.
import type { DepositOutcome } from "@/server/pasarelas/ops/transactions";

/** «1 cobro», «3 cobros». */
export function cobros(count: number): string {
  return count === 1 ? "1 cobro" : `${count} cobros`;
}

/**
 * Lo que se dice tras una acción en lote: cuántos cambiaron (`done`, con el participio en singular y en plural) y,
 * si alguno de los elegidos no admitía el cambio, cuántos.
 */
export function batchDone(done: number, chosen: number, participle: { one: string; many: string }): string {
  const head = `${cobros(done)} ${done === 1 ? participle.one : participle.many}.`;
  const skipped = chosen - done;
  if (skipped <= 0) return head;
  return `${head} ${skipped === 1 ? "1 no admitía el cambio." : `${skipped} no admitían el cambio.`}`;
}

/** «a», «a y b», «a, b y c». */
const listed = (parts: string[]): string =>
  parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1) ?? ""}`;

/**
 * Lo que se dice tras marcar depositados: cuántos se marcaron y, si alguno se saltó, cuántos y por qué (ya estaban
 * depositados y conservan su fecha, no están por caer, o no admitían el cambio).
 */
export function depositDone({ count, skipped }: DepositOutcome): string {
  const head = `${cobros(count)} ${count === 1 ? "marcado como depositado" : "marcados como depositados"}.`;
  const { deposited, notPending, other } = skipped;
  const total = deposited + notPending + other;
  if (total === 0) return head;
  const reasons = [
    deposited === 0
      ? null
      : deposited === 1
        ? "1 ya estaba depositado (conserva su fecha)"
        : `${deposited} ya estaban depositados (conservan su fecha)`,
    notPending === 0
      ? null
      : `${notPending} ${notPending === 1 ? "no está" : "no están"} por caer (disputa abierta o reembolso total)`,
    other === 0 ? null : `${other} ${other === 1 ? "no admitía" : "no admitían"} el cambio`,
  ].filter((reason) => reason !== null);
  return `${head} ${total === 1 ? "Se saltó" : "Se saltaron"} ${total}: ${listed(reasons)}.`;
}

/**
 * Lo que se dice cuando el cambio pedido para un solo cobro no cambió nada: el cobro ya no lo admitía (la pantalla
 * estaba vieja). En el detalle y en el menú de estado de la lista.
 */
export const STALE_TEXT = "El cobro ya no admitía ese cambio. Vuelve a cargar la página para ver cómo está.";

/** Lo que se dice si el cambio quedó guardado pero las fechas estimadas no se pudieron volver a calcular. */
export const REFRESH_FAILED_TEXT =
  "No se pudieron actualizar las fechas estimadas: usa «Recalcular» en Cobros para ponerlas al día.";

/**
 * Lo que se dice tras un cambio que mueve las fechas estimadas de lo que está por caer (un feriado, los días de una
 * pasarela o de su cuenta en una empresa): `done` y cuántas fechas cambiaron (`refreshed`; nada si ninguna). Si
 * no se pudieron recalcular (`null`), el cambio sigue guardado y `error` lo dice aparte.
 */
export function savedWithRefresh(done: string, refreshed: number | null): { success: string; error: string | null } {
  if (refreshed === null) return { success: done, error: REFRESH_FAILED_TEXT };
  if (refreshed === 0) return { success: done, error: null };
  return { success: `${done} Se actualizó la fecha estimada de ${cobros(refreshed)} por caer.`, error: null };
}
