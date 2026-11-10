/**
 * Guardas para los textos libres: aquí no se guardan números de tarjeta ni de cuenta, y los links son solo http(s).
 */

const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;

/** Los grupos en que se escribe una tarjeta tienen de 4 a 6 dígitos: 4-4-4-4, 4-6-5, 4-6-4. */
const CARD_GROUP_MIN_DIGITS = 4;
const CARD_GROUP_MAX_DIGITS = 6;

/** Un tramo simple: dígitos con, como mucho, un espacio o un guion entre uno y el siguiente. */
const PLAIN_RUNS = /\d(?:[ -]?\d)*/g;

/**
 * Las dos maneras de partir un número en grupos al escribirlo, cada una con sus tramos (`runs`: grupos de dígitos
 * seguidos) y lo que separa un grupo del siguiente:
 *
 * 1. espacios —también el duro y los demás de Unicode—, tabuladores y guiones o rayas, mezclados y los que sean
 *    («4111 1111-1111  1111», «4111 - 1111 - 1111 - 1111»);
 * 2. un punto («4111.1111.1111.1111»).
 *
 * El punto no se mezcla con los demás a propósito: en «4012.5000 3998.2500» hay dos números con decimales, no
 * cuatro grupos seguidos. El salto de línea no une grupos.
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

/** ¿Son 13–19 dígitos que pasan Luhn? */
function isCardNumber(digits: string): boolean {
  return digits.length >= CARD_MIN_DIGITS && digits.length <= CARD_MAX_DIGITS && passesLuhn(digits);
}

/**
 * Los bloques de grupos de tarjeta (4–6 dígitos) seguidos; cualquier otro grupo, más corto o más largo, corta el
 * bloque. Puede salir alguno vacío: no tiene dígitos y no parece nada.
 */
function cardGroupBlocks(groups: readonly string[]): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const group of groups) {
    if (group.length >= CARD_GROUP_MIN_DIGITS && group.length <= CARD_GROUP_MAX_DIGITS) {
      block.push(group);
    } else {
      blocks.push(block);
      block = [];
    }
  }
  return [...blocks, block];
}

/**
 * ¿Hay entre estos grupos una tarjeta con su forma de siempre? O un número de 13–19 dígitos de corrido, o un bloque
 * de grupos de tarjeta, entero o sin UNO de los grupos de sus extremos (el vecino largo que puede llevar).
 */
function hasCardShape(groups: readonly string[]): boolean {
  return (
    groups.some(isCardNumber) ||
    cardGroupBlocks(groups).some((block) =>
      [block, block.slice(1), block.slice(0, -1)].some((window) => isCardNumber(window.join(""))),
    )
  );
}

/**
 * ¿El texto trae algo con pinta de número de tarjeta? Son 13–19 dígitos que pasan Luhn, escritos de una de estas
 * maneras:
 *
 * 1. Un tramo simple entero (`PLAIN_RUNS`), se agrupe como se agrupe: «4111111111111111», «4111-1111-1111-1111»,
 *    «4 1 1 1 …», «4174 1798 6615 4434 292».
 * 2. Un número de corrido, lleve lo que lleve al lado: «4111111111111111 123», «20261109 4111111111111111».
 * 3. Grupos de 4 a 6 dígitos seguidos, separados como dice `GROUPINGS`, con el número que sea al lado si es corto
 *    (el CVV, el vencimiento, el día) o muy largo, y con UN solo vecino de 4 a 6 dígitos pegado como mucho (el año,
 *    un pedido, el código de 4 de algunas tarjetas): «4111 1111 1111 1111 123», «pedido 7 4111-1111-1111-1111»,
 *    «3782 822463 10005 1234», «4111.1111.1111.1111».
 *
 * No se prueba cada ventana de grupos contiguos, aunque así se vería cualquier tarjeta con cualquier vecino: cada
 * ventana de 13–19 dígitos pasa Luhn una vez de cada diez, y dos teléfonos, tres fechas o seis montos seguidos
 * tienen tantas que se marcaban entre el 20 % y el 60 % de las veces. Con estas tres formas no se marcan nunca.
 * Se sigue marcando, una vez de cada diez, lo que solo Luhn distingue de una tarjeta: 13–19 dígitos en un tramo
 * simple («2026-11-03 2026-11-28») o cuatro montos de 4 cifras seguidos (con cinco, dos veces de cada diez).
 *
 * A cambio, se deja pasar una tarjeta en grupos con dos o más vecinos de 4 a 6 dígitos pegados (también otra
 * tarjeta en grupos, sin nada más que un espacio en medio) y una que, además de llevar otro número al lado, esté
 * partida de otra manera (dígito a dígito, 4-4-4-4-3, grupos de 8). Tampoco se busca dentro de un número más largo
 * escrito sin separar. `guards.test.ts` tiene un ejemplo de cada caso.
 */
export function looksLikeCardNumber(text: string): boolean {
  return (
    (text.match(PLAIN_RUNS) ?? []).some((run) => isCardNumber(run.replace(/[ -]/g, ""))) ||
    GROUPINGS.some(({ runs, separator }) =>
      (text.match(runs) ?? []).some((run) => hasCardShape(run.split(separator))),
    )
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
