import "server-only";
import { SETTLEMENT_ALREADY_SAVED_TEXT } from "@/components/pasarelas/splits/settlementText";
import { cmp, type Currency, type ISODate, type Money } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";
import { RECEIPTS_BUCKET, fileProblem, storedFile } from "./receipts";
import { emptyFolder } from "./transactions";

/**
 * Las liquidaciones: lo que ya se le pagó a un beneficiario (positivo) o lo que él le devolvió a la empresa
 * (negativo). Su comprobante lo sube el navegador directo a Storage, a la carpeta `{usuario}/{liquidación}/` (por
 * eso el id de la liquidación se genera antes de subir); la base exige que la ruta sea de esa carpeta.
 *
 * Registrar una es idempotente por su id: si la respuesta se pierde por el camino, el formulario vuelve a mandar
 * el mismo id y la liquidación no se duplica. Un reintento con otros datos no se da por bueno (queda la primera).
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
const NOT_REMOVED = "No se pudo borrar el comprobante de la liquidación. La liquidación sigue ahí: inténtalo de nuevo.";

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

/** Lo que decide si dos envíos con el mismo id son la misma liquidación. */
type SavedSettlement = Pick<SettlementInput, "beneficiaryId" | "paidOn" | "currency" | "amount"> & {
  receiptPath: string | null;
};

/** La liquidación con ese id, o `null` si no existe (o es de otro usuario). */
async function existing(supabase: Db, id: string): Promise<SavedSettlement | null> {
  const { data } = await supabase
    .from("pay_settlements")
    .select("beneficiary_id, paid_on, currency, amount::text, receipt_path")
    .eq("id", id)
    .maybeSingle()
    .throwOnError();
  return data === null
    ? null
    : {
        beneficiaryId: data.beneficiary_id,
        paidOn: data.paid_on,
        currency: data.currency,
        amount: data.amount,
        receiptPath: data.receipt_path,
      };
}

/**
 * ¿Es el reintento la misma liquidación que la ya guardada? Cuentan el beneficiario, la fecha, la moneda, el monto
 * (con su signo) y si tiene comprobante o no. No cuentan el medio ni la nota, ni cuál archivo: volver a elegir el
 * mismo archivo lo sube con otra ruta.
 */
function sameSettlement(saved: SavedSettlement, retry: SettlementInput): boolean {
  return (
    saved.beneficiaryId === retry.beneficiaryId &&
    saved.paidOn === retry.paidOn &&
    saved.currency === retry.currency &&
    cmp(saved.amount, retry.amount) === 0 &&
    (saved.receiptPath === null) === (retry.receipt === null)
  );
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
 * borra: la liquidación ya tiene el suyo. Si el reintento trae otros datos (la persona creyó que no había quedado y
 * cambió algo), no lo da por bueno: dice que quedó la del primer intento. Ahí no borra nada: el archivo nuevo, si lo
 * hay, lo borra el navegador al ver el rechazo.
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
      if (!sameSettlement(already, s)) throw new UserError(SETTLEMENT_ALREADY_SAVED_TEXT);
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

/**
 * Borra la liquidación y su carpeta `{userId}/{id}/` entera: el comprobante y lo que hayan dejado los intentos que no
 * se supo cómo terminaron. Primero los archivos y después la fila (al revés, un fallo dejaría archivos que ya nadie
 * ve). Si Storage deja alguno, no borra la fila y lo dice. Si la carpeta ya estaba vacía —un borrado anterior a
 * medias—, borra la fila igual. `userId` es el usuario de la sesión: la fila se lee con su sesión, así que si existe
 * es suya y la carpeta también.
 */
export async function deleteSettlement(supabase: Db, userId: string, id: string): Promise<void> {
  // Que exista (y sea de esta sesión) antes de tocar Storage; si no, «Esa liquidación ya no existe.».
  await receiptPathOf(supabase, id);
  await emptyFolder(supabase, `${userId}/${id}`, NOT_REMOVED);
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
