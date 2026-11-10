import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireSession, type Session } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { errorMessage } from "./errors";
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
 * 4. Si `fn` lanza, deja pasar los errores de control de Next y convierte lo demás en un mensaje en español.
 * 5. Si salió bien, revalida `/pasarelas` con todo su árbol, más las rutas de `opts.revalidate`.
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
    return { ok: false, error: errorMessage(error) };
  }
  revalidatePath("/pasarelas", "layout");
  for (const path of opts?.revalidate ?? []) revalidatePath(path);
  return { ok: true, data };
}
