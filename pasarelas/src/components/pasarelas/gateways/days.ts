import { dec } from "@/lib/pasarelas/decimal";
import type { DayType } from "@/lib/pasarelas/types";

/** Los días de la vista de totales («3.67») con un decimal y coma, sin ceros de relleno: «3,7», «3». */
export function formatDays(days: string): string {
  return dec(days).toDecimalPlaces(1).toString().replace(".", ",");
}

/** Cuándo cae el dinero: «2 días hábiles», «1 día corrido», «El mismo día». */
export function payoutText(days: number, type: DayType): string {
  if (days === 0) return "El mismo día";
  const one = days === 1;
  const kind = type === "habiles" ? (one ? "hábil" : "hábiles") : one ? "corrido" : "corridos";
  return `${days} ${one ? "día" : "días"} ${kind}`;
}
