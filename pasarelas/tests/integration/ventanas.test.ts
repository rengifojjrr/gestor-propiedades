import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createUser,
  e1Item,
  expectRejected,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type Db,
} from "./helpers";

/**
 * Las ventanas de depósito en la base (migración 20261112120000): un máximo opcional junto a cada «días al
 * depósito» y la fecha más temprana de la ventana en el cobro. Lo de antes sigue entrando igual: un cobro sin
 * `estimated_deposit_from` (una fila vieja, o una llamada de antes) cae en un solo día.
 */

let client: Db;
let b: Basics;

beforeAll(async () => {
  client = (await createUser()).client;
  b = await seedBasics(client);
});

/** Una pasarela nueva por la tabla, con `payout_days` 3 y lo que se pida. */
async function insertGateway(columns: { payout_days_max?: number }) {
  return client
    .from("pay_gateways")
    .insert({ name: `Ventana Demo ${randomUUID().slice(0, 8)}`, payout_days: 3, ...columns })
    .select("id, payout_days, payout_days_max")
    .single();
}

describe("pay_gateways.payout_days_max", () => {
  it("nace vacío (igual al mínimo) en las pasarelas que ya existen y en las nuevas", async () => {
    const stripe = unwrap(
      await client.from("pay_gateways").select("payout_days, payout_days_max").eq("id", b.gatewayId).single(),
      "pasarela",
    );
    expect(stripe).toEqual({ payout_days: 2, payout_days_max: null });
    expect(unwrap(await insertGateway({}), "pasarela").payout_days_max).toBeNull();
  });

  it("va entre el mínimo y 60: igual al mínimo, 5 o 60 entran", async () => {
    for (const max of [3, 5, 60]) {
      expect(unwrap(await insertGateway({ payout_days_max: max }), "pasarela").payout_days_max).toBe(max);
    }
  });

  it("menor que el mínimo o más de 60 no entra", async () => {
    expectRejected(await insertGateway({ payout_days_max: 2 }), "23514", "pay_gateways_payout_days_max_check");
    expectRejected(await insertGateway({ payout_days_max: 61 }), "23514", "pay_gateways_payout_days_max_check");
  });

  it("al subir el mínimo por encima del máximo, la base no lo deja", async () => {
    const { id } = unwrap(await insertGateway({ payout_days_max: 5 }), "pasarela");
    expectRejected(
      await client.from("pay_gateways").update({ payout_days: 6 }).eq("id", id).select("id"),
      "23514",
      "pay_gateways_payout_days_max_check",
    );
  });
});

