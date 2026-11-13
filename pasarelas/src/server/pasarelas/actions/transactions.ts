"use server";

import "server-only";
import { z } from "zod";
import { nyDate, todayNY } from "@/lib/pasarelas";
import { runAction } from "../action";
import {
  applyRecalcOneTx,
  applyRecalcTx,
  createTx,
  depositOneTx,
  depositTxWithSkips,
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
import type { DepositOutcome } from "../ops/transactions";
import type { ActionResult } from "../result";
import { zCurrency, zDate, zFeesPaidBy, zId, zMoney, zOptionalText, zPositiveMoney, zReference } from "../zod";

/**
 * Las Server Actions de los cobros: delgadas. Cada una recibe `input: unknown` (un POST público), y `runAction`
 * exige la sesión, lo valida con Zod, llama a la operación de `ops/transactions.ts` y revalida las pantallas.
 * El `id` de un cobro nuevo lo pone el cliente, para que el mismo envío repetido no registre dos cobros.
 *
 * Las de un solo cobro llevan `expectedUpdatedAt`: la versión del cobro que vio la persona (el `updatedAt` del DTO
 * con que se pintó la pantalla). Si el cobro cambió desde entonces, la base lo rechaza con un conflicto.
 */

/** Lo más que cabe en la nota de un cobro. */
const NOTE_MAX = 280;

/** Un instante con su zona (`2026-11-13T15:30:00Z`, `…-05:00`). */
const zInstant = z.iso.datetime({ offset: true, error: "Fecha y hora no válidas" });
const zNote = zOptionalText(NOTE_MAX);
const zByIds = z.object({ ids: z.array(zId) });
/** Un cobro y la versión que vio la persona. */
const zSeen = z.object({ id: zId, expectedUpdatedAt: zInstant });
/** El dinero no llega al banco en un día que todavía no pasó (en Nueva York). */
const zDepositDate = zDate.refine((day) => day <= todayNY(new Date()), {
  error: "La fecha del depósito no puede ser futura",
});
const zRecalcMode = z.enum(["hoy", "fecha_del_cobro"]);
/** La versión vista solo vale para un cobro: el detalle. Los lotes no la llevan. */
const ONE_WITH_VERSION = {
  error: "La versión vista solo se manda con un cobro",
  path: ["ids"],
};
const oneIfSeen = ({ ids, expectedUpdatedAt }: { ids: string[]; expectedUpdatedAt?: string }): boolean =>
  expectedUpdatedAt === undefined || ids.length === 1;
/** Las partes de un reparto que no pagan comisión: ids, a lo más tantas como líneas caben en un esquema. */
const zFeeExemptIds = z.array(zId).max(50, { error: "Demasiadas partes" });

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
  depositedOn: zDepositDate.nullish(),
  bankAccountId: zId.nullish(),
  estimatedDepositOn: zDate.nullish(),
  /** Sin decirlo, la comisión la pagó el negocio («nosotros»). */
  feesPaidBy: zFeesPaidBy.optional(),
  /** Quiénes no pagan comisión en ESTE cobro (beneficiarios de líneas del esquema); sin decirlo, los del esquema. */
  feeExemptIds: zFeeExemptIds.optional(),
});

/** Lo que no viene (`undefined`) no se toca; lo que viene con `null` se vacía. */
const zEditTx = zSeen.extend({
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
  feesPaidBy: zFeesPaidBy.optional(),
  feeExemptIds: zFeeExemptIds.optional(),
});

/**
 * Registra un cobro, calculado en el servidor. La fecha del cobro sale de su instante, en Nueva York. `created`
 * es falso si ese id ya estaba guardado con lo mismo (un reenvío): no se creó nada nuevo.
 */
export async function createTransaction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  return runAction(zNewTx, input, ({ supabase }, tx) => createTx(supabase, { ...tx, occurredOn: nyDate(tx.occurredAt) }));
}

export async function editTransaction(input: unknown): Promise<ActionResult> {
  return runAction(zEditTx, input, ({ supabase }, { id, expectedUpdatedAt, ...changes }) =>
    editTx(supabase, id, changes, expectedUpdatedAt),
  );
}

export async function refundTransaction(input: unknown): Promise<ActionResult> {
  const schema = zSeen.extend({ amount: zPositiveMoney, on: zDate, note: zNote });
  return runAction(schema, input, ({ supabase }, { id, expectedUpdatedAt, ...refund }) =>
    refundTx(supabase, id, refund, expectedUpdatedAt),
  );
}

