import { dec } from "@/lib/pasarelas/decimal";

/**
 * Cuántos días tarda el dinero, como los da la base (`"2.50"`), para leerlos: con un decimal como mucho (mitad
 * hacia arriba, como el motor) y coma decimal: «2,5 días», «3 días», «1 día».
 */
export function formatDays(days: string): string {
  const rounded = dec(days).toDecimalPlaces(1);
  const text = rounded.toString().replace(".", ",");
  return rounded.eq(1) ? `${text} día` : `${text} días`;
}
