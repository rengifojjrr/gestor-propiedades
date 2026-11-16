import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  createUser,
  e1Item,
  expectRejected,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * El cargador de cada cobro (migración 20261117120000): la persona que trajo la venta, para reportarle lo suyo. Es
 * un catálogo del usuario (`pay_loaders`) y una columna opcional del cobro (`pay_transactions.loader_id`). Solo sirve
 * para reportar: no cambia ninguna cifra. Datos inventados: «Cargador Uno», «Cargador Dos».
 *
 * La RLS, el segundo factor y los permisos de `pay_loaders` los recorre `rls.test.ts`, como en todas las tablas.
 */

/** Las columnas del cobro se leen por nombre: el mismo cliente, sin los tipos de la base (hasta regenerarlos). */
const sinTipos = (client: Db): SupabaseClient => client as unknown as SupabaseClient;

async function nuevoCargador(client: Db, name: string): Promise<string> {
  const fila = unwrap(await sinTipos(client).from("pay_loaders").insert({ name }).select("id").single(), name);
  return (fila as { id: string }).id;
}

async function cargadorDe(client: Db, txId: string): Promise<string | null> {
  const fila = unwrap(
    await sinTipos(client).from("pay_transactions").select("loader_id").eq("id", txId).single(),
    "cargador del cobro",
  );
  return (fila as { loader_id: string | null }).loader_id;
}

describe("pay_loaders: el catálogo de cargadores", () => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    [a, b] = await Promise.all([createUser(), createUser()]);
  });

  it("C1: el nombre es único por usuario, sin distinguir mayúsculas ni espacios de más", async () => {
    const id = await nuevoCargador(a.client, "Cargador Uno");
    const fila = unwrap(
      await sinTipos(a.client).from("pay_loaders").select("id, user_id, name, note, active, created_at").eq("id", id).single(),
      "cargador",
    );
    expect(fila).toMatchObject({ id, user_id: a.id, name: "Cargador Uno", note: null, active: true });

    for (const repetido of [" cargador uno ", "CARGADOR  UNO", "cargador\tuno"]) {
      expectRejected(await sinTipos(a.client).from("pay_loaders").insert({ name: repetido }).select("id"), "23505");
    }
    // Otro usuario sí puede tener uno con ese nombre: el único es por usuario.
    await expect(nuevoCargador(b.client, "Cargador Uno")).resolves.toEqual(expect.any(String));
  });

  it("el nombre no puede quedar vacío ni pasar de 80; la nota, de 500", async () => {
    expectRejected(await sinTipos(a.client).from("pay_loaders").insert({ name: "   " }).select("id"), "23514");
    expectRejected(await sinTipos(a.client).from("pay_loaders").insert({ name: "x".repeat(81) }).select("id"), "23514");
    expectRejected(
      await sinTipos(a.client).from("pay_loaders").insert({ name: "Con nota larga", note: "x".repeat(501) }).select("id"),
      "23514",
    );
  });
});

describe("pay_transactions.loader_id: el cargador de un cobro", () => {
  let user: TestUser;
  let otro: TestUser;
  let basics: Basics;

  beforeAll(async () => {
    [user, otro] = await Promise.all([createUser(), createUser()]);
    basics = await seedBasics(user.client);
  });

  it("un cobro sin decirlo queda sin cargador", async () => {
    const [cobro] = await saveTransactions(user.client, [e1Item(basics, { reference: "sin-cargador" })]);
    expect(await cargadorDe(user.client, cobro!.id)).toBeNull();
  });

  it("pay_save_transactions acepta loader_id en el alta y en la actualización; sin decirlo no lo toca", async () => {
    const uno = await nuevoCargador(user.client, "Cargador Uno");
    const dos = await nuevoCargador(user.client, "Cargador Dos");
    const [cobro] = await saveTransactions(user.client, [e1Item(basics, { reference: "con-cargador", loader_id: uno })]);
    const id = cobro!.id;
    expect(await cargadorDe(user.client, id)).toBe(uno);

    const editado = { kind: "editado", summary: "Editado: cargador", data: null };
    await saveTransactions(user.client, [{ mode: "update", tx: { id, loader_id: dos }, event: editado }]);
    expect(await cargadorDe(user.client, id)).toBe(dos);

    await saveTransactions(user.client, [{ mode: "update", tx: { id, note: "Otra nota" }, event: editado }]);
    expect(await cargadorDe(user.client, id)).toBe(dos);

    await saveTransactions(user.client, [{ mode: "update", tx: { id, loader_id: null }, event: editado }]);
    expect(await cargadorDe(user.client, id)).toBeNull();
  });

  it("la clave no lleva cascada: un cargador con cobros no se borra; sin cobros, sí", async () => {
    const conCobros = await nuevoCargador(user.client, "Con cobros");
    const sinCobros = await nuevoCargador(user.client, "Sin cobros");
    const [cobro] = await saveTransactions(user.client, [e1Item(basics, { reference: "fk", loader_id: conCobros })]);

    expectRejected(
      await sinTipos(user.client).from("pay_loaders").delete().eq("id", conCobros).select("id"),
      "23503",
      "pay_transactions_loader_fk",
    );
    expect(await cargadorDe(user.client, cobro!.id)).toBe(conCobros);

    const borrado = await sinTipos(user.client).from("pay_loaders").delete().eq("id", sinCobros).select("id");
    expect(borrado.error).toBeNull();
    expect(borrado.data).toEqual([{ id: sinCobros }]);
  });

  it("un cobro no puede llevar el cargador de otro usuario", async () => {
    const ajeno = await nuevoCargador(otro.client, "Cargador ajeno");
    const res = await user.client.rpc("pay_save_transactions", {
      p_items: [e1Item(basics, { reference: "ajeno", loader_id: ajeno })],
    });
    expectRejected(res, "23503", "pay_transactions_loader_fk");
    const guardados = unwrap(
      await adminClient().from("pay_transactions").select("id").eq("reference", "ajeno").eq("user_id", user.id),
      "cobros",
    );
    expect(guardados).toEqual([]);
  });
});
