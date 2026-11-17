import { PERIOD_PRESETS } from "@/components/ui/url";
import type { PeriodPreset } from "@/lib/pasarelas/dates";

/**
 * El período de la lista de Cobros, que puede ser de la venta (lo de siempre) o del depósito (`fechas=deposito`).
 * A los períodos de siempre se suman ayer y hoy y, solo por depósito —el dinero que va a caer—, mañana y los próximos
 * 7 días: con la venta no hay ventas futuras que buscar. Son solo de Cobros: el Resumen y Cargadores siguen con los
 * de siempre. Lo mismo lee el servidor (`parseTxFilters`): con la venta, mañana y los próximos 7 días son «Este mes».
 */

/** La línea discreta que explica qué fecha cuenta con «El depósito». */
export const DEPOSIT_HINT =
  "Por depósito: la fecha en que lo marcaste depositado o, si no, la estimada (el último día de su ventana).";

/** De qué son las fechas, con el valor de `fechas` en la URL (vacío = la venta). */
export const DATE_BASES = [
  { value: "", label: "La venta" },
  { value: "deposito", label: "El depósito" },
] as const;

type PeriodOption = { value: PeriodPreset; label: string };

const QUICK: readonly (PeriodOption & { future: boolean })[] = [
  { value: "ayer", label: "Ayer", future: false },
  { value: "hoy", label: "Hoy", future: false },
  { value: "manana", label: "Mañana", future: true },
  { value: "proximos_7d", label: "Próximos 7 días", future: true },
];

const FUTURE = new Set<string>(QUICK.filter((option) => option.future).map((option) => option.value));

/** Los períodos que se ofrecen: los de un día y los próximos 7 días primero; después, los de siempre. */
export function periodOptions(byDeposit: boolean): PeriodOption[] {
  return [...QUICK.filter((option) => byDeposit || !option.future), ...PERIOD_PRESETS];
}

/** El período que se ve: el de la URL si se ofrece con esas fechas; si no, «Este mes» (como lo lee el servidor). */
export function shownPeriod(requested: string | null, byDeposit: boolean): PeriodPreset {
  return periodOptions(byDeposit).find((option) => option.value === requested)?.value ?? "este_mes";
}

/** Los cambios en la URL al elegir un período: los fijos borran las fechas elegidas a mano. */
export function periodChangesOf(period: PeriodPreset): Record<string, string | null> {
  return period === "personalizado" ? { periodo: period } : { periodo: period, desde: null, hasta: null };
}

/** Los cambios en la URL al elegir de qué son las fechas: volver a la venta con un período futuro deja «Este mes». */
export function basisChanges(byDeposit: boolean, period: string | null): Record<string, string | null> {
  if (byDeposit) return { fechas: "deposito" };
  return period !== null && FUTURE.has(period) ? { fechas: null, periodo: "este_mes" } : { fechas: null };
}
