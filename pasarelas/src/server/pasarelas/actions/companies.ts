"use server";

import "server-only";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ZERO, cmp } from "@/lib/pasarelas";
import { runAction } from "../action";
import * as ops from "../ops/companies";
import type { ActionResult } from "../result";
import { zCurrency, zHttpUrl, zId, zMoney, zOptionalText, zPct, zText } from "../zod";

/**
 * Las Server Actions de la pantalla Empresas: delgadas. Cada una recibe `input: unknown` (un POST público), y
 * `runAction` exige la sesión, lo valida con Zod, llama a la operación de `ops/companies.ts` y revalida `/pasarelas`
 * con todo su árbol (los nombres y los costos de una empresa salen en todas las pantallas).
 *
 * Los links solo pueden ser `http(s)://` (`zHttpUrl`) y ningún texto libre puede parecer un número de tarjeta
 * (`zText`, `zOptionalText`). El logo NO pasa por aquí: el navegador lo sube directo a Storage y después
 * `setCompanyLogo` guarda su ruta.
 */

/** Los topes de la base. */
const NAME_MAX = 120;
const NOTES_MAX = 2000;
const PATH_MAX = 300;

const DAYS_TEXT = "Días no válidos: un número entero de 0 a 60";

/** Un id que puede no venir: vacío o ausente es `null` (la opción «ninguno» de una lista). */
const zOptionalId = z
  .union([z.literal(""), zId])
  .nullish()
  .transform((id) => id || null);

/** Un cargo fijo: un monto que no puede ser negativo. */
const zFixed = zMoney.refine((money) => cmp(money, ZERO) >= 0, { error: "No puede ser negativo" });

/** Los días propios hasta el depósito: vacío es `null` (los de la pasarela); si no, un entero de 0 a 60. */
const zPayoutDays = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((raw, ctx) => {
    const text = String(raw ?? "").trim();
    if (text === "") return null;
    if (/^\d{1,2}$/.test(text) && Number(text) <= 60) return Number(text);
    ctx.issues.push({ code: "custom", message: DAYS_TEXT, input: raw });
    return z.NEVER;
  });

const zCompany = z.object({
  id: zId.optional(),
  name: zText(NAME_MAX),
  website: zHttpUrl,
  currency: zCurrency,
  defaultSchemeId: zOptionalId,
  notes: zOptionalText(NOTES_MAX),
});

const zChannel = z.object({
  id: zId.optional(),
  companyId: zId,
  name: zText(NAME_MAX),
  url: zHttpUrl,
  platformFeePct: zPct,
  platformFeeFixed: zFixed,
  active: z.boolean(),
});

const zCompanyGateway = z.object({
  id: zId.optional(),
  companyId: zId,
  gatewayId: zId,
  dashboardUrl: zHttpUrl,
  checkoutUrl: zHttpUrl,
  bankAccountId: zOptionalId,
  payoutDaysOverride: zPayoutDays,
  defaultExtraIds: z.array(zId).nullable(),
});

const zById = z.object({ id: zId });

/** Crea o edita la ficha de una empresa. Devuelve su id. */
export async function saveCompany(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zCompany, input, async ({ supabase }, company) => ({
    id: await ops.saveCompany(supabase, company),
  }));
}

export async function setCompanyActive(input: unknown): Promise<ActionResult> {
  const schema = z.object({ id: zId, active: z.boolean() });
  return runAction(schema, input, ({ supabase }, { id, active }) => ops.setCompanyActive(supabase, id, active));
}

/**
 * Borra una empresa sin cobros, con sus archivos de logo de la carpeta del usuario de la sesión. Si sale bien,
 * lleva a la lista: la ficha ya no existe, y volver a pintarla daría «Esta página no existe».
 */
export async function deleteCompany(input: unknown): Promise<ActionResult> {
  const result = await runAction(zById, input, ({ supabase, session }, { id }) =>
    ops.deleteCompany(supabase, session.userId, id),
  );
  // Fuera de `runAction` (que ya revalidó): `redirect()` lanza, y dentro se tomaría por un fallo.
  if (result.ok) redirect("/pasarelas/empresas");
  return result;
}

/** Guarda (o, con `path: null`, quita) el logo que el navegador ya subió a la carpeta de la empresa. */
export async function setCompanyLogo(input: unknown): Promise<ActionResult> {
  const schema = z.object({ companyId: zId, path: z.string().max(PATH_MAX).nullable() });
  return runAction(schema, input, ({ supabase, session }, logo) => ops.setCompanyLogo(supabase, session.userId, logo));
}

/** Crea o edita un canal de venta de una empresa. Devuelve su id. */
export async function saveChannel(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zChannel, input, async ({ supabase }, channel) => ({
    id: await ops.saveChannel(supabase, channel),
  }));
}

export async function deleteChannel(input: unknown): Promise<ActionResult> {
  return runAction(zById, input, ({ supabase }, { id }) => ops.deleteChannel(supabase, id));
}

/** Agrega o edita la cuenta de una pasarela en una empresa. Devuelve su id. */
export async function saveCompanyGateway(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zCompanyGateway, input, async ({ supabase }, account) => ({
    id: await ops.saveCompanyGateway(supabase, account),
  }));
}

export async function deleteCompanyGateway(input: unknown): Promise<ActionResult> {
  return runAction(zById, input, ({ supabase }, { id }) => ops.deleteCompanyGateway(supabase, id));
}
