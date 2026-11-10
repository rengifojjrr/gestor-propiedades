/**
 * Convertir las filas de un archivo (ya leídas, como texto) en cobros listos para guardar. Sin red, sin reloj y sin
 * leer el CSV: lo lee el navegador, y aquí solo llegan sus filas.
 *
 * Nunca se leen columnas de correo, nombre o dirección del comprador: solo las del mapeo, y `validateMapping`
 * rechaza mapear la referencia o la nota a una de ellas.
 */
import { IANAZone } from "luxon";
import { isISODate, nyDate, wallTimeToInstant } from "../dates";
import { dec, toMoney } from "../decimal";
import { looksLikeCardNumber } from "../guards";
import { formatMoney } from "../money";
import type { Currency, ISODate, Money } from "../types";
import { normalizeHeader, type ImportFormat } from "./detect";
import { skipReason, STRIPE_CONVERTED_CURRENCY, STRIPE_REFUNDED, type ColumnMapping } from "./presets";

export type ImportRow = {
  /** La línea del archivo: la primera fila de datos es la 2. */
  line: number;
  reference: string;
  /** Instante ISO en UTC (`2026-11-14T03:30:00.000Z`). */
  occurredAt: string;
  /** Su fecha en `America/New_York`. */
  occurredOn: ISODate;
  grossOriginal: Money;
  currency: Currency;
  /** La comisión que informa el archivo, siempre en positivo; `null` si no trae. */
  reportedFee: Money | null;
  note: string | null;
};

export type ImportSkip = { line: number; reason: string };

// ─── Montos ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Signo y símbolo de moneda por delante (en cualquier orden, un signo como mucho) o el símbolo por detrás. */
const AMOUNT = /^([+-]?)\s*(?:\p{Sc}\s*)?([+-]?)(\d[\d.,]*)\s*\p{Sc}?$/u;
/** Miles bien agrupados: un primer grupo de 1 a 3 dígitos que no empieza por cero y luego grupos de 3. */
const GROUPED = { ",": /^[1-9]\d{0,2}(?:,\d{3})+$/, ".": /^[1-9]\d{0,2}(?:\.\d{3})+$/ } as const;
const CENTS = /^\d{1,2}$/;
/** `numeric(14,2)`: hasta 12 dígitos enteros. */
const MAX_WHOLE_DIGITS = 12;

/**
 * Lee un monto con el separador decimal del mapeo, sin adivinarlo: `1,234.56` con punto, `1.234,56` con coma. El
 * otro signo solo vale como separador de miles en grupos de tres bien formados. El símbolo de moneda y los espacios
 * alrededor se ignoran; negativo con `-` delante o entre paréntesis. Más de 2 decimales, más de 12 dígitos enteros
 * o cualquier otra cosa → null. Nada pasa por `number`.
 */
export function parseImportAmount(text: string, decimal: "." | ","): Money | null {
  let body = text.trim();
  const parens = /^\((.*)\)$/s.exec(body);
  if (parens) body = parens[1]!.trim();
  const match = AMOUNT.exec(body);
  if (!match) return null;
  const before = match[1]!;
  const after = match[2]!;
  const digits = match[3]!;
  if ((before !== "" && after !== "") || (parens && (before !== "" || after !== ""))) return null;

  const [whole = "", cents, ...rest] = digits.split(decimal);
  if (rest.length > 0 || (cents !== undefined && !CENTS.test(cents))) return null;
  const thousands = decimal === "." ? "," : ".";
  if (!/^\d+$/.test(whole) && !GROUPED[thousands].test(whole)) return null;
  const plainWhole = whole.replaceAll(thousands, "");
  if (plainWhole.replace(/^0+(?=\d)/, "").length > MAX_WHOLE_DIGITS) return null;

  const negative = parens !== null || before === "-" || after === "-";
  return toMoney(dec(`${negative ? "-" : ""}${plainWhole}${cents === undefined ? "" : `.${cents}`}`));
}

// ─── Fechas y zonas ─────────────────────────────────────────────────────────────────────────────────────────

const TIME = "((?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?)";
const TIME_ONLY = new RegExp(`^${TIME}$`);
/** Cada formato: su expresión (con la hora opcional pegada), dónde está cada parte y cómo se le explica a la persona. */
const DATE_FORMATS = {
  "YYYY-MM-DD": { re: new RegExp(`^(\\d{4})-(\\d{2})-(\\d{2})(?:[ T]${TIME})?$`), y: 1, m: 2, d: 3, label: "AAAA-MM-DD" },
  "MM/DD/YYYY": { re: new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4})(?: ${TIME})?$`), y: 3, m: 1, d: 2, label: "MM/DD/AAAA" },
  "DD/MM/YYYY": { re: new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4})(?: ${TIME})?$`), y: 3, m: 2, d: 1, label: "DD/MM/AAAA" },
} as const;

