import { dec } from "@/lib/pasarelas/decimal";
import type { DayType } from "@/lib/pasarelas/types";

/** Los días de la vista de totales («3.67») con un decimal y coma, sin ceros de relleno: «3,7», «3». */
export function formatDays(days: string): string {
  return dec(days).toDecimalPlaces(1).toString().replace(".", ",");
}

/** «2 días hábiles», «1 día corrido»: la unidad concuerda con el número. */
function daysText(days: number, type: DayType): string {
  const one = days === 1;
  const kind = type === "habiles" ? (one ? "hábil" : "hábiles") : one ? "corrido" : "corridos";
  return `${days} ${one ? "día" : "días"} ${kind}`;
}

/**
 * Cuándo cae el dinero: «2 días hábiles», «1 día corrido», «El mismo día» o, con un máximo mayor (una ventana),
 * «De 3 a 5 días hábiles». Sin máximo, o igual al mínimo, un solo día.
 */
export function payoutText(days: number, type: DayType, max: number | null = null): string {
  if (max !== null && max > days) return `De ${days} a ${daysText(max, type)}`;
  return days === 0 ? "El mismo día" : daysText(days, type);
}
