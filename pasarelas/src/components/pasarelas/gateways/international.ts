import { ZERO, dec, normPct, toMoney } from "@/lib/pasarelas/decimal";
import { cmp, formatMoney, formatPct, isZero, parseMoney, parsePct } from "@/lib/pasarelas/money";
import type { Currency, ExtraCfg, GatewayCfg, Money, Pct } from "@/lib/pasarelas/types";

/*
 * El recargo de una pasarela a los pagos internacionales. Se guarda como una opción de tipo `internacional` (a lo
 * más una encendida por pasarela) y, para el motor, es una opción como cualquier otra: porcentaje y fijo sobre el
 * bruto. Lo que cambia es cómo se elige: no es un interruptor más de «Opciones», sino la respuesta a «¿El pago fue
 * nacional o internacional?». Funciones puras: sin red, sin reloj y sin `number` para el dinero.
 */

/** De dónde fue el pago. */
export type Origin = "nacional" | "internacional";

export const ORIGIN_LABEL: Record<Origin, string> = { nacional: "Nacional", internacional: "Internacional" };

/** Un porcentaje y un fijo: una tarifa o un recargo. */
export type Fee = { pct: Pct; fixed: Money };

type WithExtras = Pick<GatewayCfg, "extras">;

/** ¿Es una opción de verdad? El recargo internacional (encendido o apagado) no se lista entre las opciones. */
export const isOption = (extra: Pick<ExtraCfg, "kind">): boolean => extra.kind === "opcion";

/** El recargo internacional encendido de la pasarela; `null` si no cobra (o si no hay pasarela). */
export function activeInternational(gateway: WithExtras | undefined): ExtraCfg | null {
  return gateway?.extras.find((extra) => extra.kind === "internacional" && extra.active) ?? null;
}

/**
 * De las opciones que aplicó un cobro: si una es un recargo internacional de la pasarela (el encendido o uno ya
 * apagado, que el cobro congeló así), cuál; y las demás aparte, en su orden.
 */
export function originOf(
  gateway: WithExtras | undefined,
  extraIds: readonly string[],
): { origin: Origin; international: ExtraCfg | null; optionIds: string[] } {
  const international =
    gateway?.extras.find((extra) => extra.kind === "internacional" && extraIds.includes(extra.id)) ?? null;
  return {
    origin: international === null ? "nacional" : "internacional",
    international,
    optionIds: extraIds.filter((id) => id !== international?.id),
  };
}

/** Las opciones que se aplican: las elegidas y, si el pago fue internacional y hay recargo, el recargo detrás. */
export function withOrigin(
  optionIds: readonly string[],
  international: Pick<ExtraCfg, "id"> | null,
  origin: Origin,
): string[] {
  return origin === "internacional" && international !== null ? [...optionIds, international.id] : [...optionIds];
}

/**
 * Lo que paga un pago internacional: la tarifa más el recargo (2,9 % + 0,30 con 1,5 % → 4,4 % + 0,30). Es la
 * cuenta para leerla de un vistazo: en el cobro, cada parte se redondea a centavos en su propia línea.
 */
export function internationalTotal(fee: Fee, surcharge: Fee): Fee {
  return {
    pct: normPct(dec(fee.pct).plus(dec(surcharge.pct))),
    fixed: toMoney(dec(fee.fixed).plus(dec(surcharge.fixed))),
  };
}

/** Un porcentaje y un fijo tal como se escriben («2,9», «0,30»); `null` si no se pueden leer o el fijo es negativo. */
function readFee(draft: { pct: string; fixed: string }): Fee | null {
  const pct = parsePct(draft.pct);
  const fixed = parseMoney(draft.fixed);
  if (pct === null || fixed === null || cmp(fixed, ZERO) < 0) return null;
  return { pct, fixed };
}

/** `internationalTotal` con lo escrito en los campos; `null` mientras algo no se pueda leer todavía. */
export function draftTotal(
  fee: { pct: string; fixed: string },
  surcharge: { pct: string; fixed: string },
): Fee | null {
  const base = readFee(fee);
  const extra = readFee(surcharge);
  return base === null || extra === null ? null : internationalTotal(base, extra);
}

/**
 * Lo que suma el recargo en la moneda del cobro, sin las partes en cero: «1,5 %», «1,5 % + $0,30», «€0,30». Un
 * recargo en cero (se puede guardar así) se lee «0 %».
 */
export function surchargeText(surcharge: Fee, currency: Currency): string {
  const parts = [
    isZero(surcharge.pct) ? null : formatPct(surcharge.pct),
    isZero(surcharge.fixed) ? null : formatMoney(surcharge.fixed, currency),
  ].filter((part) => part !== null);
  return parts.length === 0 ? formatPct(surcharge.pct) : parts.join(" + ");
}
