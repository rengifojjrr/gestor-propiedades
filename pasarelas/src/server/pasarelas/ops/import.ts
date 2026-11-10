import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  depositedOnImport,
  isISODate,
  looksLikeCardNumber,
  nyDate,
  planCreate,
  todayNY,
  validateMapping,
} from "@/lib/pasarelas";
import type { ExistingRef, ImportRow, ISODate, ManualTx, NewTxInput, PayConfig, TxWrite } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";
import { loadPayConfig } from "../queries/config";
import { findExistingRefs, findManualTxs, groupsOf, type SavedImportMapping } from "../queries/import";
import { SAVE_BATCH_SIZE, saveTx } from "../tx-save";

/**
 * La importación de un archivo de la pasarela. El navegador lee el CSV y lo convierte con el motor (`mapRows`);
 * aquí llegan solo las filas ya convertidas, de a un lote, y **no se confía en ellas**: cada una se vuelve a validar
 * antes de calcular nada. Cada cobro se calcula con la configuración de ahora (`planCreate`, evento «importado») y
 * se guarda sin repetir referencias en esa pasarela (`saveTx` con `skipDuplicates`). Antes de importar, la pantalla
 * pide la vista previa del lote (`previewImport`), que hace el mismo cálculo sin escribir nada.
 */

const MAX_REFERENCE = 120;
const MAX_NOTE = 280;
/** Un monto canónico de `numeric(14,2)` que no es negativo: "0.00" … "999999999999.99". */
const CANONICAL_AMOUNT = /^(0|[1-9]\d{0,11})\.\d{2}$/;

/** Lo que se le dice a la persona cuando un campo de la fila no pasa. */
const PROBLEM_OF: Record<keyof ImportRow, string> = {
  line: "le falta el número de línea",
  reference: "la referencia falta, pasa de 120 caracteres o parece un número de tarjeta",
  occurredAt: "la fecha y hora no son válidas",
  occurredOn: "la fecha no es válida",
  grossOriginal: "el monto no es válido o no es mayor que cero",
  currency: "la moneda no es válida",
  reportedFee: "la comisión del archivo no es válida",
  note: "la nota pasa de 280 caracteres o parece un número de tarjeta",
};

const chars = (text: string): number => Array.from(text).length;

const zImportRow = z.object({
  line: z.number().int().min(1),
  reference: z
    .string()
    .refine((text) => text.trim() === text && chars(text) >= 1 && chars(text) <= MAX_REFERENCE)
    .refine((text) => !looksLikeCardNumber(text)),
  occurredAt: z.iso.datetime({ offset: true }),
  occurredOn: z.string().refine(isISODate),
  grossOriginal: z.string().regex(CANONICAL_AMOUNT).refine((money) => /[1-9]/.test(money)),
  currency: z.string().regex(/^[A-Z]{3}$/),
  reportedFee: z.string().regex(CANONICAL_AMOUNT).nullable(),
  note: z
    .string()
    .refine((text) => text.trim() !== "" && chars(text) <= MAX_NOTE && !looksLikeCardNumber(text))
    .nullable(),
}) satisfies z.ZodType<ImportRow>;

/** «La línea 7» si la fila dice su línea; si no, su lugar en el lote. */
function whereIs(raw: unknown, index: number): string {
  const line = typeof raw === "object" && raw !== null ? (raw as { line?: unknown }).line : undefined;
  return typeof line === "number" && Number.isInteger(line) && line >= 1
    ? `La línea ${line}`
    : `La fila ${index + 1} del lote`;
}

/** Cada fila del lote, validada. La primera que no pasa detiene todo, antes de escribir nada. */
function checkRows(rows: readonly unknown[]): ImportRow[] {
  return rows.map((raw, index) => {
    const parsed = zImportRow.safeParse(raw);
    let problem: string | null = null;
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      problem =
        typeof field === "string" && field in PROBLEM_OF ? PROBLEM_OF[field as keyof ImportRow] : "no es un cobro";
    } else if (nyDate(parsed.data.occurredAt) !== parsed.data.occurredOn) {
      problem = "la fecha no coincide con la fecha y hora en Nueva York";
    }
    if (problem !== null) {
      throw new UserError(`${whereIs(raw, index)} no se puede importar: ${problem}. No se guardó nada de este lote.`);
    }
    return parsed.data as ImportRow;
  });
}

