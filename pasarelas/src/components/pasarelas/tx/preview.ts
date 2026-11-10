import { diff } from "@/lib/pasarelas/breakdown";
import type { DiffRow, TxSnapshot, TxWrite } from "@/lib/pasarelas/types";
import { PayStateError } from "@/lib/pasarelas/write";

export type PreviewResult = { ok: true; changes: DiffRow[] } | { ok: false; error: string };

/**
 * El antes y el después de un cambio sobre un cobro, antes de confirmarlo: el mismo plan del motor que usará el
 * servidor (`planRefund`, `planDispute`…) sobre el desglose congelado. Sin filas, no cambia ningún número. Si el
 * motor no acepta el cambio, su mensaje; cualquier otro error sigue su camino.
 */
export function previewChange(tx: TxSnapshot, plan: (tx: TxSnapshot) => TxWrite): PreviewResult {
  let write: TxWrite;
  try {
    write = plan(tx);
  } catch (error) {
    if (error instanceof PayStateError) return { ok: false, error: error.message };
    throw error;
  }
  return { ok: true, changes: diff(tx.breakdown, write.fields.breakdown ?? tx.breakdown) };
}
