import { createClient } from "@/lib/supabase/client";
import { registerReceiptAction } from "@/server/pasarelas/actions/receipts";
import type { ActionResult } from "@/server/pasarelas/result";
import { RECEIPT_EXTENSION, ReceiptFileError, checkReceiptContent, checkReceiptFile, type ReceiptMime } from "./check";
import { downscaleImage } from "./downscale";

/**
 * Subir un comprobante desde el navegador: el archivo va DIRECTO a Storage con la sesión de la persona (una Server
 * Action admite 1 MB) y después una acción registra su fila. Las políticas del bucket solo dejan escribir en la
 * carpeta `{id del usuario}/…`; quien decide qué se guarda es `registerReceiptAction`, en el servidor.
 */

/** El bucket privado de los comprobantes (el mismo que usa el servidor). */
const RECEIPTS_BUCKET = "comprobantes";

const UPLOAD_TEXT = "No se pudo subir el comprobante. Inténtalo de nuevo.";
const NO_SESSION_TEXT = "Tu sesión terminó. Vuelve a entrar.";
const UNSURE_TEXT =
  "No se pudo confirmar si el comprobante quedó guardado. Revisa los comprobantes antes de volver a subirlo.";

/**
 * Sube el archivo, tal cual, a `{userId}/{folderId}/{uuid}.{ext}` y dice qué subió. Antes lo comprueba
 * (`checkReceiptFile`) y mira que su contenido sea el tipo que declara (Storage solo mira lo declarado). El nombre
 * en Storage no es el original, y el original no viaja: puede traer datos de otra persona.
 */
export async function uploadToFolder(
  file: File,
  folderId: string,
): Promise<{ path: string; mime: string; sizeBytes: number }> {
  const problem = checkReceiptFile(file) ?? (await checkReceiptContent(file));
  if (problem !== null) throw new ReceiptFileError(problem);
  const supabase = createClient();
  // El id solo arma la ruta; no autoriza nada: lo que se puede escribir lo decide Storage con la sesión.
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (userId === undefined) throw new ReceiptFileError(NO_SESSION_TEXT);
  const mime = file.type as ReceiptMime;
  const path = `${userId}/${folderId}/${crypto.randomUUID()}.${RECEIPT_EXTENSION[mime]}`;
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (error) throw new ReceiptFileError(UPLOAD_TEXT);
  return { path, mime, sizeBytes: file.size };
}

/**
 * Guarda en el servidor lo que apunta a un archivo ya subido (`path`; `null` si no se subió ninguno). Si el servidor
 * lo rechaza (`ok: false`), borra el archivo: nada lo va a usar. Si la llamada lanza (se cortó la conexión), NO lo
 * borra, porque no se sabe si lo guardó y el archivo puede ser suyo; lanza lo mismo. Si no se puede borrar, el
 * archivo queda en su carpeta y se va con ella (al borrar el cobro o la empresa).
 */
export async function saveUploaded<T>(
  path: string | null,
  save: () => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const result = await save();
  if (!result.ok && path !== null) {
    try {
      await createClient().storage.from(RECEIPTS_BUCKET).remove([path]);
    } catch {
      // La persona ya tiene el rechazo en pantalla: no se le enseña un segundo error.
    }
  }
  return result;
}

/**
 * Agrega un comprobante a un cobro: lo comprueba, achica la imagen (un PDF va tal cual), lo sube y registra su
 * fila. Si el servidor rechaza el registro, borra el archivo subido; si no se sabe qué pasó (la respuesta no llegó),
 * lo deja y pide revisar los comprobantes antes de repetir. Devuelve el id del comprobante o el mensaje para la
 * persona. Nunca lanza.
 */
export async function uploadReceipt(file: File, transactionId: string): Promise<ActionResult<{ id: string }>> {
  const problem = checkReceiptFile(file);
  if (problem !== null) return { ok: false, error: problem };
  let uploaded: Awaited<ReturnType<typeof uploadToFolder>>;
  try {
    uploaded = await uploadToFolder(await downscaleImage(file), transactionId);
  } catch (error) {
    return { ok: false, error: error instanceof ReceiptFileError ? error.message : UPLOAD_TEXT };
  }
  try {
    return await saveUploaded(uploaded.path, () => registerReceiptAction({ transactionId, ...uploaded }));
  } catch {
    return { ok: false, error: UNSURE_TEXT };
  }
}
