export type MoneyTone = "negative" | "zero" | "positive";

/**
 * Tono con el que se pinta un monto, mirando solo su texto canónico ("90.30", "-3.20", "0.00"):
 * aquí no se hace aritmética con dinero.
 */
export function moneyTone(value: string): MoneyTone {
  if (/^-?0+(\.0+)?$/.test(value)) return "zero";
  return value.startsWith("-") ? "negative" : "positive";
}
