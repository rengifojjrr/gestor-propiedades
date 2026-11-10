"use server";

import "server-only";
import { z } from "zod";
import { neg } from "@/lib/pasarelas";
import { runAction } from "../action";
import * as ops from "../ops/settlements";
import type { ActionResult } from "../result";
import { zCurrency, zDate, zId, zOptionalText, zPositiveMoney } from "../zod";

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

/** Borra la liquidación y su comprobante. */
export async function deleteSettlement(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId }), input, ({ supabase }, { id }) => ops.deleteSettlement(supabase, id));
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
