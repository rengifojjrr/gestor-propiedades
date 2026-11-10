/**
 * Guardas para los textos libres: aquí no se guardan números de tarjeta ni de cuenta, y los links son solo http(s).
 */

const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;

/**
 * Las dos maneras de partir un número en grupos al escribirlo, cada una con sus tramos (`runs`: grupos de dígitos
 * seguidos) y lo que separa un grupo del siguiente:
 *
 * 1. espacios —también el duro y los demás de Unicode—, tabuladores y guiones o rayas, mezclados y los que sean
 *    («4111 1111-1111  1111», «4111 - 1111 - 1111 - 1111»);
 * 2. un punto («4111.1111.1111.1111»).
 *
 * El punto no se mezcla con los demás a propósito: si no, «100.00 200.00 300.00 150.00» serían ocho grupos seguidos
 * y la mitad de las listas de montos parecerían una tarjeta. El salto de línea no une grupos.
 */
const GROUPINGS = [
  { runs: /\d+(?:[\p{Zs}\t\p{Pd}]+\d+)*/gu, separator: /[\p{Zs}\t\p{Pd}]+/u },
  { runs: /\d+(?:\.\d+)*/g, separator: /\./ },
] as const;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  [...digits].reverse().forEach((char, position) => {
    const digit = Number(char);
    const doubled = digit * 2;
    sum += position % 2 === 0 ? digit : doubled > 9 ? doubled - 9 : doubled;
  });
  return sum % 10 === 0;
}

/** ¿Algún grupo, o varios grupos seguidos y enteros, suman 13–19 dígitos que pasan Luhn? */
function hasCardWindow(groups: readonly string[]): boolean {
  return groups.some((_, start) => {
    let digits = "";
    // Cada grupo trae al menos un dígito: con 19 grupos ya se llegó al tope.
    for (const group of groups.slice(start, start + CARD_MAX_DIGITS)) {
      digits += group;
      if (digits.length > CARD_MAX_DIGITS) return false;
      if (digits.length >= CARD_MIN_DIGITS && passesLuhn(digits)) return true;
    }
    return false;
  });
}

/**
 * ¿El texto trae algo con pinta de número de tarjeta? 13–19 dígitos que pasan Luhn, seguidos o en grupos (ver
 * `GROUPINGS`), aunque lleven otro número al lado: el CVV, el vencimiento, una fecha o un número de pedido
 * («4111 1111 1111 1111 123», «pedido 7 4111-1111-1111-1111»).
 *
 * Los grupos se prueban enteros: no se busca una tarjeta dentro de un número largo escrito sin separar, porque
 * cualquier referencia de 20 dígitos o más daría casi siempre un falso positivo.
 */
export function looksLikeCardNumber(text: string): boolean {
  return GROUPINGS.some(({ runs, separator }) =>
    (text.match(runs) ?? []).some((run) => hasCardWindow(run.split(separator))),
  );
}

/** ¿Hay `min` o más dígitos seguidos (7 por defecto)? Así se detecta un número de cuenta en un alias. */
export function hasLongDigitRun(text: string, min = 7): boolean {
  return (text.match(/\d+/g) ?? []).some((run) => run.length >= min);
}

/** ¿Es un link `http://` o `https://` bien formado? */
export function isHttpUrl(text: string): boolean {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}