/** El lote, validado: ni vacío, ni de más de 500 filas, ni con una fila que no pasa. */
function checkBatch(rows: readonly unknown[]): ImportRow[] {
  if (rows.length === 0) throw new UserError("El archivo no trae cobros para importar.");
  if (rows.length > SAVE_BATCH_SIZE) {
    throw new UserError(`Se importan como máximo ${SAVE_BATCH_SIZE} filas por envío.`);
  }
  return checkRows(rows);
}

/** Lo que vale para todos los cobros de un archivo, y sus filas. */
export type ImportBatch = {
  companyId: string;
  gatewayId: string;
  /** El canal de la empresa por el que entraron, o ninguno. */
  channelId: string | null;
  /** Las opciones de la pasarela encendidas para todos los cobros del archivo. */
  extraIds: string[];
  /** Usar la comisión que informa el archivo (si la fila la trae) en vez de la calculada con la tarifa. */
  useReportedFee: boolean;
  /** Las filas ya convertidas por el navegador: entrada no confiable. */
  rows: readonly unknown[];
};

export type ImportInput = ImportBatch & {
  /**
   * «Estos cobros ya se depositaron»: los que tienen la fecha estimada hasta hoy entran depositados en esa fecha
   * (`depositedOnImport`); los demás, por caer.
   */
  alreadyDeposited: boolean;
};

/** El esquema de reparto que se aplicará a lo importado, como se le dice a la persona. */
export type ImportScheme =
  | { kind: "activo"; name: string }
  | { kind: "desactivado"; name: string }
  | { kind: "ninguno" };

/**
 * El esquema por defecto de la empresa, si está activo: uno desactivado ya no se ofrece al registrar a mano, así
 * que tampoco se aplica al importar (lo importado queda sin reparto, y se dice).
 */
function defaultScheme(cfg: PayConfig, companyId: string): { schemeId: string | null; info: ImportScheme } {
  const id = cfg.companies.find((company) => company.id === companyId)?.defaultSchemeId ?? null;
  const scheme = cfg.schemes.find((candidate) => candidate.id === id);
  if (scheme === undefined) return { schemeId: null, info: { kind: "ninguno" } };
  return scheme.active
    ? { schemeId: scheme.id, info: { kind: "activo", name: scheme.name } }
    : { schemeId: null, info: { kind: "desactivado", name: scheme.name } };
}

/**
 * Cada fila calculada con la configuración de ahora (evento «importado»). Con `alreadyDeposited`, la que ya debió
 * caer se vuelve a planear como depositada en su fecha estimada: el mismo cálculo, con el estado de entrada.
 */
function planRows(
  cfg: PayConfig,
  batch: Omit<ImportBatch, "rows">,
  rows: readonly ImportRow[],
  deposit: { today: ISODate; alreadyDeposited: boolean },
): TxWrite[] {
  // Si la empresa no existe (o es de otro usuario), `planCreate` lo dice con su error.
  const { schemeId } = defaultScheme(cfg, batch.companyId);
  return rows.map((row) => {
    const tx: NewTxInput = {
      id: randomUUID(),
      companyId: batch.companyId,
      channelId: batch.channelId,
      gatewayId: batch.gatewayId,
      extraIds: batch.extraIds,
      schemeId,
      occurredAt: row.occurredAt,
      occurredOn: row.occurredOn,
      currency: row.currency,
      grossOriginal: row.grossOriginal,
      reference: row.reference,
      note: row.note,
      ...(batch.useReportedFee && row.reportedFee !== null ? { feeOverride: row.reportedFee } : {}),
    };
    const plan = planCreate(cfg, tx, "importado");
    const estimated = plan.fields.estimatedDepositOn ?? null;
    const depositedOn =
      estimated === null ? null : depositedOnImport(estimated, deposit.today, deposit.alreadyDeposited);
    return depositedOn === null ? plan : planCreate(cfg, { ...tx, status: "depositado", depositedOn }, "importado");
  });
}

