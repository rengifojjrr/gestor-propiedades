"use server";

import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { hasLongDigitRun } from "@/lib/pasarelas";
import { runAction } from "../action";
import * as ops from "../ops/splits";
import type { ActionResult } from "../result";
import { zDate, zId, zOptionalText, zPct, zText } from "../zod";

/**
 * Las Server Actions de Repartos: beneficiarios y esquemas. Delgadas: `runAction` exige la sesión, valida con Zod,
 * llama a `ops/splits.ts` y revalida `/pasarelas` con todo su árbol (un esquema o un beneficiario cambian lo que se
 * ve al registrar, en el libro y en el Resumen). Los porcentajes llegan como texto, tal como los escribió la persona.
 */

const NAME_MAX = 80;
const ALIAS_TEXT = "No escribas números de cuenta: un alias no lleva 7 o más dígitos seguidos";
/** Más líneas que esto no caben en un reparto que se pueda leer. */
const MAX_LINES = 50;

const zOptionalId = zId.nullish().transform((id) => id ?? null);

const zBeneficiary = z.object({
  id: zOptionalId,
  name: zText(NAME_MAX),
  kind: z.enum(["persona", "empresa", "cartera"], { error: "Elige el tipo" }),
  // Un alias, nunca el número de la cuenta: sin 7 o más dígitos seguidos (la base exige lo mismo).
  accountAlias: zOptionalText(NAME_MAX).refine((text) => text === null || !hasLongDigitRun(text), {
    error: ALIAS_TEXT,
  }),
  notes: zOptionalText(500),
});

const zById = z.object({ id: zId });
const zActive = z.object({ id: zId, active: z.boolean() });

/** Crea un beneficiario (sin `id`) o edita el que se indica. */
export async function saveBeneficiary(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zBeneficiary, input, async ({ supabase }, beneficiary) => ({
    id: await ops.saveBeneficiary(supabase, beneficiary),
  }));
}

export async function setBeneficiaryActive(input: unknown): Promise<ActionResult> {
  return runAction(zActive, input, ({ supabase }, { id, active }) => ops.setBeneficiaryActive(supabase, id, active));
}

/** Borra un beneficiario sin historia y lleva a Repartos: su ficha ya no existe. */
export async function deleteBeneficiary(input: unknown): Promise<ActionResult> {
  const result = await runAction(zById, input, ({ supabase }, { id }) => ops.deleteBeneficiary(supabase, id));
  // Fuera de `runAction` (que ya revalidó): `redirect()` lanza, y dentro se tomaría por un fallo.
  if (result.ok) redirect("/pasarelas/repartos");
  return result;
}

const zScheme = z.object({
  schemeId: zOptionalId,
  name: zText(NAME_MAX),
  base: z.enum(["neto", "bruto"], { error: "Elige sobre qué se reparte" }),
  remainderBeneficiaryId: zOptionalId,
  effectiveFrom: zDate,
  lines: z.array(z.object({ beneficiaryId: zId, pct: zPct })).max(MAX_LINES, { error: "Demasiadas líneas" }),
});

/**
 * Guarda un esquema nuevo o una versión nueva de uno que ya existe. Si no suma lo que debe, no guarda nada y dice
 * por qué con el mismo texto que la pantalla.
 */
export async function saveScheme(input: unknown): Promise<ActionResult<{ schemeId: string }>> {
  return runAction(zScheme, input, async ({ supabase }, scheme) => ({
    schemeId: (await ops.saveScheme(supabase, scheme)).schemeId,
  }));
}

/**
 * Corrige la última versión de un esquema que ningún cobro usa: llega con su misma «vigente desde» y la base la
 * reemplaza. Si mientras tanto un cobro empezó a usarla, no cambia nada y lo dice.
 */
export async function correctScheme(input: unknown): Promise<ActionResult<{ schemeId: string }>> {
  return runAction(zScheme.extend({ schemeId: zId }), input, async ({ supabase }, scheme) => ({
    schemeId: (await ops.correctScheme(supabase, scheme)).schemeId,
  }));
}

/** Cambia solo el nombre de un esquema, sin versión nueva (vale también si tiene cobros). */
export async function renameScheme(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId, name: zText(NAME_MAX) }), input, ({ supabase }, { id, name }) =>
    ops.renameScheme(supabase, id, name),
  );
}

export async function setSchemeActive(input: unknown): Promise<ActionResult> {
  return runAction(zActive, input, ({ supabase }, { id, active }) => ops.setSchemeActive(supabase, id, active));
}

/** Borra un esquema sin cobros y lleva a Repartos: su página ya no existe. */
export async function deleteScheme(input: unknown): Promise<ActionResult> {
  const result = await runAction(zById, input, ({ supabase }, { id }) => ops.deleteScheme(supabase, id));
  if (result.ok) redirect("/pasarelas/repartos");
  return result;
}
