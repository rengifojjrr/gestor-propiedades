import { RECEIPT_EXTENSION, ReceiptFileError, type ReceiptMime } from "./check";

/** La calidad de la recodificación: un comprobante se tiene que poder leer, no hace falta más. */
const QUALITY = 0.85;

const UNREADABLE_TEXT = "No se pudo leer la imagen: elige otra foto o un PDF.";

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** El nombre del archivo con otra extensión: `recibo.png` → `recibo.webp`. */
function renamed(name: string, extension: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}

/**
 * Deja una imagen lista para subir: como mucho `maxSide` px por su lado más largo, girada como se ve (la
 * orientación de la cámara) y recodificada en WebP o, si el navegador no codifica WebP, en JPEG. Se recodifica
 * SIEMPRE, aunque ya sea pequeña: así se le quitan los metadatos (la ubicación de la foto, la cámara).
 * Un PDF se devuelve tal cual. Solo en el navegador.
 */
export async function downscaleImage(file: File, maxSide = 1600): Promise<File> {
  if (file.type === "application/pdf") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ReceiptFileError(UNREADABLE_TEXT);
  }
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new ReceiptFileError(UNREADABLE_TEXT);
    // Fondo blanco: en JPEG lo transparente saldría negro.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    // Un navegador que no codifica WebP devuelve PNG: entonces se pide JPEG.
    const webp = await toBlob(canvas, "image/webp");
    const blob = webp?.type === "image/webp" ? webp : await toBlob(canvas, "image/jpeg");
    if (blob === null || blob.type !== "image/jpeg" && blob.type !== "image/webp") {
      throw new ReceiptFileError(UNREADABLE_TEXT);
    }
    const type = blob.type as ReceiptMime;
    return new File([blob], renamed(file.name, RECEIPT_EXTENSION[type]), { type });
  } finally {
    bitmap.close();
  }
}
