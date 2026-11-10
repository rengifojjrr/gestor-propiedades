/**
 * Leer, mostrar y operar montos y porcentajes. Todo entra y sale como texto; la aritmética va con `D`.
 * El formato no usa `Intl` para que servidor y navegador den exactamente lo mismo.
 */
import { D, ZERO, dec, normPct, toMoney } from "./decimal";
import type { Currency, Money, Pct } from "./types";

// ─── Leer lo que escribe una persona (o trae un CSV) ────────────────────────────────────────────────────────

/**
 * Un signo y un símbolo como mucho: por delante en cualquier orden («-$3,20», «$-3.20») o el símbolo por detrás
 * («5,00 €»). El cuerpo empieza por un dígito y solo lleva dígitos, comas y puntos.
 */
const MONEY_INPUT = /^(?:(?:[+-]?[$€]?|[$€][+-])\d[\d.,]*|[+-]?\d[\d.,]*[$€])$/;
const ONE_OR_TWO_DIGITS = /^\d{1,2}$/;
/** Miles bien agrupados: un primer grupo de 1 a 3 dígitos que no empieza por cero y luego grupos de 3. */
const GROUPED = { ",": /^[1-9]\d{0,2}(,\d{3})+$/, ".": /^[1-9]\d{0,2}(\.\d{3})+$/ } as const;

/** «1.234.567» con su separador de miles → "1234567"; si los grupos no son de miles, null. */
function ungroup(text: string, separator: "," | "."): string | null {
  return GROUPED[separator].test(text) ? text.replaceAll(separator, "") : null;
}

/** Dígitos con comas y puntos → decimal con punto, o null si es ambiguo o inválido. */
function plainDecimal(body: string): string | null {
  const lastComma = body.lastIndexOf(",");
  const lastDot = body.lastIndexOf(".");
  if (lastComma === -1 && lastDot === -1) return body;

  if (lastComma !== -1 && lastDot !== -1) {
    // Hay coma y punto: el último es el decimal y el otro separa miles.
    const decimalAt = Math.max(lastComma, lastDot);
    const whole = ungroup(body.slice(0, decimalAt), lastComma > lastDot ? "." : ",");
    const cents = body.slice(decimalAt + 1);
    return whole !== null && ONE_OR_TWO_DIGITS.test(cents) ? `${whole}.${cents}` : null;
  }

  // Un solo tipo de separador.
  const separator = lastComma === -1 ? "." : ",";
  const first = body.indexOf(separator);
  const tail = body.slice(first + 1);
  // Una sola vez y seguido de 1 o 2 dígitos: es el decimal. En cualquier otro caso tiene que separar miles.
  return ONE_OR_TWO_DIGITS.test(tail) ? `${body.slice(0, first)}.${tail}` : ungroup(body, separator);
}

/**
 * Lee un monto escrito a mano: admite espacios, `$`, `€` y signo. Si hay coma y punto, el último es el decimal;
 * un solo separador seguido de exactamente 3 dígitos es de miles («1,234» → "1234.00"); seguido de 1 o 2 es decimal.
 * Más de 2 decimales, letras, vacío o cualquier cosa ambigua → null.
 */
export function parseMoney(input: string): Money | null {
  const text = input.replace(/\s/g, "");
  if (!MONEY_INPUT.test(text)) return null;
  const plain = plainDecimal(text.replace(/[-+$€]/g, ""));
  if (plain === null) return null;
  return toMoney(dec(text.includes("-") ? `-${plain}` : plain));
}

/** Lee un porcentaje: coma o punto decimal, `%` opcional, hasta 4 decimales. Fuera de 0–100 o inválido → null. */
export function parsePct(input: string): Pct | null {
  const text = input.replace(/\s/g, "").replace(/%$/, "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(text)) return null;
  const value = dec(text);
  return value.gt(100) ? null : normPct(value);
}

// ─── Mostrar ────────────────────────────────────────────────────────────────────────────────────────────────

/** Solo los símbolos que `parseMoney` sabe leer: lo que se muestra con símbolo se puede volver a escribir tal cual. */
const SYMBOLS = new Map<Currency, string>([
  ["USD", "$"],
  ["EUR", "€"],
]);

/** Miles con punto y decimales con coma: "1.234,56" · "-3,20". */
export function formatAmount(m: Money): string {
  const canonical = toMoney(dec(m));
  const whole = canonical.slice(0, -3).replace(/\B(?=(\d{3})+$)/g, ".");
  return `${whole},${canonical.slice(-2)}`;
}

/** "$1.234,56" · "-$3,20" · "€5,00" · "1.234,56 MXN" (las monedas sin símbolo llevan su código detrás). */
export function formatMoney(m: Money, currency: Currency): string {
  const amount = formatAmount(m);
  const sign = amount.startsWith("-") ? "-" : "";
  const digits = amount.slice(sign.length);
  const symbol = SYMBOLS.get(currency);
  return symbol === undefined ? `${sign}${digits} ${currency}` : `${sign}${symbol}${digits}`;
}

/** "2,9 %". */
export function formatPct(p: Pct): string {
  return `${normPct(p).replace(".", ",")} %`;
}

// ─── Operar ─────────────────────────────────────────────────────────────────────────────────────────────────

export function add(...xs: Money[]): Money {
  return toMoney(xs.reduce((total, x) => total.plus(dec(x)), new D(0)));
}

export function sub(a: Money, b: Money): Money {
  return toMoney(dec(a).minus(dec(b)));
}

export function neg(a: Money): Money {
  return toMoney(dec(a).negated());
}

export function cmp(a: Money, b: Money): -1 | 0 | 1 {
  return dec(a).cmp(dec(b)) as -1 | 0 | 1;
}

export function isZero(a: Money): boolean {
  return dec(a).isZero();
}

/** Suma por moneda: nunca mezcla monedas distintas. Las claves salen en el orden en que aparece cada moneda. */
export function sumByCurrency<T>(
  rows: readonly T[],
  currencyOf: (r: T) => Currency,
  amountOf: (r: T) => Money,
): Record<Currency, Money> {
  const totals = new Map<Currency, Money>();
  for (const row of rows) {
    const currency = currencyOf(row);
    totals.set(currency, add(totals.get(currency) ?? ZERO, amountOf(row)));
  }
  return Object.fromEntries(totals);
}

/** Qué porcentaje es `part` de `whole`, redondeado a `decimals` (2 por defecto). Si `whole` es 0 → null. */
export function pctOf(part: Money, whole: Money, decimals = 2): Pct | null {
  const total = dec(whole);
  if (total.isZero()) return null;
  return normPct(dec(part).div(total).times(100).toDecimalPlaces(decimals, D.ROUND_HALF_UP));
}
