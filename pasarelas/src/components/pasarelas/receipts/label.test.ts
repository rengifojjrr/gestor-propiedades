import { describe, expect, it } from "vitest";
import { receiptFormat, receiptLabel, receiptSize } from "./label";

describe("receiptLabel: un comprobante se reconoce por su tipo y su fecha, nunca por el nombre del archivo", () => {
  it("una imagen o un PDF, con el día en que se agregó (en Nueva York)", () => {
    expect(receiptLabel({ mime: "image/webp", createdAt: "2026-11-10T15:00:00Z" })).toBe("Imagen · 10 nov 2026");
    expect(receiptLabel({ mime: "application/pdf", createdAt: "2026-11-10T15:00:00Z" })).toBe("PDF · 10 nov 2026");
    // 01:30 en UTC todavía es el día anterior en Nueva York.
    expect(receiptLabel({ mime: "image/png", createdAt: "2026-11-11T01:30:00Z" })).toBe("Imagen · 10 nov 2026");
  });

  it("un tipo que no se conoce se nombra como archivo", () => {
    expect(receiptLabel({ mime: "text/plain", createdAt: "2026-01-02T15:00:00Z" })).toBe("Archivo · 2 ene 2026");
  });
});

describe("receiptFormat y receiptSize", () => {
  it("el formato, como lo conoce la persona", () => {
    expect(receiptFormat("image/jpeg")).toBe("JPG");
    expect(receiptFormat("image/png")).toBe("PNG");
    expect(receiptFormat("image/webp")).toBe("WebP");
    expect(receiptFormat("application/pdf")).toBe("PDF");
    expect(receiptFormat("text/plain")).toBe("text/plain");
  });

  it("el tamaño en B, KB o MB, con coma decimal", () => {
    expect(receiptSize(800)).toBe("800 B");
    expect(receiptSize(1024)).toBe("1 KB");
    expect(receiptSize(250_000)).toBe("244 KB");
    expect(receiptSize(1_572_864)).toBe("1,5 MB");
    expect(receiptSize(10 * 1024 * 1024)).toBe("10,0 MB");
  });
});
