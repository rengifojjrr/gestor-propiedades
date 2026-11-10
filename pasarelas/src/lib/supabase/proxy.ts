import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_NEXT_PATH, loginPath } from "@/lib/auth/next-path";
import type { Database } from "./types";

const LOGIN = "/login";

/** Las cabeceras contra la caché que `@supabase/ssr` pide enviar cuando cambia las cookies de la sesión. */
const NO_CACHE_HEADERS = ["cache-control", "expires", "pragma"];

/**
 * Lo que corre en cada petición (src/proxy.ts): refresca la sesión y decide solo «hay sesión / no hay sesión».
 *
 * - Sin sesión, todo menos la entrada (`/login` y lo que cuelga de ella) manda a `/login?siguiente=<ruta>`.
 * - Con sesión, `/login` manda al Resumen.
 *
 * El segundo factor NO se mira aquí: lo hace `requireSession()` en cada pantalla y en cada acción, y quien de
 * verdad defiende los datos es la RLS de la base.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          // Para ESTA petición: los Server Components leerán la cookie nueva.
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          // Para el navegador. (`response.cookies` no tiene `setAll`: van una a una.)
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // Nada entre crear el cliente y esta llamada: es la que refresca el token si caducó.
  // `getClaims()` verifica la firma del token; `getSession()` solo leería la cookie.
  const { data } = await supabase.auth.getClaims();
  const hasSession = Boolean(data?.claims);

  const { pathname, search } = request.nextUrl;
  const isEntrance = pathname === LOGIN || pathname.startsWith(`${LOGIN}/`);

  if (!hasSession && !isEntrance) return redirectKeeping(request, response, loginPath(`${pathname}${search}`));
  if (hasSession && pathname === LOGIN) return redirectKeeping(request, response, DEFAULT_NEXT_PATH);
  return response;
}

/** Redirige sin perder lo que Supabase haya escrito en `from` (cookies de la sesión y cabeceras contra la caché). */
function redirectKeeping(request: NextRequest, from: NextResponse, path: string): NextResponse {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const name of NO_CACHE_HEADERS) {
    const value = from.headers.get(name);
    if (value) redirect.headers.set(name, value);
  }
  return redirect;
}