/** Las 12:00: la hora de una fecha que no trae hora (lejos de la medianoche, para no correr el día). */
const NOON = "12:00:00";

const pad2 = (s: string): string => s.padStart(2, "0");

/**
 * La hora de pared `AAAA-MM-DDTHH:mm:ss` de una fila: la hora va pegada a la fecha o en su columna, no en las dos.
 * Sin hora, las 12:00. Lo que no se entiende o no existe → null.
 */
function wallTime(dateCell: string, timeCell: string, format: ColumnMapping["dateFormat"]): string | null {
  const spec = DATE_FORMATS[format];
  const match = spec.re.exec(dateCell);
  if (!match) return null;
  const day = `${match[spec.y]}-${pad2(match[spec.m]!)}-${pad2(match[spec.d]!)}`;
  const inline = match[4];
  if (!isISODate(day) || (inline !== undefined && timeCell !== "")) return null;
  const time = inline ?? (timeCell === "" ? NOON : TIME_ONLY.exec(timeCell)?.[1]);
  if (time === undefined) return null;
  const [hh, mm, ss = "00"] = time.split(":") as [string, string, string?];
  return `${day}T${pad2(hh)}:${mm}:${ss}`;
}

/** Abreviaturas de EE. UU.: cada una es su desfase exacto en minutos (PDT = −07:00), no una zona con horario de verano. */
const FIXED_OFFSETS = new Map<string, number>([
  ["EST", -300], ["EDT", -240], ["CST", -360], ["CDT", -300], ["MST", -420], ["MDT", -360],
  ["PST", -480], ["PDT", -420], ["AKST", -540], ["AKDT", -480], ["HST", -600], ["UTC", 0], ["GMT", 0],
]);

type Zone = { offset: number } | { iana: string };

/** Una abreviatura de EE. UU. (o UTC/GMT) es un desfase fijo; si no, un nombre IANA válido; si no, null. */
function resolveZone(text: string): Zone | null {
  const name = text.trim();
  const offset = FIXED_OFFSETS.get(name.toUpperCase());
  if (offset !== undefined) return { offset };
  return name !== "" && IANAZone.create(name).isValid ? { iana: name } : null;
}

function toInstant(wall: string, zone: Zone): string {
  return "offset" in zone
    ? new Date(Date.parse(`${wall}Z`) - zone.offset * 60_000).toISOString()
    : wallTimeToInstant(wall, zone.iana);
}

// ─── El mapeo ───────────────────────────────────────────────────────────────────────────────────────────────

type Field = Exclude<keyof ColumnMapping, "fixedZone" | "decimal" | "dateFormat" | "defaultCurrency">;

/** Cada columna del mapeo, cómo se nombra en un mensaje y si es obligatoria. */
const FIELDS: readonly [Field, string, boolean][] = [
  ["reference", "referencia", true],
  ["date", "fecha", true],
  ["time", "hora", false],
  ["timezone", "zona horaria", false],
  ["gross", "monto", true],
  ["currency", "moneda", false],
  ["fee", "comisión", false],
  ["status", "estado", false],
  ["type", "tipo", false],
  ["note", "nota", false],
];

/**
 * Columnas con datos del comprador (correo, nombre, teléfono, dirección completa o por partes: ciudad, código postal,
 * estado o provincia, país), por su nombre ya normalizado. «city», «state» y «país» van como palabra suelta, para
 * no tocar «Velocity», «Statement Descriptor» ni «Status»; el borde de palabra es cualquier cosa que no sea letra
 * ni dígito, así que el guion bajo también separa («billing_state»). Las partes de la dirección de facturación o de
 * envío escritas todo junto («BillingCity», «ShipToState») se reconocen por su prefijo. «Estado» no se toca porque
 * casi siempre es el estado del cobro.
 */
const BUYER_COLUMN =
  /mail|correo|name|nombre|address|direcci|domicilio|customer|cliente|buyer|comprador|payer|pagador|phone|tel[eé]fono|ciudad|town|localidad|municipio|zip|postal|province|provincia|country|(?:billing|shipping|ship ?to|bill ?to)[\s_-]?(?:city|state|region)|(?<![\p{L}\p{N}])(?:city|state|pa[ií]s)(?![\p{L}\p{N}])/u;

const CURRENCY = /^[A-Z]{3}$/;

