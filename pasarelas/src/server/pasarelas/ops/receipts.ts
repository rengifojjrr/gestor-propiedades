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

/** Lo que Storage sabe de un archivo: su tipo y su tamaño. */
export type StoredFile = { mime: string; sizeBytes: number };

/**
 * El archivo, como lo lista Storage, o `null` si no está. Lo que el usuario no puede ver cuenta como que no está.
 * Un archivo sin tipo o sin tamaño en sus metadatos se da con tipo vacío y tamaño 0: no pasa ninguna comprobación.
 * Lo usan también los logos de las empresas, que viven en el mismo bucket.
 */
export async function storedFile(supabase: Db, path: string): Promise<StoredFile | null> {
  const cut = path.lastIndexOf("/");
  const name = path.slice(cut + 1);
  const { data, error } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .list(path.slice(0, cut), { limit: LIST_LIMIT, search: name });
  if (error) throw error;
  // `search` trae los nombres que se parecen: vale solo el que es igual. Una carpeta viene con `id` nulo.
  const entry = data.find((file) => file.name === name && file.id !== null);
  if (entry === undefined) return null;
  const { mimetype, size } = (entry.metadata ?? {}) as { mimetype?: unknown; size?: unknown };
  return {
    mime: typeof mimetype === "string" ? mimetype : "",
    sizeBytes: typeof size === "number" ? size : 0,
  };
}

/** Un comprobante registrado: su archivo, de qué cobro es, y su tipo y tamaño (los que dio Storage). */
type ReceiptRecord = { transactionId: string; path: string; mime: string; sizeBytes: number };

/** El comprobante registrado con ese id. Si no existe (o es de otro usuario), un error para la persona. */
async function receiptOf(supabase: Db, id: string): Promise<ReceiptRecord> {
  const { data } = await supabase
    .from("pay_transaction_receipts")
    .select("transaction_id, path, mime, size_bytes")
    .eq("id", id)
    .maybeSingle()
    .throwOnError();
  if (data === null) throw new UserError(NOT_FOUND_TEXT);
  return { transactionId: data.transaction_id, path: data.path, mime: data.mime, sizeBytes: data.size_bytes };
}

/**
 * Lo que no se admite de un tipo y un tamaño: el mensaje para la persona, o `null` si los dos valen. Lo usan
 * también los comprobantes de las liquidaciones.
 */
export function fileProblem(mime: string, sizeBytes: number): string | null {
  if (!ALLOWED_MIMES.has(mime)) return "Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.";
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return "El tamaño del archivo no es válido.";
  if (sizeBytes > MAX_BYTES) return "El archivo pesa más de 10 MB.";
  return null;
}

/** Cómo se nombra cada tipo en el historial. */
const TYPE_LABEL: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "application/pdf": "PDF",
};

/**
 * Deja en el historial del cobro que se agregó o se quitó un comprobante. Solo dice el tipo: el nombre original
 * del archivo puede traer datos de otra persona y no va en el historial.
 */
async function logReceipt(
  supabase: Db,
  kind: "comprobante_agregado" | "comprobante_quitado",
  receipt: { id: string; transactionId: string; mime: string; sizeBytes: number },
): Promise<void> {
  const verb = kind === "comprobante_agregado" ? "agregado" : "quitado";
  await supabase
    .from("pay_transaction_events")
    .insert({
      transaction_id: receipt.transactionId,
      kind,
      summary: `Comprobante ${verb} (${TYPE_LABEL[receipt.mime] ?? receipt.mime})`,
      data: { receiptId: receipt.id, mime: receipt.mime, sizeBytes: receipt.sizeBytes },
    })
    .throwOnError();
}

/**
 * Registra un comprobante que el navegador ya subió y devuelve el id de su fila. Antes comprueba, del lado del
 * servidor, que la ruta es un archivo de la carpeta de ese cobro de ese usuario (`{userId}/{transactionId}/…`), que
 * el tipo y el tamaño declarados se admiten y que el archivo de verdad está en Storage.
 *
 * Lo que se guarda es el tipo y el tamaño que dice Storage, no lo que declara el navegador. Si lo de Storage no se
 * admite, borra el archivo y rechaza. El nombre original del archivo no se guarda (no hay dónde): puede traer
 * datos de otra persona. Deja en el historial del cobro el evento `comprobante_agregado`.
 */
export async function registerReceipt(
  supabase: Db,
  userId: string,
  a: { transactionId: string; path: string; mime: string; sizeBytes: number },
): Promise<string> {
  const folder = `${userId}/${a.transactionId}/`;
  const name = a.path.startsWith(folder) ? a.path.slice(folder.length) : "";
  if (name === "" || name.includes("/")) throw new UserError("El comprobante no corresponde a ese cobro.");
  // Lo declarado se mira primero porque no cuesta ir a Storage; lo que decide es lo que diga Storage.
  const declared = fileProblem(a.mime, a.sizeBytes);
  if (declared !== null) throw new UserError(declared);
  const stored = await storedFile(supabase, a.path);
  if (stored === null) throw new UserError("El archivo no llegó a subirse. Vuelve a intentarlo.");
  const real = fileProblem(stored.mime, stored.sizeBytes);
  if (real !== null) {
    // Lo que no se admite no se queda en Storage. Si no se puede borrar, se rechaza igual.
    await supabase.storage.from(RECEIPTS_BUCKET).remove([a.path]);
    throw new UserError(real);
  }
  const { data } = await supabase
    .from("pay_transaction_receipts")
    .insert({
      transaction_id: a.transactionId,
      path: a.path,
      mime: stored.mime,
      size_bytes: stored.sizeBytes,
    })
    .select("id")
    .single()
    .throwOnError();
  await logReceipt(supabase, "comprobante_agregado", { id: data.id, transactionId: a.transactionId, ...stored });
  return data.id;
}

/**
 * Quita un comprobante: primero el archivo y después su fila (al revés, un fallo dejaría un archivo que ya nadie
 * ve). Si el archivo ya no estaba —un borrado anterior que quedó a medias—, quita la fila igual. Deja en el
 * historial del cobro el evento `comprobante_quitado`, solo si fue este borrado el que quitó la fila: si otro lo
 * quitó entretanto (otra pestaña), dice que ya no existe y no repite el evento.
 */
export async function removeReceipt(supabase: Db, id: string): Promise<void> {
  const receipt = await receiptOf(supabase, id);
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([receipt.path]);
  if (error) throw error;
  // Storage no da error cuando no borra: dice qué borró. Si no borró nada y el archivo sigue ahí, no se pudo.
  if (data.length === 0 && (await storedFile(supabase, receipt.path)) !== null) {
    throw new UserError("No se pudo borrar el archivo del comprobante. Inténtalo de nuevo.");
  }
  const { data: deleted } = await supabase
    .from("pay_transaction_receipts")
    .delete()
    .eq("id", id)
    .select("id")
    .throwOnError();
  if (deleted.length === 0) throw new UserError(NOT_FOUND_TEXT);
  await logReceipt(supabase, "comprobante_quitado", { id, ...receipt });
}

/** Una URL firmada para ver el comprobante. Dura 60 segundos: se pide al abrirlo, no se guarda. */
export async function receiptSignedUrl(supabase: Db, id: string): Promise<string> {
  const { path } = await receiptOf(supabase, id);
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
