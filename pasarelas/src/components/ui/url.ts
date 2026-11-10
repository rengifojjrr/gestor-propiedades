/** Parámetro de la URL que lleva la página de una lista. Cambiar cualquier otro filtro lo quita. */
export const PAGE_PARAM = "pagina";

/**
 * Arma el enlace de la misma pantalla con otros filtros: aplica `changes` sobre los parámetros actuales
 * (un valor nulo o vacío quita el parámetro) y, si lo que cambia es un filtro, vuelve a la primera página.
 */
export function hrefWith(
  pathname: string,
  current: URLSearchParams | string,
  changes: Record<string, string | null | undefined>,
  pageParam: string = PAGE_PARAM,
): string {
  const params = new URLSearchParams(current);
  if (!(pageParam in changes)) params.delete(pageParam);
  for (const [name, value] of Object.entries(changes)) {
    if (value) params.set(name, value);
    else params.delete(name);
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Los períodos que entiende `periodRange` del motor, con el texto que ve el usuario. */
export const PERIOD_PRESETS = [
  { value: "este_mes", label: "Este mes" },
  { value: "mes_anterior", label: "El mes anterior" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "90d", label: "Últimos 90 días" },
  { value: "365d", label: "Últimos 365 días" },
  { value: "este_anio", label: "Este año" },
  { value: "personalizado", label: "Elegir fechas" },
] as const;

export type PeriodPresetValue = (typeof PERIOD_PRESETS)[number]["value"];

/** Cambios en la URL al elegir un período: los fijos borran las fechas elegidas a mano. */
export function periodChanges(preset: PeriodPresetValue): Record<string, string | null> {
  if (preset === "personalizado") return { periodo: preset };
  return { periodo: preset, desde: null, hasta: null };
}