describe("pay_gateway_extras.payout_days_override_max", () => {
  const insertExtra = (columns: { payout_days_override?: number; payout_days_override_max?: number }) =>
    client
      .from("pay_gateway_extras")
      .insert({ gateway_id: b.gatewayId, name: `Opción ${randomUUID().slice(0, 8)}`, active: false, ...columns })
      .select("payout_days_override, payout_days_override_max")
      .single();

  it("con días propios, el máximo va del mínimo a 60 o vacío", async () => {
    expect(unwrap(await insertExtra({ payout_days_override: 1 }), "opción")).toEqual({
      payout_days_override: 1,
      payout_days_override_max: null,
    });
    expect(unwrap(await insertExtra({ payout_days_override: 1, payout_days_override_max: 3 }), "opción")).toEqual({
      payout_days_override: 1,
      payout_days_override_max: 3,
    });
  });

  it("sin mínimo no hay máximo; menor que el mínimo o más de 60 tampoco", async () => {
    const CHECK = "pay_gateway_extras_payout_days_override_max_check";
    expectRejected(await insertExtra({ payout_days_override_max: 3 }), "23514", CHECK);
    expectRejected(await insertExtra({ payout_days_override: 4, payout_days_override_max: 3 }), "23514", CHECK);
    expectRejected(await insertExtra({ payout_days_override: 4, payout_days_override_max: 61 }), "23514", CHECK);
  });

  it("pay_create_gateway guarda el máximo de la pasarela y el de cada opción", async () => {
    const gatewayId = unwrap(
      await client.rpc("pay_create_gateway", {
        p: {
          name: `Ventana Demo ${randomUUID().slice(0, 8)}`,
          payout_days: 3,
          payout_days_max: 5,
          fee: { pct: "2.9", fixed: "0.30" },
          extras: [
            { name: "Pago rápido", pct: "1.5", payout_days_override: 0 },
            {
              name: "Pago internacional",
              pct: "1.5",
              kind: "internacional",
              payout_days_override: 7,
              payout_days_override_max: 10,
            },
          ],
        },
      }),
      "pasarela",
    );
    const gateway = unwrap(
      await client.from("pay_gateways").select("payout_days, payout_days_max").eq("id", gatewayId).single(),
      "pasarela",
    );
    expect(gateway).toEqual({ payout_days: 3, payout_days_max: 5 });
    const extras = unwrap(
      await client
        .from("pay_gateway_extras")
        .select("name, kind, payout_days_override, payout_days_override_max")
        .eq("gateway_id", gatewayId)
        .order("sort"),
      "opciones",
    );
    expect(extras).toEqual([
      { name: "Pago rápido", kind: "opcion", payout_days_override: 0, payout_days_override_max: null },
      { name: "Pago internacional", kind: "internacional", payout_days_override: 7, payout_days_override_max: 10 },
    ]);
  });

  it("pay_create_gateway sin máximos (como se llamaba antes) los deja vacíos", async () => {
    const gatewayId = unwrap(
      await client.rpc("pay_create_gateway", {
        p: {
          name: `Ventana Demo ${randomUUID().slice(0, 8)}`,
          fee: { pct: "2.9", fixed: "0.30" },
          extras: [{ name: "Pago rápido", pct: "1.5", payout_days_override: 0 }],
        },
      }),
      "pasarela",
    );
    const gateway = await client
      .from("pay_gateways")
      .select("payout_days, payout_days_max")
      .eq("id", gatewayId)
      .single();
    expect(unwrap(gateway, "pasarela")).toEqual({ payout_days: 2, payout_days_max: null });
    expect(
      unwrap(
        await client.from("pay_gateway_extras").select("payout_days_override_max").eq("gateway_id", gatewayId).single(),
        "opción",
      ),
    ).toEqual({ payout_days_override_max: null });
  });
});

describe("pay_company_gateways.payout_days_override_max", () => {
  const CHECK = "pay_company_gateways_payout_days_override_max_check";
  const update = (columns: { payout_days_override: number | null; payout_days_override_max: number | null }) =>
    client
      .from("pay_company_gateways")
      .update(columns)
      .eq("id", b.companyGatewayId)
      .select("payout_days_override, payout_days_override_max")
      .single();

  it("con días propios de la empresa, el máximo va del mínimo a 60 o vacío", async () => {
    expect(unwrap(await update({ payout_days_override: 3, payout_days_override_max: 5 }), "cuenta")).toEqual({
      payout_days_override: 3,
      payout_days_override_max: 5,
    });
    expect(unwrap(await update({ payout_days_override: null, payout_days_override_max: null }), "cuenta")).toEqual({
      payout_days_override: null,
      payout_days_override_max: null,
    });
  });

  it("sin mínimo no hay máximo; menor que el mínimo o más de 60 tampoco", async () => {
    expectRejected(await update({ payout_days_override: null, payout_days_override_max: 5 }), "23514", CHECK);
    expectRejected(await update({ payout_days_override: 6, payout_days_override_max: 5 }), "23514", CHECK);
    expectRejected(await update({ payout_days_override: 6, payout_days_override_max: 61 }), "23514", CHECK);
  });
});

