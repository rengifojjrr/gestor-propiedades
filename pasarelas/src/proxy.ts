import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/** En Next 16 este archivo reemplaza a `middleware.ts`. Corre en Node, antes de cada ruta. */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /*
   * Todo, menos lo que el navegador pide sin sesión y no es privado: los estáticos de Next, el manifiesto y los
   * archivos de imagen de `public/` (los íconos). NO se excluyen rutas de página: una Server Action es un POST
   * a la URL de su página y quedaría fuera del proxy.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