/** El nombre de columna elegido, recortado; `""` si no se eligió (o si no es texto: puede venir mal de la base). */
function chosen(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Los problemas de un mapeo para un archivo con estos encabezados, en español; vacío si sirve. Revisa también lo
 * que no depende del archivo (zona fija, moneda por defecto, separador, formato de fecha), porque el mapeo se
 * recuerda en la base y puede volver de ahí con cualquier cosa.
 */
export function validateMapping(headers: readonly string[], m: ColumnMapping): string[] {
  const present = new Set(headers.map(normalizeHeader));
  const problems: string[] = [];
  for (const [field, label, required] of FIELDS) {
    const column = chosen(m[field]);
    if (column === "") {
      if (required) problems.push(`Falta elegir la columna de ${label}.`);
      continue;
    }
    if (!present.has(normalizeHeader(column))) {
      problems.push(`No está en el archivo la columna «${column}» (${label}).`);
    }
    if ((field === "reference" || field === "note") && BUYER_COLUMN.test(normalizeHeader(column))) {
      problems.push(
        `La columna «${column}» tiene datos del comprador (correo, nombre o dirección): no se puede usar como ${label}.`,
      );
    }
  }
  if (resolveZone(chosen(m.fixedZone)) === null) problems.push(`Zona horaria fija desconocida: «${String(m.fixedZone)}».`);
  if (typeof m.defaultCurrency !== "string" || !CURRENCY.test(m.defaultCurrency)) {
    problems.push(`Moneda por defecto inválida: «${String(m.defaultCurrency)}» (se esperan 3 letras, como USD).`);
  }
  if (m.decimal !== "." && m.decimal !== ",") problems.push(`Separador decimal inválido: «${String(m.decimal)}» (punto o coma).`);
  if (!Object.hasOwn(DATE_FORMATS, m.dateFormat)) problems.push(`Formato de fecha inválido: «${String(m.dateFormat)}».`);
  return problems;
}

// ─── Las filas ──────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que admite `pay_transactions`: referencia de 1 a 120 caracteres y nota de hasta 280. */
const MAX_REFERENCE = 120;
const MAX_NOTE = 280;

const NOT_POSITIVE = "monto en cero o negativo: no es un cobro";
const repeated = (firstLine: number): string => `referencia repetida: ya salió en la línea ${firstLine}`;

/** Recorta a `max` caracteres (contados como la base: por carácter, no por unidad de UTF-16), con «…» al final. */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** Lee una fila que sí es un cobro: o el cobro, o la lista de lo que no se pudo leer. */
function readRow(
  line: number,
  cell: (column: string | null | undefined) => string,
  m: ColumnMapping,
  format: ImportFormat,
): { row: ImportRow } | { problems: string[] } {
  const problems: string[] = [];

  const reference = cell(m.reference).trim();
  if (reference === "") problems.push("falta la referencia");
  else if (Array.from(reference).length > MAX_REFERENCE) problems.push(`la referencia pasa de ${MAX_REFERENCE} caracteres`);
  else if (looksLikeCardNumber(reference)) problems.push("la referencia parece un número de tarjeta");

  const dateCell = cell(m.date).trim();
  const timeCell = cell(m.time).trim();
  const wall = dateCell === "" ? null : wallTime(dateCell, timeCell, m.dateFormat);
  if (dateCell === "") problems.push("falta la fecha");
  else if (wall === null) {
    const shown = [dateCell, timeCell].filter((x) => x !== "").join(" ");
    problems.push(`fecha u hora inválidas: «${shown}» (se espera ${DATE_FORMATS[m.dateFormat].label}, con la hora opcional)`);
  }

  let zone = resolveZone(m.fixedZone);
  if (chosen(m.timezone) !== "") {
    const zoneCell = cell(m.timezone).trim();
    zone = resolveZone(zoneCell);
    if (zoneCell === "") problems.push("falta la zona horaria");
    else if (zone === null) problems.push(`zona horaria desconocida: «${zoneCell}»`);
  }

  const grossCell = cell(m.gross).trim();
  const gross = parseImportAmount(grossCell, m.decimal);
  if (grossCell === "") problems.push("falta el monto");
  else if (gross === null) problems.push(`monto inválido: «${grossCell}»`);

  const currencyCell = cell(m.currency).trim();
  const currency = currencyCell === "" ? m.defaultCurrency : currencyCell.toUpperCase();
  if (!CURRENCY.test(currency)) problems.push(`moneda inválida: «${currencyCell}» (se esperan 3 letras, como USD)`);

  const feeCell = cell(m.fee).trim();
  const fee = feeCell === "" ? null : parseImportAmount(feeCell, m.decimal);
  if (feeCell !== "" && fee === null) problems.push(`comisión inválida: «${feeCell}»`);

  // En Stripe, pagos, la comisión va en la moneda de la cuenta («Converted Currency») y el monto en la del cobro:
  // si difieren, la comisión no se trae (nunca se mezclan monedas) y la nota lo dice.
  const accountCurrency = format === "stripe_pagos" ? cell(STRIPE_CONVERTED_CURRENCY).trim().toUpperCase() : "";
  const feeElsewhere = fee !== null && accountCurrency !== "" && accountCurrency !== currency;

  // Un cobro de Stripe ya reembolsado se importa por su monto original; lo reembolsado queda dicho en la nota.
  const refundedCell = format === "stripe_pagos" ? cell(STRIPE_REFUNDED).trim() : "";
  const refunded = refundedCell === "" ? null : parseImportAmount(refundedCell, m.decimal);
  if (refundedCell !== "" && refunded === null) problems.push(`monto reembolsado inválido: «${refundedCell}»`);

  if (problems.length > 0 || wall === null || zone === null || gross === null) return { problems };

  const refundNote =
    refunded === null || dec(refunded).isZero()
      ? ""
      : `Reembolsado en la pasarela: ${formatMoney(toMoney(dec(refunded).abs()), currency)} (falta registrarlo en el detalle del cobro)`;
  const feeNote = feeElsewhere ? `Comisión informada en ${accountCurrency}, otra moneda que el cobro: no se trajo` : "";
  const ownNote = cell(m.note).trim();
  const note = [refundNote, feeNote, looksLikeCardNumber(ownNote) ? "" : ownNote].filter((x) => x !== "").join(" · ");

  const occurredAt = toInstant(wall, zone);
  return {
    row: {
      line,
      reference,
      occurredAt,
      occurredOn: nyDate(occurredAt),
      grossOriginal: gross,
      currency,
      reportedFee: fee === null || feeElsewhere ? null : toMoney(dec(fee).abs()),
      note: note === "" ? null : clip(note, MAX_NOTE),
    },
  };
}

/**
 * Convierte las filas de un archivo (como las da papaparse con encabezados) con un mapeo válido. Las columnas se
 * buscan sin distinguir mayúsculas, espacios alrededor ni la marca BOM; a una fila corta le faltan celdas, que se
 * leen vacías. `line` = posición + 2 (el lector entrega una fila por línea).
 *
 * - `ok`: los cobros logrados, en el orden del archivo.
 * - `skipped`: lo que no es un cobro logrado (según el formato: reembolsos, retiros, comisiones sueltas, ajustes,
 *   retenciones, conversiones, fallidos, pendientes), montos en cero o negativos y referencias que ya salieron
 *   antes en el archivo (en un cobro que sí se importa).
 * - `errors`: las filas que no se pudieron leer, con todo lo que les falla.
 *
 * Lanza `RangeError` si el mapeo no sirve para estas filas (ver `validateMapping`): eso es un error del programa,
 * no del archivo.
 */
export function mapRows(
  rows: readonly Record<string, string>[],
  m: ColumnMapping,
  format: ImportFormat,
): { ok: ImportRow[]; skipped: ImportSkip[]; errors: ImportSkip[] } {
  const result = { ok: [] as ImportRow[], skipped: [] as ImportSkip[], errors: [] as ImportSkip[] };
  if (rows.length === 0) return result;

  // Cada columna normalizada → su nombre tal como viene en las filas.
  const columns = new Map<string, string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.has(normalizeHeader(key))) columns.set(normalizeHeader(key), key);
    }
  }
  const problems = validateMapping([...columns.values()], m);
  if (problems.length > 0) throw new RangeError(`El mapeo no sirve para este archivo: ${problems.join(" ")}`);

  const firstLineOf = new Map<string, number>();
  rows.forEach((row, index) => {
    const line = index + 2;
    const cell = (column: string | null | undefined): string => {
      const key = chosen(column) === "" ? undefined : columns.get(normalizeHeader(chosen(column)));
      return key === undefined ? "" : (row[key] ?? "");
    };
    const optional = (column: string | null | undefined): string | null => (chosen(column) === "" ? null : cell(column));

    const reason = skipReason(format, { type: optional(m.type), status: optional(m.status), cell });
    if (reason !== null) {
      result.skipped.push({ line, reason });
      return;
    }
    const read = readRow(line, cell, m, format);
    if ("problems" in read) {
      result.errors.push({ line, reason: read.problems.join("; ") });
      return;
    }
    const firstLine = firstLineOf.get(read.row.reference);
    if (dec(read.row.grossOriginal).lte(0)) {
      result.skipped.push({ line, reason: NOT_POSITIVE });
    } else if (firstLine !== undefined) {
      result.skipped.push({ line, reason: repeated(firstLine) });
    } else {
      firstLineOf.set(read.row.reference, line);
      result.ok.push(read.row);
    }
  });
  return result;
}
