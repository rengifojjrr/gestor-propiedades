import "server-only";
import { z } from "zod";
import { addDays, type ColumnMapping, type ExistingRef, type ImportFormat, type ImportRow, type ManualTx } from "@/lib/pasarelas";
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

// ─── Lo que ya está guardado, antes de importar ─────────────────────────────────────────────────────────────
//
// Solo lectura, con la sesión de la persona (la RLS aplica): se buscan las referencias del lote y los cobros
// registrados a mano que podrían ser los mismos. Las listas van en la URL de la petición: se parten en grupos.

/** Cuántos valores van en un `in (…)`: la petición entera tiene que caber en una URL. */
const IN_SIZE = 100;
/** Filas por página: la API da 1000 como mucho. */
const PAGE_SIZE = 1000;

export function groupsOf<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += IN_SIZE) out.push(items.slice(start, start + IN_SIZE));
  return out;
}

/** Las referencias del lote que ya tienen un cobro en esa pasarela, también en la papelera (que la conserva). */
export async function findExistingRefs(
  supabase: Db,
  gatewayId: string,
  references: readonly string[],
): Promise<ExistingRef[]> {
  const found: ExistingRef[] = [];
  for (const group of groupsOf([...new Set(references)])) {
    const { data } = await supabase
      .from("pay_transactions")
      .select("reference, deleted_at")
      .eq("gateway_id", gatewayId)
      .in("reference", group)
      .throwOnError();
    for (const tx of data) {
      if (tx.reference !== null) found.push({ reference: tx.reference, trashed: tx.deleted_at !== null });
    }
  }
  return found;
}

/**
 * Los cobros fuera de la papelera, de esa empresa y pasarela, con alguna moneda y algún bruto del lote, a un día
 * como mucho de sus fechas, que se registraron a mano (los importados quedan fuera: su alta es «importado»).
 * Con ellos, `classifyRepeats` decide cuáles pueden ser una fila del archivo con otra referencia o sin ella.
 */
export async function findManualTxs(
  supabase: Db,
  { companyId, gatewayId, rows }: { companyId: string; gatewayId: string; rows: readonly ImportRow[] },
): Promise<ManualTx[]> {
  if (rows.length === 0) return [];
  const days = rows.map((row) => row.occurredOn).sort();
  const from = addDays(days[0]!, -1);
  const to = addDays(days.at(-1)!, 1);
  const currencies = [...new Set(rows.map((row) => row.currency))];

  const candidates = new Map<string, ManualTx>();
  for (const amounts of groupsOf([...new Set(rows.map((row) => row.grossOriginal))])) {
    for (let page = 0; ; page += 1) {
      const { data } = await supabase
        .from("pay_transactions")
        .select("id, reference, currency, gross_original::text, occurred_on")
        .eq("company_id", companyId)
        .eq("gateway_id", gatewayId)
        .is("deleted_at", null)
        .in("currency", currencies)
        // Montos canónicos ya validados ("100.00"): van como texto, sin pasar por `number`.
        .filter("gross_original", "in", `(${amounts.join(",")})`)
        .gte("occurred_on", from)
        .lte("occurred_on", to)
        .order("id")
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        .throwOnError();
      for (const tx of data) {
        candidates.set(tx.id, {
          id: tx.id,
          reference: tx.reference,
          currency: tx.currency,
          grossOriginal: tx.gross_original,
          occurredOn: tx.occurred_on,
        });
      }
      if (data.length < PAGE_SIZE) break;
    }
  }

  for (const ids of groupsOf([...candidates.keys()])) {
    const { data } = await supabase
      .from("pay_transaction_events")
      .select("transaction_id")
      .eq("kind", "importado")
      .in("transaction_id", ids)
      .throwOnError();
    for (const event of data) candidates.delete(event.transaction_id);
  }
  return [...candidates.values()];
}
