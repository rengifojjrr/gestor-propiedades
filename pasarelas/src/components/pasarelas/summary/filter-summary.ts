import { PERIOD_PRESETS } from "@/components/ui/url";
import type { Currency } from "@/lib/pasarelas/types";

/**
 * Lo que dice el botón «Filtros» del celular con los filtros plegados: el período, la moneda en que se pinta todo y
 * cuántos filtros más hay activos. `period` es el valor de `periodo` en la URL (sin él, o sin entenderlo, rige
 * «Este mes», como en la lista); `others`, cuántos de empresa, canal y pasarela filtran.
 */
export function filterSummary({
  period,
  currency,
  others,
}: {
  period: string | undefined;
  currency: Currency | null;
  others: number;
}): string {
  const preset = PERIOD_PRESETS.find((option) => option.value === period) ?? PERIOD_PRESETS[0];
  const parts: string[] = [preset.value === "personalizado" ? "Fechas elegidas" : preset.label];
  if (currency !== null) parts.push(currency);
  if (others > 0) parts.push(`${others} ${others === 1 ? "filtro" : "filtros"} más`);
  return parts.join(" · ");
}
