import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { pdfResponse, txPdf } from "@/server/pasarelas/pdf/cobros";
import { pdfRequestOf } from "@/server/pasarelas/pdf/scope";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";

/**
 * GET /pasarelas/cobros/pdf: el PDF de los cobros elegidos (`id`, uno por cobro) o del filtro de la URL (las mismas
 * claves que la lista y el CSV, más `periodo=hoy`), cada uno con su desglose congelado, como descarga
 * (`cobros-AAAA-MM-DD.pdf` o `cobros-elegidos-AAAA-MM-DD.pdf`, con la fecha de hoy en Nueva York). Hasta 300 cobros:
 * con más responde 422 con el mensaje en texto. Lee con el cliente del usuario: la RLS manda.
 * Sin sesión, o sin el código del segundo factor, `requireSession()` redirige y no sale nada.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await requireSession();
  const now = new Date();
  const pdfRequest = pdfRequestOf(request.nextUrl.searchParams, todayNY(now));
  const [supabase, cfg] = await Promise.all([createClient(), getPayConfig()]);
  return pdfResponse(await txPdf(supabase, cfg, pdfRequest, now));
}
