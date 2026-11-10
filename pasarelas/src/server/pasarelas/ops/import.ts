import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isISODate, looksLikeCardNumber, nyDate, planCreate, validateMapping } from "@/lib/pasarelas";
import type { ImportRow, NewTxInput } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";
import { loadPayConfig } from "../queries/config";
import type { SavedImportMapping } from "../queries/import";
import { SAVE_BATCH_SIZE, saveTx } from "../tx-save";

/**
 * La importación de un archivo de la pasarela. El navegador lee el CSV y lo convierte con el motor (`mapRows`);
 * aquí llegan solo las filas ya convertidas, de a un lote, y **no se confía en ellas**: cada una se vuelve a validar
 * antes de calcular nada. Cada cobro se calcula con la configuración de ahora (`planCreate`, evento «importado») y
 * se guarda sin repetir referencias en esa pasarela (`saveTx` con `skipDuplicates`).
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

export type ImportInput = {
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

/**
 * Importa un lote de hasta 500 filas, todas con la misma empresa, pasarela, canal y opciones, y con el esquema de
 * reparto por defecto de la empresa. Devuelve cuántos cobros se crearon y cuántos ya existían (misma referencia en
 * esa pasarela) y no se tocaron.
 *
 * Todo o nada por lote: si una fila no es válida no se escribe ninguna y el error dice cuál; si la base rechaza
 * algo, el lote entero se deshace.
 */
export async function importTransactions(
  supabase: Db,
  input: ImportInput,
): Promise<{ created: number; duplicates: number }> {
  if (input.rows.length === 0) throw new UserError("El archivo no trae cobros para importar.");
  if (input.rows.length > SAVE_BATCH_SIZE) {
    throw new UserError(`Se importan como máximo ${SAVE_BATCH_SIZE} filas por envío.`);
  }
  const rows = checkRows(input.rows);
  const cfg = await loadPayConfig(supabase);
  // Si la empresa no existe (o es de otro usuario), `planCreate` lo dice con su error.
  const schemeId = cfg.companies.find((company) => company.id === input.companyId)?.defaultSchemeId ?? null;

  const writes = rows.map((row) => {
    const tx: NewTxInput = {
      id: randomUUID(),
      companyId: input.companyId,
      channelId: input.channelId,
      gatewayId: input.gatewayId,
      extraIds: input.extraIds,
      schemeId,
      occurredAt: row.occurredAt,
      occurredOn: row.occurredOn,
      currency: row.currency,
      grossOriginal: row.grossOriginal,
      reference: row.reference,
      note: row.note,
      ...(input.useReportedFee && row.reportedFee !== null ? { feeOverride: row.reportedFee } : {}),
    };
    return planCreate(cfg, tx, "importado");
  });

  const results = await saveTx(supabase, writes, { skipDuplicates: true });
  const created = results.filter((result) => result.inserted).length;
  return { created, duplicates: results.length - created };
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
