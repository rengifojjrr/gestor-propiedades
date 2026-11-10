import { ZERO } from "./decimal";
import { cmp } from "./money";
import type { DisplayStatus, ISODate, LeanTx, Lifecycle } from "./types";

/**
 * Estados del cobro. El ciclo del dinero (`status`) va separado del reembolso y de la disputa; lo que se muestra y
 * se filtra son los seis estados de siempre, derivados aquí. Los montos solo se comparan: aquí no hay aritmética.
 */

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  registrado: "Registrado",
  en_transito: "En tránsito",
  depositado: "Depositado",
  reembolsado: "Reembolsado",
  en_disputa: "En disputa",
  fallido: "Fallido",
};

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  registrado: "Registrado",
  en_transito: "En tránsito",
  depositado: "Depositado",
  fallido: "Fallido",
};

/**
 * El estado visible, en este orden: fallido → en disputa (disputa abierta) → reembolsado (reembolso total) →
 * depositado → en tránsito → registrado. El reembolso parcial no cambia el estado: es una etiqueta aparte.
 */
export function displayStatus(
  t: Pick<LeanTx, "status" | "disputeState" | "refunded" | "grossOriginal">,
): DisplayStatus {
  if (t.status === "fallido") return "fallido";
  if (t.disputeState === "abierta") return "en_disputa";
  if (cmp(t.refunded, t.grossOriginal) >= 0) return "reembolsado";
  return t.status;
}

/** Reembolso parcial: se devolvió algo, pero menos que el bruto original, y el cobro no falló. */
export function isPartialRefund(t: Pick<LeanTx, "status" | "refunded" | "grossOriginal">): boolean {
  return t.status !== "fallido" && cmp(t.refunded, ZERO) > 0 && cmp(t.refunded, t.grossOriginal) < 0;
}

/**
 * Por caer: lo que SE VE como registrado o en tránsito. Es la única definición, para la tarjeta, el filtro de la
 * lista, los próximos depósitos y lo atrasado. Un cobro con la disputa abierta (la pasarela retiene ese dinero) o
 * reembolsado por completo (ya lo devolvió) no está por caer aunque nunca se haya depositado; uno con reembolso
 * parcial sí, con su neto ya rebajado. Así, lo que está por caer siempre tiene bruto vigente mayor que cero.
 */
export function isPending(t: Pick<LeanTx, "status" | "disputeState" | "refunded" | "grossOriginal">): boolean {
  const shown = displayStatus(t);
  return shown === "registrado" || shown === "en_transito";
}

/** Atrasado: por caer y con la fecha estimada anterior a hoy. */
export function isOverdue(
  t: Pick<LeanTx, "status" | "disputeState" | "refunded" | "grossOriginal" | "estimatedDepositOn">,
  today: ISODate,
): boolean {
  return isPending(t) && t.estimatedDepositOn !== null && t.estimatedDepositOn < today;
}
