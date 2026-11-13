import { formatWindowShort } from "@/lib/pasarelas/dates";
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

/** De qué cobro es el menú: «cobro de $675,00 del 12 nov» (lo cobrado y el día del cobro, sin el año). */
export function statusMenuSubject(tx: { grossOriginal: Money; currency: Currency; occurredOn: ISODate }): string {
  const day = formatWindowShort({ from: tx.occurredOn, to: tx.occurredOn });
  return `cobro de ${formatMoney(tx.grossOriginal, tx.currency)} del ${day}`;
}
