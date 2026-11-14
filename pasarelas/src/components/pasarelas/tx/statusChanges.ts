import { formatDate } from "@/lib/pasarelas/dates";
import { formatMoney } from "@/lib/pasarelas/money";
import type { Currency, ISODate, Money } from "@/lib/pasarelas/types";
import { allowedActions, refundedInFull, type AllowedInput, type TxAction } from "./allowed";

/**
 * Los cambios de estado que ofrece el menú de cada cobro de la lista, en el orden en que se enseñan (el mismo de
 * `TX_ACTIONS`). Son acciones del detalle: si se ofrecen o no lo dice `allowedActions`, como en `TxActions`.
 */
export const STATUS_CHANGES = [
  "en_transito",
  "depositado",
  "revertir_deposito",
  "fallido",
  "reabrir",
] as const satisfies readonly TxAction[];

export type StatusChange = (typeof STATUS_CHANGES)[number];

/** Lo que dice cada opción del menú. Los puntos suspensivos: abre un diálogo que pide la fecha del depósito. */
export const STATUS_CHANGE_LABEL: Record<StatusChange, string> = {
  en_transito: "Pasar a en tránsito",
  depositado: "Marcar depositado…",
  revertir_deposito: "Revertir el depósito",
  fallido: "Marcar como fallido",
  reabrir: "Reabrir",
};

/**
 * Lo que se pregunta antes de revertir un depósito, igual en el detalle (`TxActions`) y en el menú de la lista: el
 * cobro vuelve a «en tránsito» y se pierde la fecha real del depósito.
 */
export const REVERT_DEPOSIT_CONFIRM = {
  title: "¿Revertir el depósito?",
  description: "El cobro vuelve a «En tránsito» y se borra la fecha real del depósito.",
  confirmLabel: "Revertir depósito",
} as const;

/** Lo que lleva el cobro hacia el banco: con un reembolso total no hay depósito, y no se ofrece. */
const TOWARD_DEPOSIT: ReadonlySet<StatusChange> = new Set(["en_transito", "depositado"]);

/**
 * Los cambios de estado que el motor admite para ese cobro (`allowedActions`). En uno ya depositado, «Marcar
 * depositado» solo cambiaría la fecha del depósito, no el estado: eso queda en el detalle. Reembolsado del todo
 * (`refundedInFull`) no hay depósito que esperar: ni «Pasar a en tránsito» ni «Marcar depositado…» (lo ya depositado
 * se sigue pudiendo revertir). En la papelera no sale ninguno (ahí solo se restaura): ese cobro no tiene menú.
 */
export function statusChanges(tx: AllowedInput): StatusChange[] {
  const allowed = new Set<TxAction>(allowedActions(tx));
  const noDeposit = refundedInFull(tx);
  return STATUS_CHANGES.filter(
    (change) =>
      allowed.has(change) &&
      !(change === "depositado" && tx.status === "depositado") &&
      !(noDeposit && TOWARD_DEPOSIT.has(change)),
  );
}

/**
 * Cómo se nombra un cobro en la lista, igual en el enlace a su detalle, en su casilla y en su menú de estado: con lo
 * que enseña su fila. Su referencia (única en su pasarela) o, si no tiene, su fecha y su bruto vigente, el de la
 * columna Bruto: con un reembolso, ya no es lo cobrado al principio.
 */
export function txName(tx: { reference: string | null; gross: Money; currency: Currency; occurredOn: ISODate }): string {
  return tx.reference ?? `del ${formatDate(tx.occurredOn)} por ${formatMoney(tx.gross, tx.currency)}`;
}

