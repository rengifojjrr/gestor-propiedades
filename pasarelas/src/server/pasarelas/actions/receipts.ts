"use server";

import "server-only";
import { z } from "zod";
import { runAction } from "../action";
import { receiptSignedUrl, registerReceipt, removeReceipt } from "../ops/receipts";
import type { ActionResult } from "../result";
import { zId } from "../zod";

/**
 * Las Server Actions de los comprobantes. El archivo NO pasa por aquí (una acción admite 1 MB): el navegador lo
 * sube directo a Storage con su propia sesión y después registra su fila con `registerReceiptAction`. Quien decide
 * qué se guarda es `registerReceipt`: la ruta tiene que ser de la carpeta de ese cobro del usuario de la sesión, y
 * el tipo y el tamaño son los que dice Storage. El nombre original del archivo no se recibe ni se guarda: puede
 * traer datos de otra persona.
 */

const zRegister = z.object({
  transactionId: zId,
  path: z.string().max(300),
  mime: z.string().max(100),
  sizeBytes: z.number(),
});

export async function registerReceiptAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction(zRegister, input, async ({ supabase, session }, receipt) => ({
    id: await registerReceipt(supabase, session.userId, receipt),
  }));
}

export async function removeReceiptAction(input: unknown): Promise<ActionResult> {
  return runAction(z.object({ id: zId }), input, ({ supabase }, { id }) => removeReceipt(supabase, id));
}

/**
 * Una URL firmada de 60 segundos para ver el comprobante. Se pide al abrirlo; no se guarda. Solo lee: no revalida
 * nada, para que abrir un comprobante no vuelva a pintar la pantalla entera en el servidor.
 */
export async function receiptUrlAction(input: unknown): Promise<ActionResult<{ url: string }>> {
  return runAction(
    z.object({ id: zId }),
    input,
    async ({ supabase }, { id }) => ({ url: await receiptSignedUrl(supabase, id) }),
    { revalidate: [] },
  );
}
