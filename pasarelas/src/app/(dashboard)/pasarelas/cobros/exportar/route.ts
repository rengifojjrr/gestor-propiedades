import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import type { TxListItem } from "@/server/pasarelas/dto";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { listTx, parseTxFilters } from "@/server/pasarelas/queries/transactions";
import { csvFormatOf, txCsv } from "./csv";

/** Filas por lectura: el tope de la API. */
const EXPORT_PAGE_SIZE = 1000;

/**
 * GET /pasarelas/cobros/exportar: los cobros de TODO el filtro de la URL (las mismas claves que la lista; la página
 * no cuenta), en el orden elegido, como CSV (`cobros-AAAA-MM-DD.csv`, la fecha de hoy en Nueva York).
 * `formato=estandar` da coma y punto decimal; si no, el español (punto y coma, coma decimal y BOM).
 * Sin sesión, o sin el código del segundo factor, `requireSession()` redirige y no sale nada.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await requireSession();
  const now = new Date();
  const today = todayNY(now);
  const params = request.nextUrl.searchParams;
  // Un parámetro repetido llega como lista: `parseTxFilters` se queda con el primero, igual que en la pantalla.
  const sp = Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key)]));
  const { filters, sort } = parseTxFilters(sp, today);

  const [supabase, cfg] = await Promise.all([createClient(), getPayConfig()]);
  const rows: TxListItem[] = [];
  for (let page = 1; ; page += 1) {
    const chunk = await listTx(supabase, filters, sort, page, today, EXPORT_PAGE_SIZE, cfg);
    rows.push(...chunk.rows);
    if (chunk.rows.length === 0 || rows.length >= chunk.total) break;
  }

  return new Response(txCsv(rows, cfg, csvFormatOf(params.get("formato"))), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cobros-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
