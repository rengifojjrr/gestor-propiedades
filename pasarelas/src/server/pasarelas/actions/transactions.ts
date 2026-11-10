"use server";

import "server-only";
import { z } from "zod";
import { nyDate, todayNY } from "@/lib/pasarelas";
import { runAction } from "../action";
import {
  applyRecalcTx,
  createTx,
  depositTx,
  disputeTx,
  editTx,
  failTx,
  previewRecalcTx,
  purgeTx,
  refundTx,
  reopenTx,
  restoreTx,
  revertDepositTx,
  setEstimatedTx,
  setRefundTotalTx,
  transitTx,
  trashTx,
} from "../ops/transactions";
import type { ActionResult } from "../result";
import { zCurrency, zDate, zId, zMoney, zOptionalText, zPositiveMoney, zReference } from "../zod";

/**
 * Las Server Actions de los cobros: delgadas. Cada una recibe `input: unknown` (un POST público), y `runAction`
 * exige la sesión, lo valida con Zod, llama a la operación de `ops/transactions.ts` y revalida las pantallas.
 * El `id` de un cobro nuevo lo pone el cliente, para que el mismo envío repetido no registre dos cobros.
 */

/** Lo más que cabe en la nota de un cobro. */
const NOTE_MAX = 280;

/** Un instante con su zona (`2026-11-13T15:30:00Z`, `…-05:00`). */
const zInstant = z.iso.datetime({ offset: true, error: "Fecha y hora no válidas" });
const zNote = zOptionalText(NOTE_MAX);
const zByIds = z.object({ ids: z.array(zId) });
const zById = z.object({ id: zId });
const zRecalcMode = z.enum(["hoy", "fecha_del_cobro"]);

const zNewTx = z.object({
  id: zId,
  companyId: zId,
  channelId: zId.nullable(),
  gatewayId: zId,
  extraIds: z.array(zId),
  schemeId: zId.nullable(),
  occurredAt: zInstant,
  currency: zCurrency,
  grossOriginal: zPositiveMoney,
  reference: zReference,
  note: zNote,
  status: z.enum(["registrado", "en_transito", "depositado"]).optional(),
  depositedOn: zDate.nullish(),
  bankAccountId: zId.nullish(),
  estimatedDepositOn: zDate.nullish(),
});

/** Lo que no viene (`undefined`) no se toca; lo que viene con `null` se vacía. */
const zEditTx = z.object({
  id: zId,
  companyId: zId.optional(),
  channelId: zId.nullable().optional(),
  gatewayId: zId.optional(),
  extraIds: z.array(zId).optional(),
  schemeId: zId.nullable().optional(),
  occurredAt: zInstant.optional(),
  currency: zCurrency.optional(),
  grossOriginal: zPositiveMoney.optional(),
  reference: zReference.optional(),
  note: zNote.optional(),
  bankAccountId: zId.nullable().optional(),
});

/** Registra un cobro, calculado en el servidor. La fecha del cobro sale de su instante, en Nueva York. */
export async function createTransaction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zNewTx, input, async ({ supabase }, tx) => {
    const { id } = await createTx(supabase, { ...tx, occurredOn: nyDate(tx.occurredAt) });
    return { id };
  });
}

export async function editTransaction(input: unknown): Promise<ActionResult> {
  return runAction(zEditTx, input, ({ supabase }, { id, ...changes }) => editTx(supabase, id, changes));
}

export async function refundTransaction(input: unknown): Promise<ActionResult> {
  const schema = z.object({ id: zId, amount: zPositiveMoney, on: zDate, note: zNote });
  return runAction(schema, input, ({ supabase }, { id, ...refund }) => refundTx(supabase, id, refund));
}

export async function setRefundTotal(input: unknown): Promise<ActionResult> {
  const schema = z.object({ id: zId, total: zMoney });
  return runAction(schema, input, ({ supabase }, { id, total }) => setRefundTotalTx(supabase, id, total));
}

export async function disputeTransaction(input: unknown): Promise<ActionResult> {
  const schema = z.object({ id: zId, action: z.enum(["abrir", "ganar", "perder", "anular"]), on: zDate });
  return runAction(schema, input, ({ supabase }, { id, ...dispute }) => disputeTx(supabase, id, dispute));
}

export async function failTransaction(input: unknown): Promise<ActionResult> {
  return runAction(zById, input, ({ supabase }, { id }) => failTx(supabase, id));
}

export async function reopenTransaction(input: unknown): Promise<ActionResult> {
  return runAction(zById, input, ({ supabase }, { id }) => reopenTx(supabase, id));
}

export async function markInTransit(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(zByIds, input, async ({ supabase }, { ids }) => ({ count: await transitTx(supabase, ids) }));
}

export async function markDeposited(input: unknown): Promise<ActionResult<{ count: number }>> {
  const schema = z.object({ ids: z.array(zId), on: zDate });
  return runAction(schema, input, async ({ supabase }, { ids, on }) => ({ count: await depositTx(supabase, ids, on) }));
}

export async function revertDeposit(input: unknown): Promise<ActionResult> {
  return runAction(zById, input, ({ supabase }, { id }) => revertDepositTx(supabase, id));
}

/** Fija la fecha estimada a mano, o con `date: null` vuelve a la automática. */
export async function setEstimatedDate(input: unknown): Promise<ActionResult> {
  const schema = z.object({ id: zId, date: zDate.nullable() });
  return runAction(schema, input, ({ supabase }, { id, date }) => setEstimatedTx(supabase, id, date));
}

/**
 * Qué cambiaría al recalcular esos cobros, sin escribir nada. «Hoy» es la fecha de Nueva York. Solo lee: no
 * revalida nada.
 */
export async function previewRecalc(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof previewRecalcTx>>>> {
  const schema = z.object({ ids: z.array(zId), mode: zRecalcMode });
  return runAction(
    schema,
    input,
    ({ supabase }, { ids, mode }) => previewRecalcTx(supabase, ids, mode, todayNY(new Date())),
    { revalidate: [] },
  );
}

export async function applyRecalc(input: unknown): Promise<ActionResult<{ count: number }>> {
  const schema = z.object({ ids: z.array(zId), mode: zRecalcMode });
  return runAction(schema, input, async ({ supabase }, { ids, mode }) => ({
    count: await applyRecalcTx(supabase, ids, mode, todayNY(new Date())),
  }));
}

export async function trashTransactions(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(zByIds, input, async ({ supabase }, { ids }) => ({ count: await trashTx(supabase, ids) }));
}

export async function restoreTransactions(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(zByIds, input, async ({ supabase }, { ids }) => ({ count: await restoreTx(supabase, ids) }));
}

/** Borra del todo los cobros de la papelera, con sus archivos de la carpeta del usuario de la sesión. */
export async function purgeTransactions(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(zByIds, input, async ({ supabase, session }, { ids }) => ({
    count: await purgeTx(supabase, session.userId, ids),
  }));
}