export async function setRefundTotal(input: unknown): Promise<ActionResult> {
  const schema = zSeen.extend({ total: zMoney });
  return runAction(schema, input, ({ supabase }, { id, total, expectedUpdatedAt }) =>
    setRefundTotalTx(supabase, id, total, expectedUpdatedAt),
  );
}

export async function disputeTransaction(input: unknown): Promise<ActionResult> {
  const schema = zSeen.extend({ action: z.enum(["abrir", "ganar", "perder", "anular"]), on: zDate });
  return runAction(schema, input, ({ supabase }, { id, expectedUpdatedAt, ...dispute }) =>
    disputeTx(supabase, id, dispute, expectedUpdatedAt),
  );
}

export async function failTransaction(input: unknown): Promise<ActionResult> {
  return runAction(zSeen, input, ({ supabase }, { id, expectedUpdatedAt }) => failTx(supabase, id, expectedUpdatedAt));
}

export async function reopenTransaction(input: unknown): Promise<ActionResult> {
  return runAction(zSeen, input, ({ supabase }, { id, expectedUpdatedAt }) =>
    reopenTx(supabase, id, expectedUpdatedAt),
  );
}

export async function markInTransit(input: unknown): Promise<ActionResult<{ count: number }>> {
  return runAction(zByIds, input, async ({ supabase }, { ids }) => ({ count: await transitTx(supabase, ids) }));
}

/**
 * Marca depositados los cobros el día `on` (no futuro) y dice cuántos se saltaron y por qué. `onlyPending`: el
 * lote (la barra de Cobros, los próximos depósitos del Resumen) solo deposita lo que está por caer; el detalle de
 * un cobro manda `false` para poder cambiar la fecha de un depósito ya hecho, y además la versión que vio
 * (`expectedUpdatedAt`, con un solo id): si el cobro cambió desde entonces, conflicto.
 */
export async function markDeposited(input: unknown): Promise<ActionResult<DepositOutcome>> {
  const schema = z
    .object({ ids: z.array(zId), on: zDepositDate, onlyPending: z.boolean(), expectedUpdatedAt: zInstant.optional() })
    .refine(oneIfSeen, ONE_WITH_VERSION);
  return runAction(schema, input, ({ supabase }, { ids, on, onlyPending, expectedUpdatedAt }) => {
    const [id] = ids;
    return expectedUpdatedAt !== undefined && id !== undefined
      ? depositOneTx(supabase, id, on, expectedUpdatedAt)
      : depositTxWithSkips(supabase, ids, on, { onlyPending });
  });
}

export async function revertDeposit(input: unknown): Promise<ActionResult> {
  return runAction(zSeen, input, ({ supabase }, { id, expectedUpdatedAt }) =>
    revertDepositTx(supabase, id, expectedUpdatedAt),
  );
}

/** Fija la fecha estimada a mano, o con `date: null` vuelve a la automática. */
export async function setEstimatedDate(input: unknown): Promise<ActionResult> {
  const schema = zSeen.extend({ date: zDate.nullable() });
  return runAction(schema, input, ({ supabase }, { id, date, expectedUpdatedAt }) =>
    setEstimatedTx(supabase, id, date, expectedUpdatedAt),
  );
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

/**
 * Recalcula esos cobros y dice cuántos cambiaron. Desde el detalle de un cobro va además la versión que vio
 * (`expectedUpdatedAt`, con un solo id): si el cobro cambió desde entonces, conflicto.
 */
export async function applyRecalc(input: unknown): Promise<ActionResult<{ count: number }>> {
  const schema = z
    .object({ ids: z.array(zId), mode: zRecalcMode, expectedUpdatedAt: zInstant.optional() })
    .refine(oneIfSeen, ONE_WITH_VERSION);
  return runAction(schema, input, async ({ supabase }, { ids, mode, expectedUpdatedAt }) => {
    const today = todayNY(new Date());
    const [id] = ids;
    return {
      count:
        expectedUpdatedAt !== undefined && id !== undefined
          ? await applyRecalcOneTx(supabase, id, mode, today, expectedUpdatedAt)
          : await applyRecalcTx(supabase, ids, mode, today),
    };
  });
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
