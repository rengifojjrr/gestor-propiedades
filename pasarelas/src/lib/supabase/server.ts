import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./types";

/**
 * Cliente de Supabase para el servidor (Server Components y Server Actions), con la sesión del usuario que
 * viene en las cookies y la clave publicable: la RLS aplica igual que en el navegador.
 * Se crea uno NUEVO en cada petición; nunca se guarda en una variable de módulo.
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch {
            // Un Server Component no puede escribir cookies: la sesión la refresca el proxy (src/proxy.ts).
          }
        },
      },
    },
  );
}
