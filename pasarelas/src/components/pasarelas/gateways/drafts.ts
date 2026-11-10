import { formatAmount, formatPct } from "@/lib/pasarelas/money";
import type { DayType, ExtraBase, ExtraCfg } from "@/lib/pasarelas/types";

/*
 * Lo que se escribe en los formularios de Pasarelas, tal cual (texto): convertirlo y validarlo es cosa del
 * servidor. Los campos son controlados: React 19 vacía los que no lo son al terminar la acción de un `<form>`.
 */

export type GatewayDraft = {
  name: string;
  payoutDays: string;
  payoutDayType: DayType;
  refundsReturnFee: boolean;
  disputeFee: string;
  notes: string;
};

export type ExtraDraft = {
  name: string;
  pct: string;
  fixed: string;
  base: ExtraBase;
  defaultOn: boolean;
  payoutDaysOverride: string;
};

/** Los problemas de cada campo que devuelve una acción (`fieldErrors`). */
export type FieldErrors = Record<string, string[] | undefined> | undefined;

/**
 * Lo que dice un formulario cuando la llamada a su acción no llegó o no volvió (sin conexión). La petición pudo
 * llegar y perderse solo la respuesta: por eso no invita a repetir a ciegas.
 */
export const NETWORK_TEXT =
  "Se perdió la conexión y no se sabe si se guardó. Revísalo antes de repetirlo: lo escrito sigue aquí.";

/** El primer problema de un campo, para enseñarlo junto a él. */
export const firstError = (errors: FieldErrors, key: string): string | undefined => errors?.[key]?.[0];

export const EMPTY_GATEWAY: GatewayDraft = {
  name: "",
  payoutDays: "2",
  payoutDayType: "habiles",
  refundsReturnFee: false,
  disputeFee: "0,00",
  notes: "",
};

export const EMPTY_EXTRA: ExtraDraft = {
  name: "",
  pct: "",
  fixed: "0,00",
  base: "bruto",
  defaultOn: false,
  payoutDaysOverride: "",
};

/** Un porcentaje o un monto ya guardados, como se vuelven a escribir en un campo («2,9», «0,30»). */
export const pctDraft = (pct: string): string => formatPct(pct).replace(" %", "");
export const moneyDraft = (money: string): string => formatAmount(money);

/** Una opción guardada, como borrador para editarla. */
export function extraDraft(extra: ExtraCfg): ExtraDraft {
  return {
    name: extra.name,
    pct: pctDraft(extra.pct),
    fixed: moneyDraft(extra.fixed),
    base: extra.base,
    defaultOn: extra.defaultOn,
    payoutDaysOverride: extra.payoutDaysOverride === null ? "" : String(extra.payoutDaysOverride),
  };
}

/** Lo que se le manda a la acción de una opción guardada (para cambiarle solo un dato, como el interruptor). */
export function extraInput(extra: ExtraCfg) {
  return {
    name: extra.name,
    pct: extra.pct,
    fixed: extra.fixed,
    base: extra.base,
    defaultOn: extra.defaultOn,
    payoutDaysOverride: extra.payoutDaysOverride === null ? null : String(extra.payoutDaysOverride),
    active: extra.active,
  };
}

/** «Sobre el bruto» / «Sobre el bruto menos la comisión». */
export const BASE_LABEL: Record<ExtraBase, string> = {
  bruto: "Sobre el bruto",
  despues_de_comision: "Sobre el bruto menos la comisión",
};
