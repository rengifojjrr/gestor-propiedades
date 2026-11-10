"use server";

import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ZERO, cmp } from "@/lib/pasarelas";
import type { Money } from "@/lib/pasarelas";
import { runAction } from "../action";
import {
  addFeeVersion as addFeeVersionOp,
  createGateway as createGatewayOp,
  deleteExtra as deleteExtraOp,
  deleteFeeVersion as deleteFeeVersionOp,
  deleteGateway as deleteGatewayOp,
  removeInternational as removeInternationalOp,
  saveExtra as saveExtraOp,
  saveInternational as saveInternationalOp,
  setGatewayActive as setGatewayActiveOp,
  updateGateway as updateGatewayOp,
} from "../ops/gateways";
import { refreshEstimatesAfterTx } from "../ops/transactions";
import type { ActionResult } from "../result";
import { zDate, zId, zMoney, zOptionalText, zPct, zText } from "../zod";

/**
 * Las Server Actions de la pantalla Pasarelas: delgadas. Cada una recibe `input: unknown` (un POST público), y
 * `runAction` exige la sesión, lo valida con Zod, llama a la operación de `ops/gateways.ts` y revalida `/pasarelas`
 * con todo su árbol (una tarifa o una opción cambian lo que se ve al registrar, en los cobros y en el Resumen).
 * Los días y los montos llegan como texto, tal como los escribió la persona.
 */

/** Los topes de la base. */
const NAME_MAX = 80;
const NOTES_MAX = 500;
const FEE_NOTE_MAX = 200;
const DAYS_MAX = 60;

const DAYS_TEXT = `Escribe un número de días entre 0 y ${DAYS_MAX}`;

/** Un número entero de días de 0 a 60, escrito como texto («2»). */
const zDays = z
  .string({ error: DAYS_TEXT })
  .trim()
  .regex(/^\d{1,2}$/, { error: DAYS_TEXT })
  .transform(Number)
  .refine((days) => days <= DAYS_MAX, { error: DAYS_TEXT });

/** Días propios de una opción: vacío → `null` (usa los de la pasarela). */
const zOptionalDays = z
  .string({ error: DAYS_TEXT })
  .nullish()
  .transform((raw, ctx) => {
    const text = (raw ?? "").trim();
    if (text === "") return null;
    const parsed = zDays.safeParse(text);
    if (parsed.success) return parsed.data;
    ctx.issues.push({ code: "custom", message: DAYS_TEXT, input: raw });
    return z.NEVER;
  });

/** Una cuota fija o un costo: cero o más. */
const zFee: z.ZodType<Money> = zMoney.refine((money) => cmp(money, ZERO) >= 0, { error: "No puede ser negativo" });

const zGatewayFields = z.object({
  name: zText(NAME_MAX),
  payoutDays: zDays,
  payoutDayType: z.enum(["habiles", "corridos"], { error: "Elige días hábiles o corridos" }),
  refundsReturnFee: z.boolean(),
  disputeFee: zFee,
  notes: zOptionalText(NOTES_MAX),
});

const zExtraFields = z.object({
  name: zText(NAME_MAX),
  pct: zPct,
  fixed: zFee,
  base: z.enum(["bruto", "despues_de_comision"], { error: "Elige sobre qué se calcula" }),
  defaultOn: z.boolean(),
  payoutDaysOverride: zOptionalDays,
});

/** El recargo a los pagos internacionales: porcentaje y fijo, que pueden ser 0 y nunca negativos. */
const zInternationalFee = z.object({ pct: zPct, fixed: zFee });

const zById = z.object({ id: zId });

/**
 * Crea la pasarela con su primera tarifa, sus opciones y, si cobra un recargo a los pagos internacionales, ese
 * recargo (`international`; `null` o ausente: no cobra), de una vez. Devuelve su id.
 */
export async function createGateway(input: unknown): Promise<ActionResult<{ id: string }>> {
  const schema = zGatewayFields.extend({
    pct: zPct,
    fixed: zFee,
    extras: z.array(zExtraFields).max(20),
    international: zInternationalFee.nullish(),
  });
  return runAction(schema, input, ({ supabase }, gateway) => createGatewayOp(supabase, gateway));
}

/**
 * Guarda los datos de la pasarela. Si cambian sus días al depósito o su tipo de días, la fecha estimada
 * automática de lo que está por caer por esa pasarela se vuelve a calcular: `refreshed` dice cuántas cambiaron
 * (con los mismos días no cambia ninguna; `null` si no se pudieron recalcular: la pasarela quedó guardada).
 */
export async function updateGateway(input: unknown): Promise<ActionResult<{ refreshed: number | null }>> {
  const schema = zGatewayFields.extend({ id: zId });
  return runAction(schema, input, async ({ supabase }, { id, ...fields }) => {
    await updateGatewayOp(supabase, id, fields);
    return { refreshed: await refreshEstimatesAfterTx(supabase, { gatewayId: id }) };
  });
}

export async function setGatewayActive(input: unknown): Promise<ActionResult> {
  const schema = z.object({ id: zId, active: z.boolean() });
  return runAction(schema, input, ({ supabase }, { id, active }) => setGatewayActiveOp(supabase, id, active));
}

/** Borra la pasarela y, si sale bien, lleva a la lista: su ficha ya no existe. */
export async function deleteGateway(input: unknown): Promise<ActionResult> {
  const result = await runAction(zById, input, ({ supabase }, { id }) => deleteGatewayOp(supabase, id));
  // Fuera de `runAction` (que ya revalidó): `redirect()` lanza, y dentro se tomaría por un fallo.
  if (result.ok) redirect("/pasarelas/pasarelas");
  return result;
}

/** Agrega una tarifa «vigente desde» una fecha. Las que ya existen no se editan. */
export async function addFeeVersion(input: unknown): Promise<ActionResult<{ id: string }>> {
  const schema = z.object({
    gatewayId: zId,
    pct: zPct,
    fixed: zFee,
    effectiveFrom: zDate,
    note: zOptionalText(FEE_NOTE_MAX),
  });
  return runAction(schema, input, ({ supabase }, version) => addFeeVersionOp(supabase, version));
}

export async function deleteFeeVersion(input: unknown): Promise<ActionResult> {
  return runAction(zById, input, ({ supabase }, { id }) => deleteFeeVersionOp(supabase, id));
}

/** Agrega una opción (sin `id`) o edita una de la pasarela (con `id`). */
export async function saveExtra(input: unknown): Promise<ActionResult<{ id: string }>> {
  const schema = zExtraFields.extend({ id: zId.nullish(), gatewayId: zId, active: z.boolean() });
  return runAction(schema, input, ({ supabase }, extra) => saveExtraOp(supabase, extra));
}

export async function deleteExtra(input: unknown): Promise<ActionResult> {
  return runAction(zById, input, ({ supabase }, { id }) => deleteExtraOp(supabase, id));
}

/** Agrega el recargo internacional de la pasarela (sin `id`) o cambia el que tiene encendido (con `id`). */
export async function saveInternational(input: unknown): Promise<ActionResult<{ id: string }>> {
  const schema = zInternationalFee.extend({ id: zId.nullish(), gatewayId: zId });
  return runAction(schema, input, ({ supabase }, fee) => saveInternationalOp(supabase, fee));
}

/** Quita (apaga) el recargo internacional: lo ya registrado lo conserva en su desglose. */
export async function removeInternational(input: unknown): Promise<ActionResult> {
  return runAction(zById, input, ({ supabase }, { id }) => removeInternationalOp(supabase, id));
}