describe("pay_transactions.estimated_deposit_from y pay_save_transactions", () => {
  const CHECK = "pay_transactions_estimated_window_check";

  const windowOf = async (id: string) =>
    unwrap(
      await client
        .from("pay_transactions")
        .select("estimated_deposit_from, estimated_deposit_on")
        .eq("id", id)
        .single(),
      "cobro",
    );

  it("una fila vieja (sin «from», como se guardaba antes) queda con «from» vacío: un solo día", async () => {
    const [saved] = await saveTransactions(client, [e1Item(b, { reference: `vieja-${randomUUID()}` })]);
    expect(await windowOf(saved!.id)).toEqual({ estimated_deposit_from: null, estimated_deposit_on: "2026-11-13" });
  });

  it("guarda la ventana al crear y la cambia al actualizar; una actualización sin «from» no lo toca", async () => {
    const [saved] = await saveTransactions(client, [
      e1Item(b, {
        reference: `ventana-${randomUUID()}`,
        estimated_deposit_from: "2026-11-16",
        estimated_deposit_on: "2026-11-18",
      }),
    ]);
    const id = saved!.id;
    expect(await windowOf(id)).toEqual({ estimated_deposit_from: "2026-11-16", estimated_deposit_on: "2026-11-18" });

    await saveTransactions(client, [
      {
        mode: "update",
        tx: { id, estimated_deposit_from: "2026-11-17", estimated_deposit_on: "2026-11-19" },
        event: { kind: "fecha_estimada", summary: "Fecha estimada", data: null },
      },
    ]);
    expect(await windowOf(id)).toEqual({ estimated_deposit_from: "2026-11-17", estimated_deposit_on: "2026-11-19" });

    await saveTransactions(client, [
      {
        mode: "update",
        tx: { id, note: "Sin tocar la ventana" },
        event: { kind: "editado", summary: "Nota", data: null },
      },
    ]);
    expect(await windowOf(id)).toEqual({ estimated_deposit_from: "2026-11-17", estimated_deposit_on: "2026-11-19" });

    // Vuelta a un solo día: «from» vacío.
    await saveTransactions(client, [
      {
        mode: "update",
        tx: { id, estimated_deposit_from: null, estimated_deposit_on: "2026-11-20" },
        event: { kind: "fecha_estimada", summary: "A mano", data: null },
      },
    ]);
    expect(await windowOf(id)).toEqual({ estimated_deposit_from: null, estimated_deposit_on: "2026-11-20" });
  });

  it("«from» igual a la fecha estimada entra; posterior, o sin fecha estimada, no", async () => {
    const [same] = await saveTransactions(client, [
      e1Item(b, { reference: `igual-${randomUUID()}`, estimated_deposit_from: "2026-11-13" }),
    ]);
    expect(await windowOf(same!.id)).toEqual({
      estimated_deposit_from: "2026-11-13",
      estimated_deposit_on: "2026-11-13",
    });

    const save = (tx: Record<string, string | null>) =>
      client.rpc("pay_save_transactions", { p_items: [e1Item(b, { reference: `mala-${randomUUID()}`, ...tx })] });
    expectRejected(await save({ estimated_deposit_from: "2026-11-14" }), "23514", CHECK);
    expectRejected(await save({ estimated_deposit_from: "2026-11-13", estimated_deposit_on: null }), "23514", CHECK);
  });

  it("al actualizar, una ventana al revés no se guarda y el cobro queda como estaba", async () => {
    const [saved] = await saveTransactions(client, [
      e1Item(b, {
        reference: `reves-${randomUUID()}`,
        estimated_deposit_from: "2026-11-16",
        estimated_deposit_on: "2026-11-18",
      }),
    ]);
    expectRejected(
      await client.rpc("pay_save_transactions", {
        p_items: [{ mode: "update", tx: { id: saved!.id, estimated_deposit_on: "2026-11-15" } }],
      }),
      "23514",
      CHECK,
    );
    expect(await windowOf(saved!.id)).toEqual({
      estimated_deposit_from: "2026-11-16",
      estimated_deposit_on: "2026-11-18",
    });
  });
});
