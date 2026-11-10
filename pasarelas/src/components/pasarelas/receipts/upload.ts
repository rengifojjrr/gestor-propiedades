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

/**
 * Sube el archivo, tal cual, a `{userId}/{folderId}/{uuid}.{ext}` y dice qué subió. Antes lo comprueba
 * (`checkReceiptFile`) y mira que su contenido sea el tipo que declara (Storage solo mira lo declarado). El nombre en Storage no es el original: ese
 * viaja aparte, en `originalName`.
 */
export async function uploadToFolder(
  file: File,
  folderId: string,
): Promise<{ path: string; mime: string; sizeBytes: number; originalName: string }> {
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
  return { path, mime, sizeBytes: file.size, originalName: file.name };
}

/** Borra un archivo que se subió pero no se pudo registrar. Si no se puede, queda en la carpeta del cobro. */
async function discard(path: string): Promise<void> {
  try {
    await createClient().storage.from(RECEIPTS_BUCKET).remove([path]);
  } catch {
    // Lo borrará la papelera con el cobro: no se le enseña a la persona un segundo error.
  }
}

/**
 * Agrega un comprobante a un cobro: lo comprueba, achica la imagen (un PDF va tal cual), lo sube y registra su
 * fila. Si el registro falla, borra el archivo subido. Devuelve el id del comprobante o el mensaje para la persona.
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
  let result: ActionResult<{ id: string }>;
  try {
    result = await registerReceiptAction({ transactionId, ...uploaded, originalName: file.name });
  } catch {
    result = { ok: false, error: UPLOAD_TEXT };
  }
  if (!result.ok) await discard(uploaded.path);
  return result;
}
