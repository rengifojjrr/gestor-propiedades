import { requireSession } from "@/lib/auth/session";
import { todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { exportAll } from "@/server/pasarelas/queries/export";

/**
 * GET /ajustes/exportar: «Exportar todo» como archivo JSON (`pasarelas-AAAA-MM-DD.json`, la fecha de hoy en
 * Nueva York). Sin sesión, o sin el código del segundo factor, `requireSession()` redirige y no sale nada.
 * Se lee con la sesión del usuario: la RLS deja salir solo lo suyo.
 */
export async function GET(): Promise<Response> {
  await requireSession();
  const now = new Date();
  const file = await exportAll(await createClient(), now.toISOString());
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pasarelas-${todayNY(now)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
