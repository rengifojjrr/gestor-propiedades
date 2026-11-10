/**
 * Lo que «Así lo entendí» dice de las filas antes de importarlas, sin red: cuáles ya existen (por su referencia, en
 * la pasarela o en su papelera), cuáles pueden ser un cobro que se registró a mano con otra referencia o sin ella, y
 * con qué fecha entra depositada una fila si se elige «estos cobros ya se depositaron».
 */
import { daysBetween } from "../dates";
import { dec } from "../decimal";
import type { Currency, ISODate, Money } from "../types";
import type { ImportRow } from "./mapping";

/** Una referencia de la pasarela que ya está guardada, y si ese cobro está en la papelera. */
export type ExistingRef = { reference: string; trashed: boolean };

/** Un cobro registrado a mano en esa empresa y pasarela (fuera de la papelera). */
export type ManualTx = {
  id: string;
  reference: string | null;
  currency: Currency;
  grossOriginal: Money;
  occurredOn: ISODate;
};

export type RepeatCheck = {
  /** Se importan. */
  fresh: ImportRow[];
  /** Ya hay un cobro con esa referencia en la pasarela: no se toca. */
  repeated: ImportRow[];
  /** Ya hay un cobro con esa referencia, pero en la papelera: tampoco se crea. */
  trashed: ImportRow[];
  /** Puede ser un cobro registrado a mano (`match`): se importa solo si la persona lo confirma. */
  possible: { row: ImportRow; match: ManualTx }[];
};

/** A cuántos días, como mucho, un cobro a mano puede ser el mismo que una fila. */
const NEAR_DAYS = 1;

/**
 * Clasifica las filas de un archivo frente a lo que ya está guardado. Primero por referencia exacta (`existing`).
 * Después, de las que quedan, las que coinciden con un cobro registrado a mano de la misma moneda y el mismo bruto,
 * a un día como mucho, que no tiene ninguna de las referencias del archivo (si la tiene, es el repetido de esa
 * fila): cada cobro a mano explica una sola fila, la más próxima en el orden del archivo, y a cada fila le toca el
 * cobro más cercano en fecha (en empate, el primero de la lista).
 */
export function classifyRepeats(
  rows: readonly ImportRow[],
  existing: readonly ExistingRef[],
  manual: readonly ManualTx[],
): RepeatCheck {
  const stored = new Map(existing.map(({ reference, trashed }) => [reference, trashed]));
  const fileRefs = new Set(rows.map((row) => row.reference));
  const free = manual.filter((tx) => tx.reference === null || !fileRefs.has(tx.reference));
  const result: RepeatCheck = { fresh: [], repeated: [], trashed: [], possible: [] };

  for (const row of rows) {
    const trashed = stored.get(row.reference);
    if (trashed !== undefined) {
      (trashed ? result.trashed : result.repeated).push(row);
      continue;
    }
    let best = -1;
    let bestDistance = Infinity;
    for (const [index, tx] of free.entries()) {
      if (tx.currency !== row.currency || !dec(tx.grossOriginal).eq(dec(row.grossOriginal))) continue;
      const distance = Math.abs(daysBetween(tx.occurredOn, row.occurredOn));
      if (distance <= NEAR_DAYS && distance < bestDistance) [best, bestDistance] = [index, distance];
    }
    if (best === -1) result.fresh.push(row);
    else result.possible.push({ row, match: free.splice(best, 1)[0]! });
  }
  return result;
}

/**
 * Con «estos cobros ya se depositaron», la fecha con la que entra depositado un cobro importado: su fecha
 * estimada, si ya llegó (hasta hoy, en Nueva York). Es una estimación: entra en el tiempo real de depósito. Si la
 * fecha todavía no llega, o sin la opción, `null`: queda por caer.
 */
export function depositedOnImport(estimatedOn: ISODate, today: ISODate, alreadyDeposited: boolean): ISODate | null {
  return alreadyDeposited && estimatedOn <= today ? estimatedOn : null;
}
