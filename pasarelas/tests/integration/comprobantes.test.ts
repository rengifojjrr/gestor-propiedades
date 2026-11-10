import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { registerReceipt, removeReceipt } from "@/server/pasarelas/ops/receipts";
import { createTx } from "@/server/pasarelas/ops/transactions";
import { getTx } from "@/server/pasarelas/queries/transactions";
import { adminClient, createUser, seedBasics, unwrap, type TestUser } from "./helpers";

/**
 * Lo que `registerReceipt` y `removeReceipt` dejan en la base, con la sesión real de un usuario de prueba: el tipo y
 * el tamaño que se guardan son los que dice Storage, no los que declara el navegador, y cada comprobante que se
 * agrega o se quita queda en el historial del cobro.
 */

const BUCKET = "comprobantes";
/** Los primeros bytes de un PNG (16 bytes). */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const admin = adminClient();

let user: TestUser;
let txId: string;
let folder: string;

/** Sube `body` a la carpeta del cobro con el tipo que se le declare a Storage. Devuelve la ruta. */
async function upload(name: string, body: Buffer, contentType: string): Promise<string> {
  const path = `${folder}/${name}`;
  const { error } = await user.client.storage.from(BUCKET).upload(path, body, { contentType });
  if (error) throw new Error(`No se pudo subir ${path}: ${error.message}`);
  return path;
}

async function receiptRow(id: string) {
  return unwrap(
    await admin.from("pay_transaction_receipts").select("mime, size_bytes, original_name").eq("id", id).single(),
    "comprobante",
  );
}

/** El historial del cobro, del más antiguo al más reciente, leído con la clave secreta. */
async function events() {
  return unwrap(
    await admin
      .from("pay_transaction_events")
      .select("kind, summary, data")
      .eq("transaction_id", txId)
      .order("at")
      .order("id"),
    "historial",
  );
}

beforeAll(async () => {
  user = await createUser();
  const b = await seedBasics(user.client);
  // El cobro E1 del spec: 100,00 por el canal al 5 %, con Stripe y «Pago rápido».
  ({ id: txId } = await createTx(user.client, {
    id: randomUUID(),
    companyId: b.companyId,
    channelId: b.channelId,
    gatewayId: b.gatewayId,
    extraIds: [b.extraId],
    schemeId: b.schemeId,
    occurredOn: "2026-11-13",
    occurredAt: "2026-11-13T15:30:00Z",
    currency: "USD",
    grossOriginal: "100.00",
    reference: null,
    note: null,
  }));
  folder = `${user.id}/${txId}`;
});

describe("registerReceipt guarda lo que dice Storage", () => {
  it("el tipo y el tamaño guardados son los de Storage aunque el navegador declare otros", async () => {
    const path = await upload(`${randomUUID()}.png`, PNG, "image/png");

    const id = await registerReceipt(user.client, user.id, {
      transactionId: txId,
      path,
      mime: "image/jpeg",
      sizeBytes: 5000,
    });

    // El nombre original del archivo no se guarda: puede traer datos de otra persona.
    expect(await receiptRow(id)).toEqual({ mime: "image/png", size_bytes: PNG.length, original_name: null });
  });

  it("un PDF guarda su tipo y sus bytes reales", async () => {
    const pdf = Buffer.from("%PDF-1.7\n%demo\n");
    const path = await upload(`${randomUUID()}.pdf`, pdf, "application/pdf");

    const id = await registerReceipt(user.client, user.id, {
      transactionId: txId,
      path,
      mime: "image/png",
      sizeBytes: 1,
    });

    expect(await receiptRow(id)).toEqual({ mime: "application/pdf", size_bytes: pdf.length, original_name: null });
  });
});

describe("el historial del cobro", () => {
  it("quitar el mismo comprobante dos veces a la vez (dos pestañas) deja un solo evento", async () => {
    const before = (await events()).length;
    const path = await upload(`${randomUUID()}.png`, PNG, "image/png");
    const id = await registerReceipt(user.client, user.id, {
      transactionId: txId,
      path,
      mime: "image/png",
      sizeBytes: PNG.length,
    });

    const outcomes = await Promise.allSettled([removeReceipt(user.client, id), removeReceipt(user.client, id)]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["fulfilled", "rejected"]);
    const kinds = (await events()).slice(before).map((event) => event.kind);
    expect(kinds).toEqual(["comprobante_agregado", "comprobante_quitado"]);
  });

  it("agregar y quitar un comprobante dejan sus dos eventos, con el tipo y sin el nombre del archivo", async () => {
    const before = (await events()).length;
    const path = await upload(`${randomUUID()}.png`, PNG, "image/png");

    const id = await registerReceipt(user.client, user.id, {
      transactionId: txId,
      path,
      mime: "image/png",
      sizeBytes: PNG.length,
    });
    await removeReceipt(user.client, id);

    const added = (await events()).slice(before);
    expect(added).toEqual([
      {
        kind: "comprobante_agregado",
        summary: "Comprobante agregado (PNG)",
        data: { receiptId: id, mime: "image/png", sizeBytes: PNG.length },
      },
      {
        kind: "comprobante_quitado",
        summary: "Comprobante quitado (PNG)",
        data: { receiptId: id, mime: "image/png", sizeBytes: PNG.length },
      },
    ]);
    // El detalle del cobro los lee como eventos conocidos, del más reciente al más antiguo.
    const detail = await getTx(user.client, txId);
    expect(detail?.events.slice(0, 2).map((event) => event.kind)).toEqual(["comprobante_quitado", "comprobante_agregado"]);
  });
});
