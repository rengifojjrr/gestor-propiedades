import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  createUser,
  e1Item,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type TestUser,
} from "./helpers";

/**
 * Borrar una cuenta por la API de administración de Auth (lo mismo que hace el botón del panel) se lleva todo lo
 * suyo en cascada. Quien borra ahí es el rol del servicio de Auth, que no tiene permisos sobre las tablas pay_
 * ni sobre el esquema private: los disparadores de las filas borradas tienen que poder correr igual.
 */

const TABLAS = [
  "pay_bank_accounts",
  "pay_beneficiaries",
  "pay_schemes",
  "pay_scheme_versions",
  "pay_scheme_lines",
  "pay_companies",
  "pay_channels",
  "pay_gateways",
  "pay_gateway_fee_versions",
  "pay_gateway_extras",
  "pay_company_gateways",
  "pay_transactions",
  "pay_allocations",
  "pay_transaction_receipts",
  "pay_transaction_events",
  "pay_settlements",
  "pay_holidays",
] as const;

const BUCKET = "comprobantes";
/** La firma de un PNG y el comienzo de su cabecera: basta para subirlo como image/png. */
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

/** Las tablas se recorren por nombre: el mismo cliente, sin los tipos de la base. */
const admin = adminClient() as unknown as SupabaseClient;

/** Cuántas filas de ese usuario hay en cada una de las 17 tablas (leído con la clave secreta). */
async function filasPorTabla(userId: string): Promise<Record<string, number>> {
  const cuenta: Record<string, number> = {};
  for (const tabla of TABLAS) {
    const res = await admin.from(tabla).select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (res.error || res.count === null) throw new Error(`contar ${tabla}: ${res.error?.message ?? "sin cuenta"}`);
    cuenta[tabla] = res.count;
  }
  return cuenta;
}

/**
 * Completa lo que `seedBasics` y el cobro E1 no crean, para que el usuario tenga filas en las 17 tablas.
 * (El esquema por defecto de la empresa y su cuenta de la pasarela ya los deja `seedBasics`.)
 */
async function usarTodasLasTablas(user: TestUser, b: Basics): Promise<{ txId: string; path: string }> {
  const [cobro] = await saveTransactions(user.client, [e1Item(b)]);
  if (!cobro) throw new Error("pay_save_transactions no devolvió el cobro");
  const path = `${user.id}/${cobro.id}/recibo.png`;

  const subida = await user.client.storage.from(BUCKET).upload(path, PNG, { contentType: "image/png" });
  if (subida.error) throw new Error(`subir el comprobante: ${subida.error.message}`);
  unwrap(
    await user.client
      .from("pay_transaction_receipts")
      .insert({ transaction_id: cobro.id, path, mime: "image/png", size_bytes: PNG.length })
      .select("id"),
    "comprobante",
  );
  unwrap(
    await user.client
      .from("pay_settlements")
      .insert({ beneficiary_id: b.beneficiaryIds.a, paid_on: "2026-11-14", amount: "45.15" })
      .select("id"),
    "liquidación",
  );
  unwrap(
    await user.client
      .from("pay_holidays")
      .insert({ day: "2026-11-26", name: "Día de Acción de Gracias" })
      .select("id"),
    "feriado",
  );
  return { txId: cobro.id, path };
}

describe("borrar un usuario por la API de administración", () => {
  let user: TestUser;
  let otro: TestUser;
  let path: string;
  let filasDelOtro: Record<string, number>;

  beforeAll(async () => {
    user = await createUser();
    ({ path } = await usarTodasLasTablas(user, await seedBasics(user.client)));
    // Otro usuario con lo mismo: lo suyo no se toca.
    otro = await createUser();
    await usarTodasLasTablas(otro, await seedBasics(otro.client));
    filasDelOtro = await filasPorTabla(otro.id);
  });

  it("antes de borrarlo tiene filas en las 17 tablas", async () => {
    const cuenta = await filasPorTabla(user.id);

    expect(Object.keys(cuenta)).toHaveLength(17);
    for (const tabla of TABLAS) {
      expect(cuenta[tabla], tabla).toBeGreaterThan(0);
    }
  });

  it("se borra sin error y no queda ninguna fila suya; lo de otro usuario sigue igual", async () => {
    const { error } = await adminClient().auth.admin.deleteUser(user.id);

    expect(error).toBeNull();
    const cuenta = await filasPorTabla(user.id);
    for (const tabla of TABLAS) {
      expect(cuenta[tabla], tabla).toBe(0);
    }
    expect(await filasPorTabla(otro.id)).toEqual(filasDelOtro);
  });

  it("el archivo del comprobante no se borra solo: hay que quitarlo de Storage por la API", async () => {
    // La cascada es de la base. Los archivos se borran por la API de Storage (aquí, con la clave secreta).
    const quitados = unwrap(await adminClient().storage.from(BUCKET).remove([path]), "quitar el archivo");

    expect(quitados.map((archivo) => archivo.name)).toEqual([path]);
  });
});
