import "server-only";
import { z } from "zod";
import type { TxFields, TxWrite } from "@/lib/pasarelas";
import type { Database, Json } from "@/lib/supabase/types";
import type { Db } from "./dto";

/**
 * De las escrituras que planea el motor (`TxWrite`) a la función `pay_save_transactions`, que guarda cada cobro
 * con su reparto y su evento en una sola transacción.
 */

/** Lo más que admite `pay_save_transactions` en una llamada. */
export const SAVE_BATCH_SIZE = 500;

type TxColumn = keyof Database["public"]["Tables"]["pay_transactions"]["Row"];

/**
 * Cada campo del cobro con el nombre de su columna. El compilador exige que estén todos y que cada nombre sea
 * una columna de verdad: `pay_save_transactions` ignora en silencio una clave que no conoce.
 */
const COLUMN_OF: Record<keyof TxFields, TxColumn> = {
  occurredAt: "occurred_at",
  occurredOn: "occurred_on",
  companyId: "company_id",
  channelId: "channel_id",
  gatewayId: "gateway_id",
  currency: "currency",
  grossOriginal: "gross_original",
  refundedAmount: "refunded_amount",
  grossAmount: "gross_amount",
  feesTotal: "fees_total",
  netAmount: "net_amount",
  allocBase: "alloc_base",
  allocBaseAmount: "alloc_base_amount",
  breakdown: "breakdown",
  feeVersionId: "fee_version_id",
  schemeId: "scheme_id",
  schemeVersionId: "scheme_version_id",
  reference: "reference",
  note: "note",
  status: "status",
  disputeState: "dispute_state",
  disputeOpenedOn: "dispute_opened_on",
  disputeClosedOn: "dispute_closed_on",
  estimatedDepositOn: "estimated_deposit_on",
  estimatedDepositFrom: "estimated_deposit_from",
  estimatedIsManual: "estimated_is_manual",
  depositedOn: "deposited_on",
  bankAccountId: "bank_account_id",
  deletedAt: "deleted_at",
  feesPaidBy: "fees_paid_by",
  buyerFees: "buyer_fees",
};

/** Un elemento de `p_items`: las columnas con su nombre de la base y el dinero como texto. */
export type RpcItem = {
  mode: "insert" | "update";
  tx: Record<string, unknown>;
  expected_updated_at: string | null;
  allocations: { beneficiary_id: string; amount: string; base: string; pct: string; is_remainder: boolean }[] | null;
  event: { kind: string; summary: string; data: Record<string, unknown> | null };
};

export type SaveResult = { id: string; inserted: boolean; skipped: boolean };

const zSaveResults = z.array(z.object({ id: z.string(), inserted: z.boolean(), skipped: z.boolean() }));

/**
 * La escritura como la espera `pay_save_transactions`. En `tx` van el id y solo los campos que trae la escritura:
 * en una actualización, una columna que no viaja no se toca, y una que viaja con `null` se vacía.
 */
export function toRpcItem(write: TxWrite): RpcItem {
  const tx: Record<string, unknown> = { id: write.id };
  for (const [field, value] of Object.entries(write.fields)) tx[COLUMN_OF[field as keyof TxFields]] = value;
  return {
    mode: write.mode,
    tx,
    expected_updated_at: write.expectedUpdatedAt,
    allocations:
      write.allocations?.map((line) => ({
        beneficiary_id: line.beneficiaryId,
        amount: line.amount,
        base: line.base,
        pct: line.pct,
        is_remainder: line.isRemainder,
      })) ?? null,
    event: write.event,
  };
}

/**
 * Guarda las escrituras en lotes de 500 y devuelve un resultado por escritura, en el orden de entrada.
 *
 * Cada lote es atómico: o se guardan todos sus cobros (con su reparto y su evento) o ninguno. Si un lote falla
 * se lanza su error y los siguientes no se intentan, pero **los lotes anteriores ya quedaron escritos**. Con 500
 * escrituras o menos hay un solo lote, y por tanto todo o nada.
 *
 * `skipDuplicates`: un alta cuya referencia ya existe en esa pasarela se salta (`skipped`, con el id del cobro
 * que ya estaba) en vez de fallar. Es para la importación.
 */
export async function saveTx(
  supabase: Db,
  writes: readonly TxWrite[],
  opts: { skipDuplicates?: boolean } = {},
): Promise<SaveResult[]> {
  const results: SaveResult[] = [];
  for (let start = 0; start < writes.length; start += SAVE_BATCH_SIZE) {
    const items = writes.slice(start, start + SAVE_BATCH_SIZE).map(toRpcItem);
    const { data } = await supabase
      .rpc("pay_save_transactions", { p_items: items as Json, p_skip_duplicates: opts.skipDuplicates ?? false })
      .throwOnError();
    results.push(...zSaveResults.parse(data));
  }
  return results;
}
