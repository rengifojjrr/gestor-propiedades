"use server";

import "server-only";
import { z } from "zod";
import { hasLongDigitRun } from "@/lib/pasarelas";
import { runAction } from "../action";
import * as ops from "../ops/accounts";
import type { ActionResult } from "../result";
import { zAlias, zCurrency, zId, zOptionalText } from "../zod";

/** Las Server Actions de las cuentas destino. */

const ACCOUNT_NUMBER_TEXT = "No guardes números de cuenta completos";
const LAST4_TEXT = "Son los últimos 4 dígitos: exactamente 4 números";

/**
 * Lo que va antes de `zAlias`: con 7 o más dígitos seguidos, este mensaje (y no el general de los alias). Si falla,
 * `pipe` no sigue. Los esquemas compartidos se declaran con entrada `unknown`; aquí reciben un texto (o nada).
 */
const noAccountNumber = (text: string | null | undefined) => text == null || !hasLongDigitRun(text);

const zAccountAlias = z
  .string()
  .refine(noAccountNumber, { error: ACCOUNT_NUMBER_TEXT })
  .pipe(zAlias(80) as z.ZodType<string, string>);

const zInstitution = z
  .string()
  .nullish()
  .refine(noAccountNumber, { error: ACCOUNT_NUMBER_TEXT })
  .pipe(zOptionalText(80) as z.ZodType<string | null, string | null | undefined>);

/** Los últimos 4: vacío → `null`; si trae algo, exactamente 4 dígitos (el campo no deja escribir más, pero aquí manda el servidor). */
const zLast4 = z
  .string()
  .nullish()
  .transform((raw, ctx) => {
    const text = (raw ?? "").trim();
    if (text === "") return null;
    if (/^[0-9]{4}$/.test(text)) return text;
    ctx.issues.push({ code: "custom", message: LAST4_TEXT, input: raw });
    return z.NEVER;
  });

const zAccount = z.object({
  id: zId.nullish().transform((id) => id ?? null),
  alias: zAccountAlias,
  institution: zInstitution,
  last4: zLast4,
  currency: zCurrency,
  notes: zOptionalText(500),
});

/** Crea una cuenta (sin `id`) o edita la que se indica. */
export async function saveBankAccount(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zAccount, input, async ({ supabase }, account) => ({
    id: await ops.saveBankAccount(supabase, account),
  }));
}

export async function setBankAccountActive(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId, active: z.boolean() }), input, ({ supabase }, { id, active }) =>
    ops.setBankAccountActive(supabase, id, active),
  );
}

/** Borra la cuenta. Los cobros y las cuentas de pasarela que la usaban quedan sin cuenta. */
export async function deleteBankAccount(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId }), input, ({ supabase }, { id }) => ops.deleteBankAccount(supabase, id));
}
