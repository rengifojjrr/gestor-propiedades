import PDFDocument from "pdfkit";
import { formatMoney } from "@/lib/pasarelas/money";
import type { Currency } from "@/lib/pasarelas/types";
import type { PdfModel, PdfRow, PdfSection } from "./model";

/*
 * El dibujo del PDF de cobros con pdfkit: página Carta vertical, el encabezado en la primera, cada cobro como un
 * bloque con dos columnas (el desglose y el reparto), los totales por moneda al final y «Página X de Y» al pie de
 * todas. Un bloque no se parte entre dos páginas: si no cabe en lo que queda, pasa a la siguiente; solo si no cabe ni
 * en una página entera se dibuja en una columna, fila por fila, partiéndose donde haga falta.
 *
 * La fuente es la Helvetica que trae todo lector de PDF (no se incrusta nada): escribe en WinAnsi, que tiene los
 * acentos, la ñ, «», €, — y ·. Lo que no está ahí se cambia antes de escribirlo (`pdfText`).
 */

const PAGE = { width: 612, height: 792 };
const MARGIN = 48;
const WIDTH = PAGE.width - 2 * MARGIN;
/** Hasta dónde llega el contenido. pdfkit pasa de página solo más abajo (su margen inferior es menor). */
const BOTTOM = PAGE.height - 56;
const FOOTER_Y = PAGE.height - 36;
const COLUMN_GAP = 20;
const COLUMN = (WIDTH - COLUMN_GAP) / 2;
const INDENT = 10;
const AMOUNT_GAP = 10;
const ROW_GAP = 3;

const REGULAR = "Helvetica";
const BOLD = "Helvetica-Bold";
const SIZE = { title: 20, scope: 10, meta: 8.5, heading: 10.5, text: 9, small: 8, section: 8, footer: 8 };
const INK = "#111111";
const SOFT = "#555555";
const RULE = "#bdbdbd";

// ─── Lo que la fuente sabe escribir ─────────────────────────────────────────────────────────────────────────

/** Lo que WinAnsi tiene además de ASCII y Latin-1. */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const SUBSTITUTES: Record<string, string> = { "−": "-" };

function encodable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(char);
}

/**
 * El texto tal como lo puede escribir la fuente del PDF: lo que WinAnsi no tiene pasa a su letra sin marcas («ő» →
 * «o»), a su equivalente («−» → «-») o, si no hay, a «?». Los saltos de línea y demás controles, a un espacio.
 */
export function pdfText(text: string): string {
  return [...text]
    .map((char) => {
      if (encodable(char)) return char;
      if (/\p{Cc}/u.test(char)) return " ";
      const base = char.normalize("NFD").replace(/\p{M}/gu, "");
      if (base !== char && [...base].every(encodable)) return base;
      return SUBSTITUTES[char] ?? "?";
    })
    .join("");
}

// ─── Medir y escribir ───────────────────────────────────────────────────────────────────────────────────────

type Doc = PDFKit.PDFDocument;
type Style = { font: string; size: number; color: string };

const TEXT: Style = { font: REGULAR, size: SIZE.text, color: INK };
const STRONG: Style = { font: BOLD, size: SIZE.text, color: INK };
const SMALL: Style = { font: REGULAR, size: SIZE.small, color: SOFT };

/** Lo alto que queda `text` con ese estilo en ese ancho (con sus saltos de línea). */
function heightOf(doc: Doc, text: string, style: Style, width: number): number {
  return doc.font(style.font).fontSize(style.size).heightOfString(pdfText(text), { width });
}

function widthOf(doc: Doc, text: string, style: Style): number {
  return doc.font(style.font).fontSize(style.size).widthOfString(pdfText(text));
}

function write(doc: Doc, text: string, style: Style, x: number, y: number, options: PDFKit.Mixins.TextOptions): void {
  doc.font(style.font).fontSize(style.size).fillColor(style.color).text(pdfText(text), x, y, options);
}

/** Algo que se mide antes de dibujarlo: su alto en un ancho dado, y cómo se dibuja ahí. */
type Piece = { height: number; draw: (x: number, y: number) => void };

/**
 * Una fila de una sección en `width`: el monto (o el dato) a la derecha y lo que es a la izquierda, con su detalle en
 * letra chica debajo; una nota ocupa todo el ancho.
 */
