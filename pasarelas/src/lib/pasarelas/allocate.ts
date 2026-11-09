/**
 * Reparto por «mayor resto»: la suma de las partes es EXACTAMENTE la base, al centavo.
 * Se trabaja en centavos enteros con Decimal; nunca con `number`.
 */
import { D, dec, isMoney, toMoney } from "./decimal";
import type { Money, Pct } from "./types";

/**
 * Reparte `base` según `pcts` (que deben sumar exactamente 100). Cada parte se trunca a centavos y los centavos
 * que sobran van uno a uno a las de mayor resto; en empate gana la primera. Si la base es negativa se reparte
 * su valor absoluto y se cambia el signo.
 */
export function allocate(base: Money, pcts: readonly Pct[]): Money[] {
  if (!isMoney(base)) throw new RangeError(`La base del reparto no es un monto con dos decimales: «${base}»`);
  const weights = pcts.map((pct) => dec(pct));
  if (weights.some((weight) => weight.lt(0))) throw new RangeError("Un porcentaje del reparto es negativo");
  const total = weights.reduce((sum, weight) => sum.plus(weight), new D(0));
  if (!total.eq(100)) throw new RangeError(`Los porcentajes del reparto suman ${total.toFixed()}, no 100`);

  const amount = dec(base);
  const cents = amount.abs().times(100);
  const parts = weights.map((weight, index) => {
    const exact = cents.times(weight).div(100);
    const whole = exact.toDecimalPlaces(0, D.ROUND_DOWN);
    return { index, whole, rest: exact.minus(whole) };
  });
  // Centavos que sobran tras truncar: siempre menos que el número de partes.
  const spare = cents.minus(parts.reduce((sum, part) => sum.plus(part.whole), new D(0)));
  // De mayor a menor resto. El orden es estable: en empate queda antes la que venía primero.
  const byRest = [...parts].sort((a, b) => b.rest.cmp(a.rest));
  const winners = new Set(byRest.filter((_, position) => spare.gt(position)).map((part) => part.index));

  const sign = amount.isNegative() ? -1 : 1;
  return parts.map((part) => toMoney(part.whole.plus(winners.has(part.index) ? 1 : 0).times(sign).div(100)));
}
