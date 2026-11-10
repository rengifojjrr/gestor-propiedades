/**
 * CSV para descargar. Dos cuidados: las comillas de siempre, y que una hoja de cálculo no tome por fórmula un texto
 * que escribió alguien (una nota, una referencia, un nombre).
 */
import { isMoney } from "./decimal";

export type CsvFormat = { delimiter: "," | ";"; decimal: "." | ","; bom: boolean };

/** Para abrirlo tal cual en una hoja de cálculo en español: punto y coma, coma decimal y BOM. */
export const CSV_ES: CsvFormat = { delimiter: ";", decimal: ",", bom: true };
/** El de siempre, para otros programas: coma, punto decimal y sin BOM. */
export const CSV_STD: CsvFormat = { delimiter: ",", decimal: ".", bom: false };

const BOM = "\uFEFF";
const EOL = "\r\n";
/** Con cualquiera de estos comienzos, una hoja de cálculo puede tomar la celda por una fórmula. */
const FORMULA_START = /^[=+\-@\t\r]/;
const QUOTE_OR_LINE_BREAK = /["\r\n]/;

/** Texto libre: con un apóstrofo delante, la hoja de cálculo lo muestra como texto y no lo ejecuta. */
function textCell(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Un monto canónico ("-3.20"): solo cambia el separador decimal. No lleva apóstrofo aunque empiece por «-». */
function moneyCell(money: string, fmt: CsvFormat): string {
  return fmt.decimal === "," ? money.replace(".", ",") : money;
}

/** Entre comillas dobles si lleva el delimitador, comillas o saltos de línea; las comillas de adentro se duplican. */
function quoted(cell: string, fmt: CsvFormat): string {
  return cell.includes(fmt.delimiter) || QUOTE_OR_LINE_BREAK.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/**
 * Arma el CSV: una línea de encabezado y una por fila, todas terminadas en `\r\n`. `null` es una celda vacía.
 *
 * `moneyColumns` son las posiciones (desde 0) de las columnas de dinero. En ellas un monto canónico sale tal cual,
 * salvo el separador decimal del formato. Todo lo demás es texto y lleva la protección contra fórmulas: el
 * encabezado, las otras columnas y también lo que llegue a una columna de dinero sin ser un monto.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | null)[])[],
  fmt: CsvFormat,
  moneyColumns: readonly number[] = [],
): string {
  const money = new Set(moneyColumns);
  const line = (cells: readonly string[]): string => cells.map((cell) => quoted(cell, fmt)).join(fmt.delimiter) + EOL;
  const body = rows.map((row) =>
    line(
      row.map((cell, column) => {
        if (cell === null) return "";
        return money.has(column) && isMoney(cell) ? moneyCell(cell, fmt) : textCell(cell);
      }),
    ),
  );
  return (fmt.bom ? BOM : "") + line(header.map(textCell)) + body.join("");
}
