import { ZERO } from "@/lib/pasarelas/decimal";
import { add, cmp, formatMoney } from "@/lib/pasarelas/money";
import type { Currency, Money } from "@/lib/pasarelas/types";

/** Los textos del «Reparto del filtro» de Cobros y su tope. Funciones puras: las usan el servidor y el navegador. */

/**
 * Cuántos cobros suma como mucho el «Reparto del filtro» (y lee su «Pagar…»): con 5000, medio segundo en local. Con
 * más no se suma nada: se dice cuántos son y que hay que acotar el filtro, nunca las cifras de una parte presentadas
 * como si fueran todas.
 */
export const SPLIT_MAX = 5000;

/**
 * Lo que dice una moneda con el reparto plegado: «Falta pagar $1.135,35 a 2 partes» (lo que falta a quienes les falta
 * algo) o «Todo pagado»; si a alguna se le pagó de más, se dice aparte (no resta de lo que falta a las demás).
 */
export function splitLine(parties: readonly { owed: Money }[], currency: Currency): string {
  if (parties.length === 0) return "Sin partes del reparto";
  const owing = parties.filter((party) => cmp(party.owed, ZERO) > 0);
  const over = parties.filter((party) => cmp(party.owed, ZERO) < 0).length;
  const head =
    owing.length === 0
      ? "Todo pagado"
      : `Falta pagar ${formatMoney(add(ZERO, ...owing.map((party) => party.owed)), currency)} a ${owing.length} ${
          owing.length === 1 ? "parte" : "partes"
        }`;
  if (over === 0) return head;
  return `${head} · a ${over} ${over === 1 ? "se le" : "se les"} pagó de más`;
}

/** «Son 6234 cobros: el reparto se suma con hasta 5000. Acota el filtro (por ejemplo, por fechas) para verlo.» */
export function tooManyForSplitText(count: number): string {
  const fix = "Acota el filtro (por ejemplo, por fechas) para verlo.";
  return `Son ${count} cobros: el reparto se suma con hasta ${SPLIT_MAX}. ${fix}`;
}
