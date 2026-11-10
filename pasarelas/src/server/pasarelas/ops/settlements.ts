import "server-only";
import type { Currency, ISODate, Money } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";
import { LIST_LIMIT, RECEIPTS_BUCKET } from "./receipts";

/**
 * Las liquidaciones: lo que ya se le pagó a un beneficiario (positivo) o lo que él le devolvió a la empresa
 * (negativo). Su comprobante lo sube el navegador directo a Storage, a la carpeta `{usuario}/{liquidación}/` (por
 * eso el id de la liquidación se genera antes de subir); la base exige que la ruta sea de esa carpeta.
 */

export type SettlementInput = {
  /** Lo genera quien registra, antes de subir el comprobante: su carpeta lleva este id. */
  id: string;
  beneficiaryId: string;
  paidOn: ISODate;
  currency: Currency;
  /** Con su signo: positivo = pago al beneficiario; negativo = devolución a la empresa. Nunca cero. */
  amount: Money;
  method: string | null;
  note: string | null;
  receipt: { path: string; mime: string; sizeBytes: number } | null;
};

const NOT_FOUND = "Esa liquidación ya no existe.";
const BENEFICIARY_NOT_FOUND = "Ese beneficiario ya no existe.";
const WRONG_FOLDER = "El comprobante no corresponde a esta liquidación.";
const NO_RECEIPT = "Esa liquidación no tiene comprobante.";
const NOT_REMOVED = "No se pudo borrar el archivo del comprobante. Inténtalo de nuevo.";

/** La restricción de la base: la ruta del comprobante es de la carpeta de la liquidación. */
const RECEIPT_FOLDER_CHECK = "pay_settlements_receipt_folder_check";
const SIGNED_URL_SECONDS = 60;

const codeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
const messageOf = (error: unknown): string => {
  const message = typeof error === "object" && error !== null ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" ? message : "";
};

/** Registra la liquidación con su id. Devuelve ese id. */
export async function saveSettlement(supabase: Db, s: SettlementInput): Promise<string> {
  try {
    await supabase
      .from("pay_settlements")
      .insert({
        id: s.id,
        beneficiary_id: s.beneficiaryId,
        paid_on: s.paidOn,
        currency: s.currency,
        amount: s.amount,
        method: s.method,
        note: s.note,
        receipt_path: s.receipt?.path ?? null,
        receipt_mime: s.receipt?.mime ?? null,
        receipt_size: s.receipt?.sizeBytes ?? null,
      })
      .throwOnError();
  } catch (error) {
    if (codeOf(error) === "23503") throw new UserError(BENEFICIARY_NOT_FOUND);
    if (codeOf(error) === "23514" && messageOf(error).includes(RECEIPT_FOLDER_CHECK)) throw new UserError(WRONG_FOLDER);
    throw error;
  }
  return s.id;
}

/** La ruta del comprobante de la liquidación (o `null` si no tiene). Si no existe (o es de otro), un error. */
async function receiptPathOf(supabase: Db, id: string): Promise<string | null> {
  const { data } = await supabase
    .from("pay_settlements")
    .select("receipt_path")
    .eq("id", id)
    .maybeSingle()
    .throwOnError();
  if (data === null) throw new UserError(NOT_FOUND);
  return data.receipt_path;
}

/** ¿Sigue el archivo en Storage? */
async function fileExists(supabase: Db, path: string): Promise<boolean> {
  const cut = path.lastIndexOf("/");
  const name = path.slice(cut + 1);
  const { data, error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .list(path.slice(0, cut), { limit: LIST_LIMIT, search: name });
  if (error) throw error;
  return data.some((file) => file.name === name && file.id !== null);
}

/**
 * Borra la liquidación y su comprobante: primero el archivo y después la fila (al revés, un fallo dejaría un
 * archivo que ya nadie ve). Storage no da error cuando no borra: si no borró nada y el archivo sigue ahí, no se
 * pudo. Si el archivo ya no estaba —un borrado anterior a medias—, borra la fila igual.
 */
export async function deleteSettlement(supabase: Db, id: string): Promise<void> {
  const path = await receiptPathOf(supabase, id);
  if (path !== null) {
    const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path]);
    if (error) throw error;
    if (data.length === 0 && (await fileExists(supabase, path))) throw new UserError(NOT_REMOVED);
  }
  const { data } = await supabase.from("pay_settlements").delete().eq("id", id).select("id").throwOnError();
  if (data.length === 0) throw new UserError(NOT_FOUND);
}

/** Una URL firmada para ver el comprobante de la liquidación. Dura 60 segundos: se pide al abrirlo. */
export async function settlementReceiptUrl(supabase: Db, id: string): Promise<string> {
  const path = await receiptPathOf(supabase, id);
  if (path === null) throw new UserError(NO_RECEIPT);
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
