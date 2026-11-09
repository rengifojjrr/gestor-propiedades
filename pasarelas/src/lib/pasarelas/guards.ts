/**
 * Guardas para los textos libres: aquí no se guardan números de tarjeta ni de cuenta, y los links son solo http(s).
 */

/** Tramos de dígitos, con un espacio o un guion como mucho entre dígito y dígito. */
const DIGIT_RUNS = /\d(?:[ -]?\d)*/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  [...digits].reverse().forEach((char, position) => {
    const digit = Number(char);
    const doubled = digit * 2;
    sum += position % 2 === 0 ? digit : doubled > 9 ? doubled - 9 : doubled;
  });
  return sum % 10 === 0;
}

/** ¿El texto trae algo con pinta de número de tarjeta? 13–19 dígitos (con espacios o guiones) que pasan Luhn. */
export function looksLikeCardNumber(text: string): boolean {
  return (text.match(DIGIT_RUNS) ?? []).some((run) => {
    const digits = run.replace(/[ -]/g, "");
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
  });
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
