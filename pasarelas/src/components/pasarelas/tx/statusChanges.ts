import { formatDate } from "@/lib/pasarelas/dates";
import { formatMoney } from "@/lib/pasarelas/money";
import type { Currency, ISODate, Money } from "@/lib/pasarelas/types";
import { allowedActions, type AllowedInput, type TxAction } from "./allowed";

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
 * Los cambios de estado que el motor admite para ese cobro (`allowedActions`). En uno ya depositado, «Marcar
 * depositado» solo cambiaría la fecha del depósito, no el estado: eso queda en el detalle. En la papelera no sale
 * ninguno (ahí solo se restaura): ese cobro no tiene menú.
 */
export function statusChanges(tx: AllowedInput): StatusChange[] {
  const allowed = new Set<TxAction>(allowedActions(tx));
  return STATUS_CHANGES.filter(
    (change) => allowed.has(change) && !(change === "depositado" && tx.status === "depositado"),
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

