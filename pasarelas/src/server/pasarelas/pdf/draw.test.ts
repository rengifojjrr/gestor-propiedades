import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, test } from "vitest";
import { drawPdf, pdfText } from "./draw";
import type { PdfModel, PdfRow, PdfTotals, PdfTx } from "./model";

/**
 * El dibujo del PDF: un archivo de verdad (se lee con `unpdf`, que extrae su texto), Carta vertical, con «Página X
 * de Y» al pie, los acentos bien y ningún cobro partido entre dos páginas salvo que no quepa en una.
 */

/** Un cobro de mentira con `rows` filas de reparto; su primera línea dice `ini-<n>` y su última fila, `fin-<n>`. */
function tx(n: string, rows = 6, currency = "USD"): PdfTx {
  const allocation: PdfRow[] = Array.from({ length: rows }, (_, i) => ({
    kind: "monto",
    label: i === rows - 1 ? `fin-${n}` : `fila-${n}-${String(i + 1).padStart(3, "0")}`,
    amount: "1000.00",
    indent: true,
  }));
  return {
    id: `tx-${n}`,
    currency,
    heading: "Tienda Demo · Señales «en línea»",
    when: "mar 10 nov 2026, 12:00",
    source: `OTF Demo · Ref. ini-${n} · ${currency}`,
    status: "Registrado · llega el jue 12 nov",
    breakdown: {
      title: "Desglose",
      rows: [
        { kind: "monto", label: "Bruto", amount: "1000.00" },
        { kind: "monto", label: "OTF Demo", amount: "29.20", detail: "2,9 % + $0,20 de $1.000,00", indent: true },
        { kind: "monto", label: "Comisiones", amount: "29.20" },
        { kind: "dato", label: "Comisión pagada por", value: "Nosotros" },
        { kind: "monto", label: "Neto", amount: "970.80", strong: true },
        { kind: "nota", text: "Se libera hacia el jue 10 dic 2026. La pasarela se lo paga directo a esas personas." },
      ],
    },
    allocation: { title: "Reparto", rows: allocation },
  };
}

function totals(currency: string): PdfTotals {
  return {
    currency,
    count: 1,
    failed: 0,
    gross: "90.30",
    fees: "0.00",
    net: "90.30",
    retention: "0.00",
    payout: "90.30",
    parties: [],
    figures: {
      title: "Cifras",
      rows: [
        { kind: "dato", label: "Cobros", value: "1" },
        { kind: "monto", label: "Llega al banco", amount: "90.30", strong: true },
      ],
    },
    allocation: { title: "Reparto por parte", rows: [{ kind: "nota", text: "Sin reparto." }] },
  };
}

const model = (transactions: PdfTx[], totalsBlocks: PdfTotals[] = []): PdfModel => ({
  scope: "Seleccionados (1)",
  generatedAt: "Generado el sáb 14 nov 2026, 10:32 (hora de Nueva York)",
  transactions,
  totals: totalsBlocks,
});

/** El texto de cada página del PDF. */
async function pagesOf(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

describe("drawPdf", () => {
  test("un PDF de verdad, Carta vertical, con «Página X de Y» y los acentos, la ñ, las comillas y el $", async () => {
    const bytes = await drawPdf(model([tx("01")], [totals("USD"), totals("MXN")]));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    expect(pdf.numPages).toBe(1);
    const page = await pdf.getPage(1);
    expect(page.getViewport({ scale: 1 })).toMatchObject({ width: 612, height: 792 });

    const [text = ""] = await pagesOf(bytes);
    for (const expected of [
      "Cobros",
      "Seleccionados (1)",
      "Generado el sáb 14 nov 2026, 10:32 (hora de Nueva York)",
      "Tienda Demo · Señales «en línea»",
      "mar 10 nov 2026, 12:00",
      "OTF Demo · Ref. ini-01 · USD",
      "Registrado · llega el jue 12 nov",
      "Desglose",
      "Reparto",
      "Bruto $1.000,00",
      "OTF Demo $29,20",
      "2,9 % + $0,20 de $1.000,00",
      "Comisión pagada por Nosotros",
      "Neto $970,80",
      "Totales en USD",
      "Totales en MXN",
      "Llega al banco 90,30 MXN",
      "Sin reparto.",
      "Página 1 de 1",
    ]) {
      expect(text).toContain(expected);
    }
  });

  test("ningún cobro se parte entre dos páginas: cada uno empieza y termina en la misma", async () => {
    const many = Array.from({ length: 14 }, (_, i) => tx(String(i + 1).padStart(2, "0"), 10));
    const pages = await pagesOf(await drawPdf(model(many)));
    expect(pages.length).toBeGreaterThan(2);
    for (const transaction of many) {
      const n = transaction.id.slice(3);
      const starts = pages.findIndex((text) => text.includes(`ini-${n}`));
      const ends = pages.findIndex((text) => text.includes(`fin-${n}`));
      expect(starts, `el cobro ${n}`).toBeGreaterThanOrEqual(0);
      expect(ends, `el cobro ${n}`).toBe(starts);
    }
    pages.forEach((text, i) => expect(text).toContain(`Página ${i + 1} de ${pages.length}`));
  });

  test("un cobro que no cabe en una página se parte, sin perder ni desordenar ninguna fila", async () => {
    const pages = await pagesOf(await drawPdf(model([tx("01", 140)])));
    expect(pages.length).toBeGreaterThan(1);
    const all = pages.join("\n");
    const found = [...all.matchAll(/fila-01-(\d{3})/g)].map((match) => Number(match[1]));
    expect(found).toEqual(Array.from({ length: 139 }, (_, i) => i + 1));
    expect(all).toContain("fin-01");
    pages.forEach((text, i) => expect(text).toContain(`Página ${i + 1} de ${pages.length}`));
  });

  test("sin cobros lo dice", async () => {
    const [text = ""] = await pagesOf(await drawPdf(model([])));
    expect(text).toContain("No hay cobros.");
    expect(text).toContain("Página 1 de 1");
  });
});

describe("pdfText: lo que la fuente del PDF no sabe escribir", () => {
  test("los acentos, la ñ, «», €, — y · quedan; lo demás pasa a su letra sin marcas, o a «?»", () => {
    expect(pdfText("Señal «ñandú» € — · ü")).toBe("Señal «ñandú» € — · ü");
    expect(pdfText("Grupo ő Łódź −5 😀\nfin")).toBe("Grupo o ?ódz -5 ? fin");
  });

  test("y en el PDF se lee así, sin basura", async () => {
    const withOdd = tx("01");
    withOdd.heading = "Grupo ő 😀 −5";
    const [text = ""] = await pagesOf(await drawPdf(model([withOdd])));
    expect(text).toContain("Grupo o ? -5");
  });
});
