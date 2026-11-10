import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireSession, type Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { errorMessage, isExpectedError } from "./errors";
import type { ActionResult } from "./result";

const FIELDS_TEXT = "Revisa los campos marcados.";

/**
 * El molde de toda Server Action. Una acción es un POST público: lo que llega (`input`) no es de fiar.
 *
 * 1. Exige la sesión (`requireSession()`, fuera de cualquier `try`: sin sesión, o sin el código del segundo factor,
 *    redirige, y esa redirección tiene que llegar a Next).
 * 2. Valida `input` con `schema`. Si no pasa, devuelve los problemas de cada campo y no ejecuta nada.
 * 3. Ejecuta `fn` con el cliente de Supabase del servidor (la sesión de las cookies de la petición: la RLS aplica)
 *    y con lo ya validado.
 * 4. Si `fn` lanza, deja pasar los errores de control de Next y convierte lo demás en un mensaje en español. Un
 *    error que no es de los esperados (`isExpectedError`: un fallo de red, un `ZodError` lanzado, un bug) se
 *    registra antes en el servidor: la persona solo ve el mensaje general, y sin el registro no quedaría rastro de
 *    qué falló. Los esperados (los de la app y los rechazos de la base que tienen su mensaje) no se registran.
 * 5. Si salió bien, revalida las rutas de `opts.revalidate`; si no se pide ninguna, `/pasarelas` con todo su árbol.
 *    Una acción que solo lee (una URL firmada, una vista previa) pasa `{ revalidate: [] }`: revalidar haría que
 *    Next volviera a pintar toda la ruta en el servidor sin que nada hubiera cambiado.
 */
export async function runAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (ctx: { supabase: SupabaseClient<Database>; session: Session }, data: z.output<S>) => Promise<T>,
  opts?: { revalidate?: string[] },
): Promise<ActionResult<T>> {
  const session = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error) as { fieldErrors: Record<string, string[]> };
    return { ok: false, error: FIELDS_TEXT, fieldErrors };
  }
  let data: T;
  try {
    const supabase = await createClient();
    data = await fn({ supabase, session }, parsed.data);
  } catch (error) {
    unstable_rethrow(error);
    if (!isExpectedError(error)) console.error("[runAction]", error);
    return { ok: false, error: errorMessage(error) };
  }
  if (opts?.revalidate === undefined) revalidatePath("/pasarelas", "layout");
  else for (const path of opts.revalidate) revalidatePath(path);
  return { ok: true, data };
}