function rowPiece(doc: Doc, row: PdfRow, width: number, currency: Currency): Piece {
  if (row.kind === "nota") {
    const height = heightOf(doc, row.text, SMALL, width) + ROW_GAP;
    return { height, draw: (x, y) => write(doc, row.text, SMALL, x, y, { width }) };
  }
  const style = row.kind === "monto" && row.strong ? STRONG : TEXT;
  const value = row.kind === "monto" ? formatMoney(row.amount, currency) : row.value;
  const detail = row.kind === "monto" ? row.detail : undefined;
  const indent = row.kind === "monto" && row.indent ? INDENT : 0;
  const valueWidth = widthOf(doc, value, style);
  const labelWidth = width - indent - valueWidth - AMOUNT_GAP;
  const labelHeight = heightOf(doc, row.label, style, labelWidth);
  const detailHeight = detail === undefined ? 0 : heightOf(doc, detail, SMALL, labelWidth) + 1;
  return {
    height: Math.max(labelHeight, heightOf(doc, value, style, valueWidth + 1)) + detailHeight + ROW_GAP,
    draw: (x, y) => {
      write(doc, row.label, style, x + indent, y, { width: labelWidth });
      write(doc, value, style, x + width - valueWidth, y, { width: valueWidth + 1, lineBreak: false });
      if (detail !== undefined) write(doc, detail, SMALL, x + indent, y + labelHeight + 1, { width: labelWidth });
    },
  };
}

/** El título de una sección («Desglose», «Reparto»). */
function titlePiece(doc: Doc, title: string, width: number): Piece {
  const style: Style = { font: BOLD, size: SIZE.section, color: SOFT };
  return { height: heightOf(doc, title, style, width) + 3, draw: (x, y) => write(doc, title, style, x, y, { width }) };
}

/** Las piezas de una sección en `width`, una debajo de otra: el título y sus filas. */
function sectionPieces(doc: Doc, section: PdfSection, width: number, currency: Currency): Piece[] {
  return [titlePiece(doc, section.title, width), ...section.rows.map((row) => rowPiece(doc, row, width, currency))];
}

/** Lo que mide una lista de piezas puestas una debajo de otra, y cómo se dibuja. */
function stacked(pieces: readonly Piece[]): Piece {
  return {
    height: pieces.reduce((sum, piece) => sum + piece.height, 0),
    draw: (x, y) => {
      let at = y;
      for (const piece of pieces) {
        piece.draw(x, at);
        at += piece.height;
      }
    },
  };
}

// ─── Los bloques ────────────────────────────────────────────────────────────────────────────────────────────

/** Un cobro o los totales de una moneda: un encabezado (con la fecha a la derecha, si hay), líneas y dos secciones. */
type Block = {
  heading: string;
  when: string | null;
  lines: string[];
  sections: [PdfSection, PdfSection];
  currency: Currency;
};

/** La línea gris que separa un bloque del anterior, con su aire. */
function rulePiece(doc: Doc): Piece {
  return {
    height: 10,
    draw: (x, y) => {
      doc
        .moveTo(x, y + 2)
        .lineTo(x + WIDTH, y + 2)
        .lineWidth(0.5)
        .strokeColor(RULE)
        .stroke();
    },
  };
}

/** El encabezado del bloque: lo que es, en negrita, con la fecha a la derecha; debajo, sus líneas. */
function headPieces(doc: Doc, block: Block): Piece[] {
  const heading: Style = { font: BOLD, size: SIZE.heading, color: INK };
  const whenWidth = block.when === null ? 0 : widthOf(doc, block.when, TEXT) + 1;
  const headingWidth = WIDTH - whenWidth - (block.when === null ? 0 : 12);
  const first: Piece = {
    height: heightOf(doc, block.heading, heading, headingWidth) + 2,
    draw: (x, y) => {
      write(doc, block.heading, heading, x, y, { width: headingWidth });
      if (block.when !== null) {
        write(doc, block.when, TEXT, x + WIDTH - whenWidth, y + 1, { width: whenWidth, lineBreak: false });
      }
    },
  };
  const lines = block.lines.map(
    (line): Piece => ({
      height: heightOf(doc, line, TEXT, WIDTH) + 1,
      draw: (x, y) => write(doc, line, TEXT, x, y, { width: WIDTH }),
    }),
  );
  return [rulePiece(doc), first, ...lines, { height: 5, draw: () => undefined }];
}

