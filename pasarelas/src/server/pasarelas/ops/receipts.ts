import "server-only";
import type { Db } from "../dto";
import { UserError } from "../errors";

/**
 * Los comprobantes de un cobro. El archivo lo sube el navegador directo a Storage, a la carpeta
 * `{usuario}/{cobro}/` del bucket privado; aquí se registra su fila, se quita y se firma su URL.
 */

/** El bucket privado de los comprobantes (lo crea la migración). */
export const RECEIPTS_BUCKET = "comprobantes";

/** Los mismos tipos y el mismo tope que el bucket y que la tabla: Storage se fía del tipo que se le declara. */
const ALLOWED_MIMES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BYTES = 10 * 1024 * 1024;
const SIGNED_URL_SECONDS = 60;
/** Lo más que da Storage al listar una carpeta de una vez. */
export const LIST_LIMIT = 1000;

const NOT_FOUND_TEXT = "Ese comprobante ya no existe.";

/** ¿Está ese archivo en Storage? Lo que el usuario no puede ver cuenta como que no está. */
async function fileExists(supabase: Db, path: string): Promise<boolean> {
  const cut = path.lastIndexOf("/");
  const name = path.slice(cut + 1);
  const { data, error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .list(path.slice(0, cut), { limit: LIST_LIMIT, search: name });
  if (error) throw error;
  // `search` trae los nombres que se parecen: vale solo el que es igual. Una carpeta viene con `id` nulo.
  return data.some((entry) => entry.name === name && entry.id !== null);
}

/** La ruta del archivo de un comprobante registrado. */
async function pathOf(supabase: Db, id: string): Promise<string> {
  const { data } = await supabase
    .from("pay_transaction_receipts")
    .select("path")
    .eq("id", id)
    .maybeSingle()
    .throwOnError();
  if (data === null) throw new UserError(NOT_FOUND_TEXT);
  return data.path;
}

/**
 * Registra un comprobante que el navegador ya subió y devuelve el id de su fila. Antes comprueba, del lado del
 * servidor, que la ruta es un archivo de la carpeta de ese cobro de ese usuario (`{userId}/{transactionId}/…`), que
 * el tipo y el tamaño declarados se admiten y que el archivo de verdad está en Storage.
 */
export async function registerReceipt(
  supabase: Db,
  userId: string,
  a: { transactionId: string; path: string; mime: string; sizeBytes: number; originalName: string | null },
): Promise<string> {
  const folder = `${userId}/${a.transactionId}/`;
  const name = a.path.startsWith(folder) ? a.path.slice(folder.length) : "";
  if (name === "" || name.includes("/")) throw new UserError("El comprobante no corresponde a ese cobro.");
  if (!ALLOWED_MIMES.has(a.mime)) throw new UserError("Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.");
  if (!Number.isInteger(a.sizeBytes) || a.sizeBytes <= 0) throw new UserError("El tamaño del archivo no es válido.");
  if (a.sizeBytes > MAX_BYTES) throw new UserError("El archivo pesa más de 10 MB.");
  if (!(await fileExists(supabase, a.path))) {
    throw new UserError("El archivo no llegó a subirse. Vuelve a intentarlo.");
  }
  const { data } = await supabase
    .from("pay_transaction_receipts")
    .insert({
      transaction_id: a.transactionId,
      path: a.path,
      mime: a.mime,
      size_bytes: a.sizeBytes,
      original_name: a.originalName,
    })
    .select("id")
    .single()
    .throwOnError();
  return data.id;
}

/**
 * Quita un comprobante: primero el archivo y después su fila (al revés, un fallo dejaría un archivo que ya nadie
 * ve). Si el archivo ya no estaba —un borrado anterior que quedó a medias—, quita la fila igual.
 */
export async function removeReceipt(supabase: Db, id: string): Promise<void> {
  const path = await pathOf(supabase, id);
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path]);
  if (error) throw error;
  // Storage no da error cuando no borra: dice qué borró. Si no borró nada y el archivo sigue ahí, no se pudo.
  if (data.length === 0 && (await fileExists(supabase, path))) {
    throw new UserError("No se pudo borrar el archivo del comprobante. Inténtalo de nuevo.");
  }
  await supabase.from("pay_transaction_receipts").delete().eq("id", id).throwOnError();
}

/** Una URL firmada para ver el comprobante. Dura 60 segundos: se pide al abrirlo, no se guarda. */
export async function receiptSignedUrl(supabase: Db, id: string): Promise<string> {
  const path = await pathOf(supabase, id);
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
