/**
 * Lo que vale como comprobante, comprobado en el navegador ANTES de subir: los mismos tipos y el mismo tope que el
 * bucket y que la tabla (jpg, png, webp, pdf; hasta 10 MB). Storage solo mira el tipo que se le declara, así que
 * además se miran los primeros bytes del archivo. Funciones puras: no tocan la red.
 */

export type ReceiptMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** El tope del bucket y de la tabla. */
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

/** La extensión con la que se guarda cada tipo en Storage. */
export const RECEIPT_EXTENSION: Record<ReceiptMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/** Para el `accept` de un `<input type="file">`: los tipos y sus extensiones. */
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf";

/** El tipo que corresponde a cada extensión admitida. */
const MIME_OF_EXTENSION: Record<string, ReceiptMime> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Un problema con el archivo de un comprobante: su mensaje ya está escrito para la persona. */
export class ReceiptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptFileError";
  }
}

const TYPE_TEXT ="Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.";
const SIZE_TEXT = "El archivo pesa más de 10 MB.";
const EMPTY_TEXT = "El archivo está vacío.";
const CONTENT_TEXT = "El contenido del archivo no es un JPG, PNG, WebP o PDF: elige otro.";

/**
 * Lo que no vale de un archivo por su nombre, su tipo declarado y su tamaño: el mensaje para la persona, o `null`
 * si vale. La extensión tiene que ser una de las admitidas y el tipo declarado, el que le corresponde.
 */
export function checkReceiptFile(file: { name: string; type: string; size: number }): string | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot === -1 ? "" : file.name.slice(dot + 1).toLowerCase();
  if (!Object.hasOwn(MIME_OF_EXTENSION, extension) || MIME_OF_EXTENSION[extension] !== file.type) return TYPE_TEXT;
  if (file.size <= 0) return EMPTY_TEXT;
  if (file.size > MAX_RECEIPT_BYTES) return SIZE_TEXT;
  return null;
}

/** Cada formato por sus primeros bytes. `null` en una posición = cualquier byte (el tamaño dentro del RIFF). */
const SIGNATURES: readonly { mime: ReceiptMime; bytes: readonly (number | null)[] }[] = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // «RIFF», cuatro bytes de tamaño y «WEBP».
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50] },
  // «%PDF-».
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
];

/** Lo más largo que hay que leer para reconocer cualquiera de los formatos. */
const SNIFF_BYTES = Math.max(...SIGNATURES.map((signature) => signature.bytes.length));

/** Qué es de verdad el archivo, por sus primeros bytes (no por su nombre ni por su tipo declarado). */
export async function sniffReceipt(file: Blob): Promise<ReceiptMime | null> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const match = SIGNATURES.find(
    ({ bytes }) => head.length >= bytes.length && bytes.every((byte, i) => byte === null || head[i] === byte),
  );
  return match?.mime ?? null;
}

/** Lo que no vale del contenido: el mensaje si sus bytes no son del tipo que declara el archivo, o `null`. */
export async function checkReceiptContent(file: Blob): Promise<string | null> {
  return (await sniffReceipt(file)) === file.type ? null : CONTENT_TEXT;
}
