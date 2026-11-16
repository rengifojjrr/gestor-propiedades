"use server";

import "server-only";
import { z } from "zod";
import { runAction } from "../action";
import * as ops from "../ops/loaders";
import type { ActionResult } from "../result";
import { zId, zOptionalText, zText } from "../zod";

/** Las Server Actions de los cargadores. */

const zLoader = z.object({
  id: zId.nullish().transform((id) => id ?? null),
  name: zText(80),
  note: zOptionalText(500),
});

/** Crea un cargador (sin `id`) o cambia el nombre y la nota del que se indica. */
export async function saveLoader(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zLoader, input, async ({ supabase }, loader) => ({ id: await ops.saveLoader(supabase, loader) }));
}

export async function setLoaderActive(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId, active: z.boolean() }), input, ({ supabase }, { id, active }) =>
    ops.setLoaderActive(supabase, id, active),
  );
}

/** Borra el cargador, solo si no tiene cobros: si tiene, lo dice y hay que desactivarlo. */
export async function deleteLoader(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId }), input, ({ supabase }, { id }) => ops.deleteLoader(supabase, id));
}