/**
 * Importa un lote de hasta 500 filas, todas con la misma empresa, pasarela, canal y opciones, y con el esquema de
 * reparto por defecto de la empresa si está activo. Devuelve cuántos cobros se crearon, cuántos ya existían (misma
 * referencia en esa pasarela) y no se tocaron, y cuántos de esos están en la papelera (que conserva la referencia:
 * hay que restaurarlos o borrarlos del todo).
 *
 * Todo o nada por lote: si una fila no es válida no se escribe ninguna y el error dice cuál; si la base rechaza
 * algo, el lote entero se deshace.
 */
export async function importTransactions(
  supabase: Db,
  input: ImportInput,
): Promise<{ created: number; duplicates: number; trashed: number }> {
  const rows = checkBatch(input.rows);
  const cfg = await loadPayConfig(supabase);
  const today = todayNY(new Date());
  const writes = planRows(cfg, input, rows, { today, alreadyDeposited: input.alreadyDeposited });

  const results = await saveTx(supabase, writes, { skipDuplicates: true });
  const created = results.filter((result) => result.inserted).length;
  const skipped = results.filter((result) => !result.inserted).map((result) => result.id);
  const trashed = await countTrashed(supabase, skipped);
  return { created, duplicates: results.length - created - trashed, trashed };
}

/** Cuántos de esos cobros (los que se saltaron por su referencia) están en la papelera. */
async function countTrashed(supabase: Db, ids: readonly string[]): Promise<number> {
  let trashed = 0;
  for (const group of groupsOf(ids)) {
    const { data } = await supabase
      .from("pay_transactions")
      .select("id")
      .in("id", group)
      .not("deleted_at", "is", null)
      .throwOnError();
    trashed += data.length;
  }
  return trashed;
}

/** Lo que «Así lo entendí» necesita saber del servidor sobre un lote, antes de importar nada. */
export type ImportPreview = {
  /** Hoy en Nueva York: con esta fecha se decide qué ya debió caer. */
  today: ISODate;
  /** La fecha estimada de depósito de cada fila, con la configuración de ahora. */
  estimates: { line: number; estimatedDepositOn: ISODate }[];
  /** Las referencias del lote que ya están en la pasarela (también en la papelera). */
  existing: ExistingRef[];
  /** Los cobros registrados a mano que pueden ser alguna fila con otra referencia o sin ella. */
  manual: ManualTx[];
  scheme: ImportScheme;
};

/**
 * La vista previa de un lote: las filas se validan y se calculan como en `importTransactions`, pero no se escribe
 * nada. Solo lee, con la sesión de la persona.
 */
export async function previewImport(supabase: Db, input: ImportBatch): Promise<ImportPreview> {
  const rows = checkBatch(input.rows);
  const cfg = await loadPayConfig(supabase);
  const today = todayNY(new Date());
  const writes = planRows(cfg, input, rows, { today, alreadyDeposited: false });
  const references = rows.map((row) => row.reference);
  const [existing, manual] = await Promise.all([
    findExistingRefs(supabase, input.gatewayId, references),
    findManualTxs(supabase, { companyId: input.companyId, gatewayId: input.gatewayId, rows }),
  ]);
  return {
    today,
    estimates: rows.map((row, index) => ({
      line: row.line,
      estimatedDepositOn: writes[index]!.fields.estimatedDepositOn!,
    })),
    existing,
    manual,
    scheme: defaultScheme(cfg, input.companyId).info,
  };
}

/**
 * Recuerda en la pasarela el mapeo con el que se importó y el formato del archivo. Se guarda solo un mapeo que
 * sirve (`validateMapping`, contra las mismas columnas que nombra): sin datos del comprador en la referencia ni en
 * la nota, con una zona, una moneda, un separador y un formato de fecha que existen.
 */
export async function saveImportMapping(
  supabase: Db,
  { gatewayId, format, mapping }: { gatewayId: string } & SavedImportMapping,
): Promise<void> {
  const { reference, date, time, timezone, gross, currency, fee, status, type, note } = mapping;
  const named = [reference, date, time, timezone, gross, currency, fee, status, type, note].filter(
    (column): column is string => typeof column === "string",
  );
  const problems = validateMapping(named, mapping);
  if (problems.length > 0) throw new UserError(problems.join(" "));

  const { data } = await supabase
    .from("pay_gateways")
    .update({ import_mapping: { format, mapping } })
    .eq("id", gatewayId)
    .select("id")
    .throwOnError();
  if (data.length === 0) throw new UserError("Esa pasarela ya no existe.");
}
