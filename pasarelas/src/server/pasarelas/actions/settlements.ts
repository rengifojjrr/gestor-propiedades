"use server";

import "server-only";
import { z } from "zod";
import { MAX_PAYOUTS, MAX_PAYOUT_ITEMS } from "@/components/pasarelas/tx/payoutChunks";
import { isZero, neg, todayNY } from "@/lib/pasarelas";
import { runAction } from "../action";
import * as ops from "../ops/settlements";
import { owedInFilter, type FilterOwed } from "../queries/filter-split";
import { listOwed, type NamedOwedGroup } from "../queries/settlements";
import { parseTxFilters } from "../queries/transactions";
import type { ActionResult } from "../result";
import { zCurrency, zDate, zId, zMoney, zOptionalText, zPositiveMoney } from "../zod";

/**
 * Las Server Actions de las liquidaciones. El comprobante NO pasa por aquí: el navegador lo sube directo a Storage,
 * a la carpeta de la liquidación (su id lo genera el navegador antes de subir), y aquí llega solo su ruta.
 */

/** Los mismos tipos y el mismo tope que el bucket y que la tabla. */
const RECEIPT_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

const zSettlement = z
  .object({
    id: zId,
    beneficiaryId: zId,
    paidOn: zDate,
    currency: zCurrency,
    /** Lo que se escribe es el monto, sin signo; el signo lo pone `direction`. */
    amount: zPositiveMoney,
    direction: z.enum(["pago", "devolucion"], { error: "Elige si es un pago o una devolución" }),
    method: zOptionalText(60),
    note: zOptionalText(500),
    receipt: z
      .object({
        path: z.string().max(300),
        mime: z.enum(RECEIPT_MIMES, { error: "Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF." }),
        sizeBytes: z.number().int().positive().max(MAX_RECEIPT_BYTES, { error: "El archivo pesa más de 10 MB." }),
      })
      .nullish()
      .transform((receipt) => receipt ?? null),
  })
  .transform(({ direction, amount, ...settlement }) => ({
    ...settlement,
    // Una devolución es lo que el beneficiario le devuelve a la empresa: entra con signo negativo.
    amount: direction === "devolucion" ? neg(amount) : amount,
  }));

/** Registra una liquidación: un pago al beneficiario o una devolución suya a la empresa. */
export async function saveSettlement(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zSettlement, input, async ({ supabase }, settlement) => ({
    id: await ops.saveSettlement(supabase, settlement),
  }));
}

/** Borra la liquidación y su carpeta de archivos (el comprobante y lo que dejaron intentos dudosos). */
export async function deleteSettlement(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId }), input, ({ supabase, session }, { id }) =>
    ops.deleteSettlement(supabase, session.userId, id),
  );
}

// ─── Pagos ligados a sus cobros ─────────────────────────────────────────────────────────────────────────────

/** Lo de un cobro en un pago: con su signo (negativo, lo que la parte devuelve), nunca cero. */
const zItemAmount = zMoney.refine((amount) => !isZero(amount), { error: "El monto no puede ser cero" });

/** Lo que tiene un pago además de lo de cada cobro: su id (lo genera el navegador), a quién, en qué moneda y cuándo. */
const zPayoutHead = {
  id: zId,
  beneficiaryId: zId,
  currency: zCurrency,
  paidOn: zDate,
  method: zOptionalText(60),
};

/**
 * «Marcar pagado…» de una parte en el detalle de un cobro: una liquidación con ese cobro. El monto viene con lo que
 * falta y se puede bajar (un pago parcial); el servidor no deja pasar de lo que falta ahora.
 */
export async function recordPayout(input: unknown): Promise<ActionResult<{ created: number }>> {
  return runAction(
    z.object({ ...zPayoutHead, transactionId: zId, amount: zPositiveMoney }),
    input,
    ({ supabase }, { transactionId, amount, ...payout }) =>
      ops.recordPayouts(supabase, [{ ...payout, items: [{ transactionId, amount }] }]),
  );
}

/**
 * Varios pagos de una vez, en una sola transacción: «Marcar todo el reparto pagado…» (una liquidación por parte) y
 * «Pagar repartos…» de la lista (una por parte y moneda, con una parte por cobro). Lo de cada cobro tiene que caber
 * en lo que falta ahora (o, si se le pagó de más, en lo que devuelve).
 */
export async function recordPayouts(input: unknown): Promise<ActionResult<{ created: number }>> {
  const zPayout = z.object({
    ...zPayoutHead,
    items: z
      .array(z.object({ transactionId: zId, amount: zItemAmount }))
      .min(1)
      .max(MAX_PAYOUT_ITEMS),
  });
  return runAction(z.object({ payouts: z.array(zPayout).min(1).max(MAX_PAYOUTS) }), input, ({ supabase }, { payouts }) =>
    ops.recordPayouts(supabase, payouts),
  );
}

/**
 * «Pagar repartos…» de los cobros elegidos: lo que se le debe ahora a cada parte en ellos, por moneda, con su nombre
 * y lo de cada cobro. Solo lee: no revalida nada.
 */
export async function owedForTransactions(input: unknown): Promise<ActionResult<{ groups: NamedOwedGroup[] }>> {
  return runAction(
    z.object({ ids: z.array(zId).min(1).max(MAX_PAYOUT_ITEMS) }),
    input,
    async ({ supabase }, { ids }) => ({ groups: await listOwed(supabase, ids) }),
    { revalidate: [] },
  );
}

/**
 * «Pagar…» desde el «Reparto del filtro» de Cobros: lo que se le debe ahora a esa parte en esa moneda, en los cobros
 * del filtro (`owedInFilter`). `query` es la URL de la lista (sus parámetros, como los lee la página:
 * `parseTxFilters`). Solo lee: no revalida nada. El pago se registra después con `recordPayouts`.
 */
export async function owedForFilter(input: unknown): Promise<ActionResult<{ owed: FilterOwed }>> {
  return runAction(
    z.object({ query: z.string().max(4000), beneficiaryId: zId, currency: zCurrency }),
    input,
    async ({ supabase }, { query, beneficiaryId, currency }) => {
      const params = new URLSearchParams(query);
      // Un parámetro repetido llega como lista: `parseTxFilters` se queda con el primero, igual que en la pantalla.
      const sp = Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key)]));
      const today = todayNY(new Date());
      const { filters } = parseTxFilters(sp, today);
      return { owed: await owedInFilter(supabase, filters, today, beneficiaryId, currency) };
    },
    { revalidate: [] },
  );
}

/** Una URL firmada de 60 segundos para ver el comprobante de una liquidación. Solo lee: no revalida nada. */
export async function settlementReceiptUrl(input: unknown): Promise<ActionResult<{ url: string }>> {
  return runAction(
    z.object({ id: zId }),
    input,
    async ({ supabase }, { id }) => ({ url: await ops.settlementReceiptUrl(supabase, id) }),
    { revalidate: [] },
  );
}
