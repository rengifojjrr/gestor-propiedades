import "server-only";
import { todayNY } from "@/lib/pasarelas/dates";
import type { ISODate, PayConfig, TxSnapshot } from "@/lib/pasarelas/types";
import type { Db } from "../dto";
import { payoutStatuses } from "../queries/settlements";
import { getSnapshots, listTx } from "../queries/transactions";
import { drawPdf } from "./draw";
import { pdfModel, type PdfModel } from "./model";
import { PDF_MAX, pdfFileName, scopeText, tooManyText, type PdfRequest } from "./scope";

/*
 * El PDF de cobros, de la petición a la respuesta. Lee con el cliente del usuario (la RLS manda: lo que no ve no
 * sale, sin error) y no recalcula nada: cada cobro va con su desglose congelado y con lo ya pagado a cada parte de su
 * reparto (`payoutStatuses`, lo mismo que dice su detalle). La sesión la exige la ruta.
 */

/** El PDF y cómo se llama; o, si son más cobros de los que admite, cuántos son y qué decir. */
export type PdfResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; fileName: string; count: number }
  | { ok: false; count: number; message: string };

/**
 * Los cobros que pide `request`, en su orden (los elegidos, en el que se eligieron; los del filtro, en el de la
 * lista), sin los de la papelera; o cuántos son si pasan de `PDF_MAX`.
 */
async function chosen(
  supabase: Db,
  cfg: PayConfig,
  request: PdfRequest,
  today: ISODate,
): Promise<{ txs: TxSnapshot[] } | { tooMany: number }> {
  let ids: string[];
  if (request.kind === "elegidos") {
    if (request.ids.length > PDF_MAX) return { tooMany: request.ids.length };
    ids = request.ids;
  } else {
    // Una sola página de hasta `PDF_MAX`: con ella llega también cuántos tiene el filtro.
    const { rows, total } = await listTx(supabase, request.filters, request.sort, 1, today, PDF_MAX, cfg);
    if (total > PDF_MAX) return { tooMany: total };
    ids = rows.map((row) => row.id);
  }
  const txs = await getSnapshots(supabase, ids);
  return { txs: txs.filter((tx) => tx.deletedAt === null) };
}

/**
 * Lo que dibuja el PDF de los cobros que pide `request`, generado en `now`, con cuántos cobros son; o, si pasan de
 * `PDF_MAX`, cuántos son. Lo pagado a cada parte se lee solo de esos cobros (su reparto, lo retenido y los pagos
 * ligados a ellos), por tramos.
 */
export async function txPdfModel(
  supabase: Db,
  cfg: PayConfig,
  request: PdfRequest,
  now: Date,
): Promise<{ model: PdfModel; count: number } | { tooMany: number }> {
  const today = todayNY(now);
  const found = await chosen(supabase, cfg, request, today);
  if ("tooMany" in found) return found;
  const scope = scopeText(request, found.txs.length, cfg, today);
  const payouts = await payoutStatuses(supabase, found.txs);
  return { model: pdfModel({ txs: found.txs, payouts, cfg, scope, now }), count: found.txs.length };
}

/** El PDF de los cobros que pide `request`, generado en `now` (`txPdfModel`, dibujado). */
export async function txPdf(supabase: Db, cfg: PayConfig, request: PdfRequest, now: Date): Promise<PdfResult> {
  const built = await txPdfModel(supabase, cfg, request, now);
  if ("tooMany" in built) return { ok: false, count: built.tooMany, message: tooManyText(request, built.tooMany) };
  return {
    ok: true,
    bytes: await drawPdf(built.model),
    fileName: pdfFileName(request, todayNY(now)),
    count: built.count,
  };
}

/**
 * La respuesta de la ruta: el PDF como descarga, sin caché; o, si son demasiados cobros, el mensaje en texto con
 * 422, que la pantalla enseña tal cual (no hay descarga rota).
 */
export function pdfResponse(result: PdfResult): Response {
  if (!result.ok) {
    return new Response(result.message, {
      status: 422,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  return new Response(result.bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
