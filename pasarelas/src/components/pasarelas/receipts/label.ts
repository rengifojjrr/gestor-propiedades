import { monthKey, monthLabel, nyDate } from "@/lib/pasarelas/dates";

/**
 * Cómo se nombra un comprobante en pantalla. Nunca por el nombre original del archivo (puede traer datos de otra
 * persona y ya no se guarda): por su tipo, su fecha y su tamaño. Funciones puras.
 */

const FORMAT: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "application/pdf": "PDF",
};

/** El formato del archivo como lo conoce la persona: «JPG», «PDF»… (un tipo desconocido, tal cual). */
export function receiptFormat(mime: string): string {
  return FORMAT[mime] ?? mime;
}

/** `2026-11-10T15:00:00Z` → «Imagen · 10 nov 2026» (el día en Nueva York en que se agregó). */
export function receiptLabel(receipt: { mime: string; createdAt: string }): string {
  const kind = receipt.mime === "application/pdf" ? "PDF" : receipt.mime.startsWith("image/") ? "Imagen" : "Archivo";
  const day = nyDate(receipt.createdAt);
  return `${kind} · ${Number(day.slice(8))} ${monthLabel(monthKey(day))}`;
}

const KB = 1024;
const MB = 1024 * 1024;

/** El tamaño para leerlo: «800 B», «244 KB», «1,5 MB». */
export function receiptSize(bytes: number): string {
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
}
