"use server";

import "server-only";
import { z } from "zod";
import { runAction } from "../action";
import * as ops from "../ops/holidays";
import { refreshEstimatesTx } from "../ops/transactions";
import { MAX_YEAR, MIN_YEAR } from "../queries/holidays";
import type { ActionResult } from "../result";
import { zDate, zId, zText } from "../zod";

/**
 * Las Server Actions de los feriados. Cada cambio vuelve a calcular la fecha estimada automática de lo que está
 * por caer (`refreshEstimatesTx`) y dice cuántas fechas cambiaron (`refreshed`).
 */

const YEAR_TEXT = `Año no válido: entre ${MIN_YEAR} y ${MAX_YEAR}`;
const zYear = z
  .number({ error: YEAR_TEXT })
  .int({ error: YEAR_TEXT })
  .min(MIN_YEAR, { error: YEAR_TEXT })
  .max(MAX_YEAR, { error: YEAR_TEXT });

export async function addHoliday(input: unknown): Promise<ActionResult<{ id: string; refreshed: number }>> {
  return runAction(z.object({ day: zDate, name: zText(80) }), input, async ({ supabase }, holiday) => {
    const id = await ops.addHoliday(supabase, holiday);
    return { id, refreshed: await refreshEstimatesTx(supabase) };
  });
}

export async function deleteHoliday(input: unknown): Promise<ActionResult<{ refreshed: number }>> {
  return runAction(z.object({ id: zId }), input, async ({ supabase }, { id }) => {
    await ops.deleteHoliday(supabase, id);
    return { refreshed: await refreshEstimatesTx(supabase) };
  });
}

/** Carga los feriados bancarios de EE. UU. del año: solo los que faltan. Devuelve cuántos agregó. */
export async function loadUsHolidays(input: unknown): Promise<ActionResult<{ added: number; refreshed: number }>> {
  return runAction(z.object({ year: zYear }), input, async ({ supabase }, { year }) => {
    const { added } = await ops.loadUsHolidays(supabase, year);
    return { added, refreshed: added === 0 ? 0 : await refreshEstimatesTx(supabase) };
  });
}