/** El bloque entero, con las dos secciones lado a lado. */
function blockPiece(doc: Doc, block: Block): Piece {
  const head = stacked(headPieces(doc, block));
  const [left, right] = block.sections.map((section) =>
    stacked(sectionPieces(doc, section, COLUMN, block.currency)),
  ) as [Piece, Piece];
  return {
    height: head.height + Math.max(left.height, right.height) + 6,
    draw: (x, y) => {
      head.draw(x, y);
      left.draw(x, y + head.height);
      right.draw(x + COLUMN + COLUMN_GAP, y + head.height);
    },
  };
}

/** Lo que escribe el PDF, de arriba abajo, pasando de página cuando hace falta. */
class Layout {
  y = MARGIN;

  constructor(private readonly doc: Doc) {}

  /** Una página nueva, arriba. */
  private newPage(): void {
    this.doc.addPage();
    this.y = MARGIN;
  }

  /** Dibuja la pieza aquí si cabe; si no, en una página nueva. */
  place(piece: Piece): void {
    if (this.y + piece.height > BOTTOM) this.newPage();
    piece.draw(MARGIN, this.y);
    this.y += piece.height;
  }

  /**
   * Un bloque entero en una misma página: aquí si cabe y, si no, en la siguiente. Si no cabe ni en una página entera,
   * va en una sola columna, fila por fila, y se parte donde haga falta.
   */
  block(block: Block): void {
    const whole = blockPiece(this.doc, block);
    if (whole.height <= BOTTOM - MARGIN) {
      this.place(whole);
      return;
    }
    const pieces = [
      ...headPieces(this.doc, block),
      ...block.sections.flatMap((section) => sectionPieces(this.doc, section, WIDTH, block.currency)),
    ];
    for (const piece of pieces) this.place(piece);
  }
}

/** El encabezado de la primera página: «Cobros», qué abarca y cuándo se generó. */
function header(doc: Doc, layout: Layout, model: PdfModel): void {
  const title: Style = { font: BOLD, size: SIZE.title, color: INK };
  const scope: Style = { font: REGULAR, size: SIZE.scope, color: INK };
  const meta: Style = { font: REGULAR, size: SIZE.meta, color: SOFT };
  for (const [text, style, gap] of [
    ["Cobros", title, 4],
    [model.scope, scope, 2],
    [model.generatedAt, meta, 8],
  ] as const) {
    layout.place({
      height: heightOf(doc, text, style, WIDTH) + gap,
      draw: (x, y) => write(doc, text, style, x, y, { width: WIDTH }),
    });
  }
}

/** «Página X de Y» al pie de cada página, centrado. */
function footers(doc: Doc): void {
  const { start, count } = doc.bufferedPageRange();
  const style: Style = { font: REGULAR, size: SIZE.footer, color: SOFT };
  for (let i = 0; i < count; i += 1) {
    doc.switchToPage(start + i);
    // Debajo del margen inferior: sin bajarlo, pdfkit abriría otra página para escribirlo.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const centered = { width: WIDTH, align: "center", lineBreak: false } as const;
    write(doc, `Página ${i + 1} de ${count}`, style, MARGIN, FOOTER_Y, centered);
    doc.page.margins.bottom = bottom;
  }
}

/** El PDF del modelo, como bytes. */
export async function drawPdf(model: PdfModel): Promise<Uint8Array<ArrayBuffer>> {
  const doc = new PDFDocument({
    size: "LETTER",
    layout: "portrait",
    margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 40 },
    bufferPages: true,
    lang: "es-ES",
    displayTitle: true,
    info: { Title: "Cobros", Creator: "Pasarelas" },
  });
  const chunks: Uint8Array[] = [];
  doc.on("data", (chunk: Uint8Array) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  const layout = new Layout(doc);
  header(doc, layout, model);
  if (model.transactions.length === 0) {
    const empty: Style = { font: REGULAR, size: SIZE.scope, color: INK };
    layout.place({ height: 14, draw: (x, y) => write(doc, "No hay cobros.", empty, x, y, { width: WIDTH }) });
  }
  for (const tx of model.transactions) {
    layout.block({
      heading: tx.heading,
      when: tx.when,
      lines: [tx.source, tx.status],
      sections: [tx.breakdown, tx.allocation],
      currency: tx.currency,
    });
  }
  for (const totals of model.totals) {
    layout.block({
      heading: `Totales en ${totals.currency}`,
      when: null,
      lines: [],
      sections: [totals.figures, totals.allocation],
      currency: totals.currency,
    });
  }
  footers(doc);
  doc.end();
  await ended;

  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
