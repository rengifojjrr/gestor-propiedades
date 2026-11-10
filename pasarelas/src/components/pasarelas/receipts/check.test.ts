import { describe, expect, test } from "vitest";
import { checkReceiptContent, checkReceiptFile, sniffReceipt } from "./check";

const MB = 1024 * 1024;
const TYPE_TEXT = "Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.";
const SIZE_TEXT = "El archivo pesa más de 10 MB.";
const EMPTY_TEXT = "El archivo está vacío.";
const CONTENT_TEXT = "El contenido del archivo no es un JPG, PNG, WebP o PDF: elige otro.";

/** Cabeceras reales de cada formato (los primeros bytes de un archivo de verdad), seguidas de relleno. */
const HEADERS = {
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d],
  // «RIFF», el tamaño del contenido (4 bytes, cualquiera) y «WEBP».
  webp: [0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  // «%PDF-1.7».
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3],
} as const;

const blob = (bytes: readonly number[], type = "") => new Blob([new Uint8Array([...bytes, 1, 2, 3, 4])], { type });

describe("checkReceiptFile", () => {
  test("admite JPG, PNG, WebP y PDF de 1 byte a 10 MB, con la extensión en mayúsculas o minúsculas", () => {
    const allowed = [
      { name: "recibo.jpg", type: "image/jpeg" },
      { name: "recibo.jpeg", type: "image/jpeg" },
      { name: "FOTO.JPG", type: "image/jpeg" },
      { name: "captura.png", type: "image/png" },
      { name: "foto.webp", type: "image/webp" },
      { name: "factura demo.pdf", type: "application/pdf" },
    ];
    for (const file of allowed) {
      expect(checkReceiptFile({ ...file, size: 1 })).toBeNull();
      expect(checkReceiptFile({ ...file, size: 10 * MB })).toBeNull();
    }
  });

  test("rechaza otros tipos, aunque se declaren como imagen", () => {
    const rejected = [
      { name: "animacion.gif", type: "image/gif" },
      { name: "notas.txt", type: "text/plain" },
      { name: "foto.heic", type: "image/heic" },
      { name: "recibo", type: "image/png" },
      { name: "recibo.png.exe", type: "application/octet-stream" },
      // Extensión buena pero tipo declarado vacío o de otro formato.
      { name: "recibo.png", type: "" },
      { name: "recibo.pdf", type: "image/png" },
      { name: "recibo.jpg", type: "image/webp" },
    ];
    for (const file of rejected) expect(checkReceiptFile({ ...file, size: 100 })).toBe(TYPE_TEXT);
  });

  test("rechaza un archivo vacío y uno de más de 10 MB", () => {
    const pdf = { name: "factura.pdf", type: "application/pdf" };
    expect(checkReceiptFile({ ...pdf, size: 0 })).toBe(EMPTY_TEXT);
    expect(checkReceiptFile({ ...pdf, size: 10 * MB + 1 })).toBe(SIZE_TEXT);
    expect(checkReceiptFile({ name: "foto.jpg", type: "image/jpeg", size: 11 * MB })).toBe(SIZE_TEXT);
  });
});

describe("sniffReceipt", () => {
  test("reconoce las cabeceras reales de JPEG, PNG, WebP y PDF", async () => {
    expect(await sniffReceipt(blob(HEADERS.jpeg))).toBe("image/jpeg");
    expect(await sniffReceipt(blob(HEADERS.png))).toBe("image/png");
    expect(await sniffReceipt(blob(HEADERS.webp))).toBe("image/webp");
    expect(await sniffReceipt(blob(HEADERS.pdf))).toBe("application/pdf");
  });

  test("no se fía del tipo declarado: mira los bytes", async () => {
    expect(await sniffReceipt(blob(HEADERS.png, "application/pdf"))).toBe("image/png");
    expect(await sniffReceipt(new Blob(["hola, esto es texto"], { type: "image/png" }))).toBeNull();
  });

  test("no reconoce lo que se le parece sin serlo", async () => {
    // Un RIFF que no es WebP (un WAV), un PNG cortado, un archivo vacío y un «%PDF» sin el guion.
    const wav = [0x52, 0x49, 0x46, 0x46, 0x24, 0x08, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45];
    expect(await sniffReceipt(blob(wav))).toBeNull();
    expect(await sniffReceipt(new Blob([new Uint8Array(HEADERS.png.slice(0, 5))]))).toBeNull();
    expect(await sniffReceipt(new Blob([]))).toBeNull();
    expect(await sniffReceipt(new Blob(["%PDF1.7"]))).toBeNull();
  });
});

describe("checkReceiptContent", () => {
  test("acepta un archivo cuyo contenido es el tipo que declara", async () => {
    expect(await checkReceiptContent(blob(HEADERS.jpeg, "image/jpeg"))).toBeNull();
    expect(await checkReceiptContent(blob(HEADERS.pdf, "application/pdf"))).toBeNull();
  });

  test("un .txt renombrado a .pdf pasa la extensión y el tipo, pero no el contenido", async () => {
    const renamed = new File(["Pagado: 100,00 a Grupo A"], "recibo.pdf", { type: "application/pdf" });

    expect(checkReceiptFile(renamed)).toBeNull();
    expect(await checkReceiptContent(renamed)).toBe(CONTENT_TEXT);
  });

  test("un formato admitido que se declara como otro tampoco pasa", async () => {
    expect(await checkReceiptContent(blob(HEADERS.png, "image/jpeg"))).toBe(CONTENT_TEXT);
  });
});
