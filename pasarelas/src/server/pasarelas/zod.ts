import "server-only";
import { z } from "zod";
import {
  ZERO,
  cmp,
  hasLongDigitRun,
  isHttpUrl,
  isISODate,
  looksLikeCardNumber,
  neg,
  parseMoney,
  parsePct,
} from "@/lib/pasarelas";
import type { Currency, ISODate, Money, Pct } from "@/lib/pasarelas";

/**
 * Los esquemas que comparten todas las acciones: validan lo que llega de un formulario (siempre entrada no
 * confiable) y lo dejan en la forma que usa el motor. Cada uno trae su mensaje en español, listo para mostrarse
 * junto al campo.
 */

// Los mensajes que Zod pone por su cuenta (un campo que falta, un tipo que no es) también salen en español.
z.config(z.locales.es());

const REQUIRED_TEXT = "Este campo es obligatorio";
const MONEY_TEXT = "Monto no válido";
const PCT_TEXT = "Porcentaje no válido";
const DATE_TEXT = "Fecha no válida";
const CURRENCY_TEXT = "Moneda no válida: son tres letras, como USD";
const URL_TEXT = "El link tiene que empezar por http:// o https:// y no llevar espacios";
const CARD_TEXT = "Parece un número de tarjeta. No lo guardes aquí: si son fechas o montos, sepáralos con texto";
const ALIAS_TEXT = "No escribas números de cuenta: un alias no lleva 7 o más dígitos seguidos";

/** Lo más que cabe en una columna de dinero, `numeric(14,2)`. */
const MAX_MONEY: Money = "999999999999.99";
/** El tope de los links en la base. */
const MAX_URL = 300;
/** El tope de la referencia de un cobro en la base. */
const MAX_REFERENCE = 120;

const tooLong = (text: string, max: number): string | null => (text.length > max ? `Máximo ${max} caracteres` : null);

/**
 * El id de una fila: un uuid, en minúsculas como lo devuelve la base. Vale cualquier uuid bien formado (lo que
 * admite Postgres), no solo los de la versión 4: uno que no exista simplemente no encuentra nada.
 */
export const zId: z.ZodType<string> = z.guid({ error: "Identificador no válido" }).transform((id) => id.toLowerCase());

/** Un monto como lo escribe una persona («1.234,56», «$100»), ya canónico ("1234.56"). */
export const zMoney: z.ZodType<Money> = z.string({ error: MONEY_TEXT }).transform((text, ctx) => {
  const money = parseMoney(text);
  if (money !== null && cmp(money, MAX_MONEY) <= 0 && cmp(money, neg(MAX_MONEY)) >= 0) return money;
  ctx.issues.push({ code: "custom", message: MONEY_TEXT, input: text });
  return z.NEVER;
});

/** Un monto mayor que cero. */
export const zPositiveMoney: z.ZodType<Money> = zMoney.refine((money) => cmp(money, ZERO) > 0, {
  error: "El monto tiene que ser mayor que cero",
});

/** Un porcentaje de 0 a 100 como lo escribe una persona («2,9», «2.9 %»), ya normalizado ("2.9"). */
export const zPct: z.ZodType<Pct> = z.string({ error: PCT_TEXT }).transform((text, ctx) => {
  const pct = parsePct(text);
  if (pct !== null) return pct;
  ctx.issues.push({ code: "custom", message: PCT_TEXT, input: text });
  return z.NEVER;
});

/** Una fecha de calendario AAAA-MM-DD que existe. */
export const zDate: z.ZodType<ISODate> = z.string({ error: DATE_TEXT }).refine(isISODate, { error: DATE_TEXT });

/** Un código de moneda: tres letras, en mayúsculas. */
export const zCurrency: z.ZodType<Currency> = z
  .string({ error: CURRENCY_TEXT })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, { error: CURRENCY_TEXT });

/** Lo que le falla a un texto ya recortado: el mensaje para la persona, o `null` si está bien. */
type TextCheck = (text: string) => string | null;

/** Un texto obligatorio: se recorta, no puede quedar vacío y tiene que pasar `check`. */
function requiredText(check: TextCheck): z.ZodType<string> {
  return z.string({ error: REQUIRED_TEXT }).transform((raw, ctx) => {
    const text = raw.trim();
    const problem = text === "" ? REQUIRED_TEXT : check(text);
    if (problem === null) return text;
    ctx.issues.push({ code: "custom", message: problem, input: raw });
    return z.NEVER;
  });
}

/** Un texto opcional: se recorta; vacío (o ausente) es `null`; si trae algo, tiene que pasar `check`. */
function optionalText(check: TextCheck): z.ZodType<string | null> {
  return z
    .string({ error: "Texto no válido" })
    .nullish()
    .transform((raw, ctx) => {
      const text = (raw ?? "").trim();
      if (text === "") return null;
      const problem = check(text);
      if (problem === null) return text;
      ctx.issues.push({ code: "custom", message: problem, input: raw });
      return z.NEVER;
    });
}

/** Las reglas de todo texto libre: su máximo, y nada que parezca un número de tarjeta. */
const freeText =
  (max: number): TextCheck =>
  (text) =>
    tooLong(text, max) ?? (looksLikeCardNumber(text) ? CARD_TEXT : null);

/** Un link de panel, de pago o de la web: solo `http(s)://`. Vacío → `null`. */
export const zHttpUrl: z.ZodType<string | null> = optionalText(
  (text) => tooLong(text, MAX_URL) ?? (/\s/.test(text) || !isHttpUrl(text) ? URL_TEXT : null),
);

/** Un texto libre obligatorio de hasta `max` caracteres. Rechaza lo que parece un número de tarjeta. */
export function zText(max: number): z.ZodType<string> {
  return requiredText(freeText(max));
}

/** Un texto libre opcional de hasta `max` caracteres (vacío → `null`), con la misma guarda de tarjeta. */
export function zOptionalText(max: number): z.ZodType<string | null> {
  return optionalText(freeText(max));
}

/** Un alias (de una cuenta destino, de un beneficiario): un texto libre que además no lleva 7 o más dígitos seguidos. */
export function zAlias(max: number): z.ZodType<string> {
  const check = freeText(max);
  return requiredText((text) => check(text) ?? (hasLongDigitRun(text) ? ALIAS_TEXT : null));
}

/**
 * La referencia que la pasarela le da a un cobro. Vacía → `null`. No lleva la guarda de tarjeta: los
 * identificadores largos de una pasarela son normales.
 */
export const zReference: z.ZodType<string | null> = optionalText((text) => tooLong(text, MAX_REFERENCE));

/**
 * Una ventana de días al depósito («de 3 a 5»), ya leídos los dos campos: el máximo, si viene, pide un mínimo y va
 * de ese mínimo a 60 (que no pase de 60 ya lo dice su propio campo). Es el `superRefine` del objeto que trae los
 * dos; lo que falle se dice en el campo del máximo.
 */
export function refineDaysWindow<Min extends string, Max extends string>(minKey: Min, maxKey: Max) {
  return (value: Record<Min | Max, number | null>, ctx: z.RefinementCtx): void => {
    const min = value[minKey];
    const max = value[maxKey];
    if (max === null) return;
    const message = min === null ? "Escribe también el mínimo («De»)" : `Escribe un número de días entre ${min} y 60`;
    if (min === null || max < min) ctx.addIssue({ code: "custom", message, path: [maxKey] });
  };
}
