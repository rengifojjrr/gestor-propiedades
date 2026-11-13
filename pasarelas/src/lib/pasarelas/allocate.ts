/**
 * Reparto por «mayor resto»: la suma de las partes es EXACTAMENTE la base, al centavo.
 * Se trabaja en centavos enteros con Decimal; nunca con `number`.
 */
import type { Decimal } from "decimal.js";
import { D, dec, isMoney, toMoney } from "./decimal";
import type { Money, Pct } from "./types";

/** Los pesos leídos como decimales; ninguno negativo. */
function weightsOf(pcts: readonly Pct[]): Decimal[] {
  const weights = pcts.map((pct) => dec(pct));
  if (weights.some((weight) => weight.lt(0))) throw new RangeError("Un porcentaje del reparto es negativo");
  return weights;
}

/**
 * El mayor resto: cada parte (`base × peso ÷ total`) se trunca a centavos y los centavos que sobran van uno a uno
 * a las de mayor resto; en empate gana la primera. Si la base es negativa se reparte su valor absoluto y se cambia
 * el signo. Los restos se comparan exactos (el numerador de `centavos × peso ÷ total`), aunque la división no
 * termine: así un empate es un empate.
 */
function largestRemainder(base: Money, weights: readonly Decimal[], total: Decimal): Money[] {
  if (!isMoney(base)) throw new RangeError(`La base del reparto no es un monto con dos decimales: «${base}»`);
  const amount = dec(base);
  const cents = amount.abs().times(100);
  const parts = weights.map((weight, index) => {
    const share = cents.times(weight);
    const whole = share.divToInt(total);
    return { index, whole, rest: share.minus(whole.times(total)) };
  });
  // Centavos que sobran tras truncar: siempre menos que el número de partes.
  const spare = cents.minus(parts.reduce((sum, part) => sum.plus(part.whole), new D(0)));
  // De mayor a menor resto. El orden es estable: en empate queda antes la que venía primero.
  const byRest = [...parts].sort((a, b) => b.rest.cmp(a.rest));
  const winners = new Set(byRest.filter((_, position) => spare.gt(position)).map((part) => part.index));

  const sign = amount.isNegative() ? -1 : 1;
  return parts.map((part) => toMoney(part.whole.plus(winners.has(part.index) ? 1 : 0).times(sign).div(100)));
}

/**
 * Reparte `base` según `pcts` (que deben sumar exactamente 100). Cada parte se trunca a centavos y los centavos
 * que sobran van uno a uno a las de mayor resto; en empate gana la primera. Si la base es negativa se reparte
 * su valor absoluto y se cambia el signo.
 */
export function allocate(base: Money, pcts: readonly Pct[]): Money[] {
  const weights = weightsOf(pcts);
  const total = weights.reduce((sum, weight) => sum.plus(weight), new D(0));
  if (!total.eq(100)) throw new RangeError(`Los porcentajes del reparto suman ${total.toFixed()}, no 100`);
  return largestRemainder(base, weights, total);
}

/**
 * Reparte `base` en proporción a `weights`, que no tienen por qué sumar 100 (p. ej. los porcentajes de las partes
 * que pagan la comisión, cuando otra no la paga): el mismo mayor resto que `allocate`, sobre la suma de los pesos.
 * Lanza RangeError si ningún peso es mayor que cero.
 */
export function allocateInProportion(base: Money, weights: readonly Pct[]): Money[] {
  const values = weightsOf(weights);
  const total = values.reduce((sum, weight) => sum.plus(weight), new D(0));
  if (!total.gt(0)) throw new RangeError("No hay a quién repartir: ningún peso es mayor que cero");
  return largestRemainder(base, values, total);
}
