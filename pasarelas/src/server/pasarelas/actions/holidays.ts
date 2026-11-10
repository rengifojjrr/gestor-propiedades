"use server";

import "server-only";
import { z } from "zod";
import { runAction } from "../action";
import * as ops from "../ops/holidays";
import { MAX_YEAR, MIN_YEAR } from "../queries/holidays";
import type { ActionResult } from "../result";
import { zDate, zId, zText } from "../zod";

/** Las Server Actions de los feriados. */

const YEAR_TEXT = `Año no válido: entre ${MIN_YEAR} y ${MAX_YEAR}`;
const zYear = z
  .number({ error: YEAR_TEXT })
  .int({ error: YEAR_TEXT })
  .min(MIN_YEAR, { error: YEAR_TEXT })
  .max(MAX_YEAR, { error: YEAR_TEXT });

export async function addHoliday(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(z.object({ day: zDate, name: zText(80) }), input, async ({ supabase }, holiday) => ({
    id: await ops.addHoliday(supabase, holiday),
  }));
}

export async function deleteHoliday(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId }), input, ({ supabase }, { id }) => ops.deleteHoliday(supabase, id));
}

/** Carga los feriados bancarios de EE. UU. del año: solo los que faltan. Devuelve cuántos agregó. */
export async function loadUsHolidays(input: unknown): Promise<ActionResult<{ added: number }>> {
  return runAction(z.object({ year: zYear }), input, ({ supabase }, { year }) => ops.loadUsHolidays(supabase, year));
}
