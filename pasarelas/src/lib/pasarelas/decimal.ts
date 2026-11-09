/**
 * La única puerta a decimal.js del motor. El dinero nunca pasa por `number`: entra y sale como texto,
 * y toda la aritmética se hace con `D`.
 */
import { Decimal } from "decimal.js";
import type { Money, Pct } from "./types";

/** Instancia propia (40 dígitos, mitad hacia arriba). No toca la configuración global de decimal.js. */
export const D: typeof Decimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const ZERO: Money = "0.00";

/** Dígitos con punto decimal opcional: sin exponentes, sin hexadecimales, sin espacios, sin «Infinity». */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;
const MONEY = /^-?\d+\.\d{2}$/;

/** Convierte a un decimal de `D`. Lanza RangeError si no es un decimal finito. */
export function dec(x: string | Decimal): Decimal {
  if (typeof x === "string" ? !PLAIN_DECIMAL.test(x) : !x.isFinite()) {
    throw new RangeError(`No es un decimal finito: «${String(x)}»`);
  }
  return new D(x);
}

/** Redondea a centavos, mitad hacia arriba. */
export function r2(x: Decimal): Decimal {
  return x.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

/**
 * Monto canónico con dos decimales. Nunca devuelve "-0.00": se redondea ANTES de escribir (−0,001 pasa a ser
 * cero, y decimal.js escribe el cero sin signo).
 */
export function toMoney(x: Decimal): Money {
  return r2(dec(x)).toFixed(2);
}

/** ¿Es un monto canónico (texto con punto y exactamente dos decimales)? */
export function isMoney(x: unknown): x is Money {
  return typeof x === "string" && MONEY.test(x);
}

/** Porcentaje sin ceros de relleno ni notación exponencial: "2.90" → "2.9", "50.0000" → "50". */
export function normPct(x: string | Decimal): Pct {
  return dec(x).toFixed();
}
