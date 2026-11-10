import Papa from "papaparse";
import { MAX_IMPORT_ROWS } from "./plan";

export type CsvFile = { name: string; headers: string[]; rows: Record<string, string>[] };

/**
 * Lee un CSV en el navegador (nunca se sube) con sus encabezados, una fila por línea y sin las vacías. Si pasa de
 * `MAX_IMPORT_ROWS` filas deja de leer y lo dice. El separador lo adivina papaparse (coma, punto y coma…).
 */
export function readCsv(file: File): Promise<CsvFile | { error: string }> {
  return new Promise((resolve) => {
    const rows: Record<string, string>[] = [];
    let headers: string[] = [];
    let tooMany = false;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      step: (result, parser) => {
        headers = result.meta.fields ?? headers;
        rows.push(result.data);
        if (rows.length > MAX_IMPORT_ROWS) {
          tooMany = true;
          parser.abort();
        }
      },
      complete: () => {
        if (tooMany) {
          resolve({
            error: `El archivo tiene más de ${MAX_IMPORT_ROWS} filas. Pártelo en archivos de ${MAX_IMPORT_ROWS} filas como mucho e impórtalos uno por uno.`,
          });
        } else if (rows.length === 0 || headers.length === 0) {
          resolve({ error: "El archivo no trae filas: ¿es la exportación correcta?" });
        } else {
          resolve({ name: file.name, headers, rows });
        }
      },
      error: () => resolve({ error: "No se pudo leer el archivo. Tiene que ser un CSV (texto separado por comas)." }),
    });
  });
}
