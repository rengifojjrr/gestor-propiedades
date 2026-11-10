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
