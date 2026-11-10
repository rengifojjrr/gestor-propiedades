import "server-only";
import { z } from "zod";
import type { ColumnMapping, ImportFormat } from "@/lib/pasarelas";
import type { Db } from "../dto";

/**
 * El mapeo de columnas que se recuerda por pasarela (`pay_gateways.import_mapping`): el último con el que se
 * importó, junto con el formato del archivo. El formato sirve para avisar cuando llega otro de la misma cuenta
 * (el informe de saldo de Stripe y su exportación de pagos traen referencias distintas del mismo cobro).
 */

export type SavedImportMapping = { format: ImportFormat; mapping: ColumnMapping };

/** Un nombre de columna elegido: texto corto. Que exista en el archivo y no sea del comprador lo dice `validateMapping`. */
const zColumn = z.string().max(200);
const zOptionalColumn = zColumn.nullish().transform((column) => column ?? null);

export const zImportFormat = z.enum(["stripe_pagos", "stripe_saldo", "paypal_actividad", "otro"]);

/** La forma de un `ColumnMapping` (lo que manda el navegador o lo que vuelve de la base); lo demás se descarta. */
export const zColumnMapping: z.ZodType<ColumnMapping> = z.object({
  reference: zColumn,
  date: zColumn,
  time: zOptionalColumn,
  timezone: zOptionalColumn,
  gross: zColumn,
  currency: zOptionalColumn,
  fee: zOptionalColumn,
  status: zOptionalColumn,
  type: zOptionalColumn,
  note: zOptionalColumn,
  fixedZone: z.string().max(100),
  decimal: z.enum([".", ","]),
  dateFormat: z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
});

const zSaved = z.object({ format: zImportFormat, mapping: zColumnMapping });

/**
 * El mapeo recordado de cada pasarela del usuario, por id de pasarela. Una pasarela sin mapeo, o con uno guardado
 * que ya no tiene la forma de ahora, no aparece: la pantalla propone el del formato.
 */
export async function getImportMappings(supabase: Db): Promise<Record<string, SavedImportMapping>> {
  const { data } = await supabase
    .from("pay_gateways")
    .select("id, import_mapping")
    .not("import_mapping", "is", null)
    .throwOnError();
  const mappings: Record<string, SavedImportMapping> = {};
  for (const { id, import_mapping } of data) {
    const parsed = zSaved.safeParse(import_mapping);
    if (parsed.success) mappings[id] = parsed.data;
  }
  return mappings;
}
