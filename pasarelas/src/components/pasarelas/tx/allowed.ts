import { cmp, isZero } from "@/lib/pasarelas/money";
import type { TxSnapshot } from "@/lib/pasarelas/types";

/**
 * Qué acciones admite un cobro según su estado, con las mismas reglas que los planes de `write.ts` (la prueba los
 * compara estado por estado). El detalle enseña solo estas: lo que el motor rechazaría no se ofrece.
 */

/** Las acciones del detalle de un cobro, en el orden en que se enseñan. */
export const TX_ACTIONS = [
  "editar",
  "fecha_estimada",
  "fecha_automatica",
  "en_transito",
  "depositado",
  "revertir_deposito",
  "reembolso",
  "corregir_reembolso",
  "abrir_disputa",
  "resolver_disputa",
  "fallido",
  "reabrir",
  "recalcular",
  "papelera",
  "restaurar",
] as const;

export type TxAction = (typeof TX_ACTIONS)[number];

export type AllowedInput = Pick<
  TxSnapshot,
  "status" | "disputeState" | "refunded" | "grossOriginal" | "deletedAt" | "estimatedIsManual"
>;

/** Las acciones que el motor acepta para ese cobro, en el orden de `TX_ACTIONS`. */
export function allowedActions(tx: AllowedInput): TxAction[] {
  // En la papelera solo se restaura (`requireNotTrashed`).
  if (tx.deletedAt !== null) return ["restaurar"];
  // Reembolsos, disputas, el depósito y recalcular piden un cobro que no haya fallado (`requireLive`).
  const live = tx.status !== "fallido";
  const refunded = !isZero(tx.refunded);
  const can: Record<TxAction, boolean> = {
    editar: true,
    fecha_estimada: true,
    // Si ya es la automática, volver a ella no cambia nada.
    fecha_automatica: tx.estimatedIsManual,
    en_transito: tx.status === "registrado",
    // Ya depositado, cambia la fecha del depósito (solo aquí: el lote salta lo ya depositado).
    depositado: live,
    revertir_deposito: tx.status === "depositado",
    // Queda algo por reembolsar.
    reembolso: live && cmp(tx.refunded, tx.grossOriginal) < 0,
    // Con la disputa perdida el reembolso es total y no admite otro valor.
    corregir_reembolso: live && refunded && tx.disputeState !== "perdida",
    abrir_disputa: live && (tx.disputeState === null || tx.disputeState === "ganada"),
    resolver_disputa: live && tx.disputeState === "abierta",
    fallido: (tx.status === "registrado" || tx.status === "en_transito") && !refunded && tx.disputeState === null,
    reabrir: tx.status === "fallido",
    recalcular: live,
    papelera: true,
    restaurar: false,
  };
  return TX_ACTIONS.filter((action) => can[action]);
}

/**
 * Reembolsado del todo: el bruto vigente quedó en 0. La pasarela ya devolvió el dinero, así que no hay depósito que
 * esperar: no está «Por caer» (`isPending` del motor, que lo ve como «Reembolsado»). Lo ya depositado antes del
 * reembolso sigue depositado. Un fallido también queda en 0, pero no por un reembolso: no cuenta.
 */
export function refundedInFull(tx: Pick<AllowedInput, "refunded" | "grossOriginal">): boolean {
  return cmp(tx.refunded, tx.grossOriginal) >= 0;
}

/**
 * La acción que el detalle deja a la vista; las demás van en «Más acciones». Es la que más se espera en ese estado:
 * restaurar lo que está en la papelera, reabrir un fallido, resolver una disputa abierta, marcar depositado lo que
 * todavía no lo está (salvo que se haya reembolsado del todo: ahí no hay depósito) y, si no, editar (que todo cobro
 * fuera de la papelera admite).
 */
export function primaryAction(tx: AllowedInput): TxAction {
  const can = allowedActions(tx);
  if (can.includes("restaurar")) return "restaurar";
  if (can.includes("reabrir")) return "reabrir";
  if (can.includes("resolver_disputa")) return "resolver_disputa";
  if (can.includes("depositado") && tx.status !== "depositado" && !refundedInFull(tx)) return "depositado";
  return "editar";
}
