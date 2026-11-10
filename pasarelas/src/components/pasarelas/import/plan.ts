/**
 * Lo que decide la pantalla «Importar» antes de mandar nada, sin red ni React: qué mapeo proponer, si el archivo
 * choca con el formato que ya se usó en esa pasarela, qué columnas se ofrecen y cómo se parten los lotes.
 */
import {
  classifyRepeats,
  depositedOnImport,
  detectFormat,
  presetFor,
  validateMapping,
  type ColumnMapping,
  type ExistingRef,
  type ImportFormat,
  type ImportRow,
  type ImportSkip,
  type ManualTx,
  type RepeatCheck,
} from "@/lib/pasarelas/import";
import type { ISODate } from "@/lib/pasarelas/types";
import type { ImportPreview, ImportScheme } from "@/server/pasarelas/ops/import";
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
  const preset = presetFor(format, headers);
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

// ─── «Así lo entendí»: lo que ya está guardado y cuándo cae el dinero ────────────────────────────────────────

/** Las vistas previas de todos los lotes de un archivo, juntas. */
export type MergedPreview = {
  today: ISODate;
  /** La fecha estimada de depósito de cada fila, por línea. */
  estimates: Map<number, ISODate>;
  existing: ExistingRef[];
  manual: ManualTx[];
  scheme: ImportScheme;
};

/** Junta las vistas previas de cada lote (al menos una); un cobro a mano que salió en dos lotes cuenta una vez. */
export function mergePreviews(parts: readonly ImportPreview[]): MergedPreview {
  const manual = new Map<string, ManualTx>();
  for (const tx of parts.flatMap((p) => p.manual)) manual.set(tx.id, tx);
  return {
    today: parts[0]!.today,
    estimates: new Map(parts.flatMap((p) => p.estimates).map((e) => [e.line, e.estimatedDepositOn])),
    existing: parts.flatMap((p) => p.existing),
    manual: [...manual.values()],
    scheme: parts[0]!.scheme,
  };
}

export type ReviewPlan = {
  check: RepeatCheck;
  /** Las filas que viajan al servidor, en orden. Lo repetido también: el servidor lo salta y lo cuenta. */
  send: ImportRow[];
  /** Los posibles repetidos que no se mandan porque no se confirmaron. */
  heldBack: number;
  /**
   * De las filas que se crearían: cuántas son, cuántas tienen la fecha estimada ya pasada (entrarían atrasadas) y
   * cuántas la tienen hasta hoy (con «ya se depositaron» entran depositadas).
   */
  deposit: { creating: number; overdue: number; dueByToday: number };
};

/** Qué se manda y qué se le dice a la persona, con la vista previa del servidor y lo que eligió. */
export function planReview(
  rows: readonly ImportRow[],
  preview: MergedPreview,
  { includePossible }: { includePossible: boolean },
): ReviewPlan {
  const check = classifyRepeats(rows, preview.existing, preview.manual);
  const held = new Set(includePossible ? [] : check.possible.map(({ row }) => row.line));
  const creating = [...check.fresh, ...(includePossible ? check.possible.map(({ row }) => row) : [])];
  const estimates = creating.map((row) => preview.estimates.get(row.line)!);
  return {
    check,
    send: rows.filter((row) => !held.has(row.line)),
    heldBack: held.size,
    deposit: {
      creating: creating.length,
      overdue: estimates.filter((on) => on < preview.today).length,
      dueByToday: estimates.filter((on) => depositedOnImport(on, preview.today, true) !== null).length,
    },
  };
}

/** Lo que respondió el servidor a la vista previa de todas las filas: la vista previa, o por qué falló. */
export type PreviewAnswer = { preview: MergedPreview } | { error: string };

/**
 * En qué va «Así lo entendí»: sin filas que buscar (nada que preguntar al servidor), buscando todavía, un error
 * (que se puede reintentar), o la vista previa con lo que se haría.
 */
export type ReviewState =
  | { state: "sin_filas" }
  | { state: "cargando" }
  | { state: "error"; message: string }
  | { state: "listo"; plan: ReviewPlan; preview: MergedPreview };

/**
 * El estado de la revisión de unas filas con la respuesta que llegó para ellas (`null`: todavía ninguna). Sin filas
 * convertibles no se pregunta nada: no se queda «buscando».
 */
export function reviewState(
  rows: readonly ImportRow[],
  answer: PreviewAnswer | null,
  options: { includePossible: boolean },
): ReviewState {
  if (rows.length === 0) return { state: "sin_filas" };
  if (answer === null) return { state: "cargando" };
  if ("error" in answer) return { state: "error", message: answer.error };
  return { state: "listo", preview: answer.preview, plan: planReview(rows, answer.preview, options) };
}

/** Qué esquema de reparto se aplicará a lo importado, dicho para la persona. */
export function schemeText(scheme: ImportScheme, companyName: string): string {
  switch (scheme.kind) {
    case "activo":
      return `Reparto: «${scheme.name}», el esquema por defecto de ${companyName}.`;
    case "desactivado":
      return `Sin reparto: el esquema por defecto está desactivado («${scheme.name}»). Si lo vuelves a activar en Repartos, se aplicará a lo que importes después.`;
    case "ninguno":
      return `Sin reparto: ${companyName} no tiene esquema por defecto.`;
  }
}

/** Parte una lista en lotes de `size`, en orden. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}
