import "server-only";
import type { Currency, ISODate, Money } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";
import { LIST_LIMIT, RECEIPTS_BUCKET, fileProblem, storedFile } from "./receipts";

/**
 * Las liquidaciones: lo que ya se le pagó a un beneficiario (positivo) o lo que él le devolvió a la empresa
 * (negativo). Su comprobante lo sube el navegador directo a Storage, a la carpeta `{usuario}/{liquidación}/` (por
 * eso el id de la liquidación se genera antes de subir); la base exige que la ruta sea de esa carpeta.
 *
 * Registrar una es idempotente por su id: si la respuesta se pierde por el camino, el formulario vuelve a mandar
 * el mismo id y la liquidación no se duplica.
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
const NOT_UPLOADED = "El archivo no llegó a subirse. Vuelve a intentarlo.";
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

/** ¿Falló el alta porque ya hay una liquidación con ese id? */
function isDuplicateId(error: unknown): boolean {
  return codeOf(error) === "23505" && messageOf(error).includes('"pay_settlements_pkey"');
}

/** La liquidación con ese id, o `null` si no existe (o es de otro usuario). */
async function existing(supabase: Db, id: string): Promise<{ receiptPath: string | null } | null> {
  const { data } = await supabase
    .from("pay_settlements")
    .select("receipt_path")
    .eq("id", id)
    .maybeSingle()
    .throwOnError();
  return data === null ? null : { receiptPath: data.receipt_path };
}

/**
 * El comprobante como lo tiene Storage. Tiene que ser un archivo de la carpeta de la liquidación (la base lo vuelve
 * a mirar), y lo que se guarda es el tipo y el tamaño que dice Storage, no lo que declara el navegador. Si lo de
 * Storage no se admite, el archivo se borra y se rechaza.
 */
async function storedReceipt(supabase: Db, s: SettlementInput): Promise<SettlementInput["receipt"]> {
  if (s.receipt === null) return null;
  const [owner, folder, name, ...rest] = s.receipt.path.split("/");
  if (!owner || folder !== s.id || !name || rest.length > 0) throw new UserError(WRONG_FOLDER);
  // Lo declarado se mira primero porque no cuesta ir a Storage; lo que decide es lo que diga Storage.
  const declared = fileProblem(s.receipt.mime, s.receipt.sizeBytes);
  if (declared !== null) throw new UserError(declared);
  const stored = await storedFile(supabase, s.receipt.path);
  if (stored === null) throw new UserError(NOT_UPLOADED);
  const real = fileProblem(stored.mime, stored.sizeBytes);
  if (real !== null) {
    await supabase.storage.from(RECEIPTS_BUCKET).remove([s.receipt.path]);
    throw new UserError(real);
  }
  return { path: s.receipt.path, ...stored };
}

/**
 * Registra la liquidación con su id y devuelve ese id. Si ya hay una con ese id —el mismo envío que llega dos veces,
 * p. ej. un reintento tras un corte—, no crea otra y devuelve su id. Si ese reintento subió otro comprobante, lo
 * borra: la liquidación ya tiene el suyo.
 */
export async function saveSettlement(supabase: Db, s: SettlementInput): Promise<string> {
  const receipt = await storedReceipt(supabase, s);
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
        receipt_path: receipt?.path ?? null,
        receipt_mime: receipt?.mime ?? null,
        receipt_size: receipt?.sizeBytes ?? null,
      })
      .throwOnError();
  } catch (error) {
    const already = isDuplicateId(error) ? await existing(supabase, s.id) : null;
    if (already !== null) {
      // Si no se puede borrar, el archivo de más queda en la carpeta de la liquidación: no se le enseña a nadie.
      if (receipt !== null && receipt.path !== already.receiptPath) {
        await supabase.storage.from(RECEIPTS_BUCKET).remove([receipt.path]);
      }
      return s.id;
    }
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
