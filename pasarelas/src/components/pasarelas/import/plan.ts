/**
 * Lo que decide la pantalla «Importar» antes de mandar nada, sin red ni React: qué mapeo proponer, si el archivo
 * choca con el formato que ya se usó en esa pasarela, qué columnas se ofrecen y cómo se parten los lotes.
 */
import {
  detectFormat,
  presetFor,
  validateMapping,
  type ColumnMapping,
  type ImportFormat,
  type ImportSkip,
} from "@/lib/pasarelas/import";
import type { SavedImportMapping } from "@/server/pasarelas/queries/import";

/** Un archivo con más filas que estas no se lee. */
export const MAX_IMPORT_ROWS = 5000;
/** Filas por llamada a la acción: muy por debajo del límite de cuerpo de una Server Action. */
export const IMPORT_BATCH_SIZE = 500;

export const FORMAT_LABEL: Record<ImportFormat, string> = {
  stripe_saldo: "Stripe (movimientos de saldo)",
  stripe_pagos: "Stripe (pagos)",
  paypal_actividad: "PayPal (actividad)",
  otro: "otro formato (columnas elegidas a mano)",
};

/** Lo que se puede elegir para los cobros de un archivo (solo lo activo). Lo arma la página en el servidor. */
export type ImportChoices = {
  companies: { id: string; name: string }[];
  channels: { id: string; companyId: string; name: string }[];
  gateways: { id: string; name: string; extras: { id: string; name: string }[] }[];
  /** Las opciones que salen marcadas al elegir esa pasarela en esa empresa, por `defaultExtrasKey`. */
  defaultExtras: Record<string, string[]>;
};

export const defaultExtrasKey = (companyId: string, gatewayId: string): string => `${companyId}|${gatewayId}`;

/** Un mapeo vacío, para elegir cada columna a mano. */
const BLANK: ColumnMapping = {
  reference: "",
  date: "",
  time: null,
  timezone: null,
  gross: "",
  currency: null,
  fee: null,
  status: null,
  type: null,
  note: null,
  fixedZone: "UTC",
  decimal: ".",
  dateFormat: "YYYY-MM-DD",
  defaultCurrency: "USD",
};

export type Proposal = {
  format: ImportFormat;
  mapping: ColumnMapping;
  /** De dónde sale: el recordado para la pasarela, el del formato reconocido, o en blanco. */
  from: "guardado" | "formato" | "a_mano";
};

/**
 * El mapeo que se propone para un archivo: el que se recordó para la pasarela si es del mismo formato y sirve para
 * estas columnas; si no, el del formato reconocido; si no se reconoce, uno en blanco.
 */
export function proposeMapping(headers: readonly string[], saved: SavedImportMapping | undefined): Proposal {
  const format = detectFormat(headers);
  if (saved !== undefined && saved.format === format && validateMapping(headers, saved.mapping).length === 0) {
    return { format, mapping: saved.mapping, from: "guardado" };
  }
  const preset = presetFor(format);
  return preset === null ? { format, mapping: { ...BLANK }, from: "a_mano" } : { format, mapping: preset, from: "formato" };
}

/**
 * El formato con el que ya se importó en esa pasarela, si es otro que el de este archivo. Dos exportaciones de una
 * misma cuenta traen referencias distintas del mismo cobro (`txn_…` y `ch_…` en Stripe): importar las dos lo
 * registraría dos veces.
 */
export function formatConflict(saved: SavedImportMapping | undefined, format: ImportFormat): ImportFormat | null {
  return saved !== undefined && saved.format !== format ? saved.format : null;
}

/**
 * Si la columna trae datos del comprador (correo, nombre, dirección…). La regla es la del motor: `validateMapping`
 * la rechaza como referencia, y con un mapeo que solo nombra esa columna es lo único que puede objetar.
 */
export function isBuyerColumn(header: string): boolean {
  const probe: ColumnMapping = { ...BLANK, reference: header, date: header, gross: header };
  return validateMapping([header], probe).length > 0;
}

/** Las columnas que se ofrecen al mapear: todas las del archivo menos las del comprador (ni se muestran). */
export function columnChoices(headers: readonly string[]): string[] {
  return headers.filter((header) => header.trim() !== "" && !isBuyerColumn(header));
}

/** Las filas omitidas juntas por motivo, el más frecuente primero (en empate, el que salió antes). */
export function groupSkips(skips: readonly ImportSkip[]): { reason: string; lines: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const { line, reason } of skips) groups.set(reason, [...(groups.get(reason) ?? []), line]);
  return [...groups].map(([reason, lines]) => ({ reason, lines })).sort((a, b) => b.lines.length - a.lines.length);
}

/** Parte una lista en lotes de `size`, en orden. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}
