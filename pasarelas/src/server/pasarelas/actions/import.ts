"use server";

import "server-only";
import { z } from "zod";
import { runAction } from "../action";
import * as ops from "../ops/import";
import { zColumnMapping, zImportFormat } from "../queries/import";
import type { ActionResult } from "../result";
import { zId } from "../zod";

/**
 * Las Server Actions de «Importar». El archivo nunca llega aquí: el navegador lo lee y manda solo las filas ya
 * convertidas, de a un lote de hasta 500. Cada fila la vuelve a validar `ops/import.ts`, que dice en qué línea
 * está la que no sirve (por eso aquí las filas pasan como `unknown`).
 */

const zBatch = z.object({
  companyId: zId,
  gatewayId: zId,
  channelId: zId.nullable(),
  extraIds: z.array(zId),
  useReportedFee: z.boolean(),
  rows: z.array(z.unknown()),
});

/**
 * Lo que «Así lo entendí» necesita del servidor sobre un lote, sin escribir nada: la fecha estimada de cada fila,
 * las referencias que ya existen (también en la papelera), los cobros registrados a mano que pueden ser los mismos
 * y el esquema de reparto que se aplicará.
 */
export async function previewImport(input: unknown): Promise<ActionResult<ops.ImportPreview>> {
  return runAction(zBatch, input, ({ supabase }, data) => ops.previewImport(supabase, data), { revalidate: [] });
}

/**
 * Importa un lote de filas. Devuelve cuántos cobros se crearon, cuántos ya existían (y no se tocaron) y cuántos de
 * esos están en la papelera.
 */
export async function importTransactions(
  input: unknown,
): Promise<ActionResult<{ created: number; duplicates: number; trashed: number }>> {
  const schema = zBatch.extend({ alreadyDeposited: z.boolean() });
  return runAction(schema, input, ({ supabase }, data) => ops.importTransactions(supabase, data));
}

/** Recuerda el mapeo de columnas (y el formato del archivo) para la próxima importación con esa pasarela. */
export async function saveImportMapping(input: unknown): Promise<ActionResult> {
  const schema = z.object({ gatewayId: zId, format: zImportFormat, mapping: zColumnMapping });
  return runAction(schema, input, ({ supabase }, data) => ops.saveImportMapping(supabase, data), {
    revalidate: ["/pasarelas/importar"],
  });
}
