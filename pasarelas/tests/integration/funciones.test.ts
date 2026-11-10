import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  e1Item,
  createUser,
  unwrap,
  expectRejected,
  saveTransactions,
  seedBasics,
  type Basics,
  type SaveItem,
  type Db,
} from "./helpers";

/**
 * Las tres funciones que la app llama para escribir en varias tablas a la vez. Cada llamada es una sola
 * transacción: o queda todo, o no queda nada.
 */

let client: Db;
let b: Basics;

const referencia = (): string => `ref-${randomUUID()}`;

async function cobrosConReferencia(ref: string): Promise<number> {
  return unwrap(await client.from("pay_transactions").select("id").eq("reference", ref), "cobros").length;
}

/** Guarda el cobro E1 y devuelve su id y su `updated_at` tal como lo lee la app. */
async function guardarE1(db: Db, basics: Basics): Promise<{ id: string; updatedAt: string }> {
  const [cobro] = await saveTransactions(db, [e1Item(basics)]);
  if (!cobro) throw new Error("pay_save_transactions no devolvió el cobro");
  const fila = unwrap(await db.from("pay_transactions").select("updated_at").eq("id", cobro.id).single(), "cobro");
  return { id: cobro.id, updatedAt: fila.updated_at };
}

beforeAll(async () => {
  client = (await createUser()).client;
  b = await seedBasics(client);
});

describe("pay_save_transactions", () => {
  it("crea el cobro, sus 3 repartos y su evento", async () => {
    const ref = referencia();

    const resultado = await saveTransactions(client, [e1Item(b, { reference: ref })]);

    expect(resultado).toEqual([{ id: expect.any(String), inserted: true, skipped: false }]);
    const cobro = unwrap(
      await client
        .from("pay_transactions")
        .select("id, status, gross_amount::text, fees_total::text, net_amount::text, alloc_base_amount::text")
        .eq("reference", ref)
        .single(),
      "cobro guardado",
    );
    expect(cobro).toEqual({
      id: resultado[0]?.id,
      status: "registrado",
      gross_amount: "100.00",
      fees_total: "9.70",
      net_amount: "90.30",
      alloc_base_amount: "90.30",
    });

    const reparto = unwrap(
      await client
        .from("pay_allocations")
        .select("beneficiary_id, amount::text, pct::text, base, is_remainder")
        .eq("transaction_id", cobro.id),
      "reparto",
    );
    expect(reparto).toHaveLength(3);
    expect(reparto).toEqual(
      expect.arrayContaining([
        { beneficiary_id: b.beneficiaryIds.a, amount: "45.15", pct: "50.0000", base: "neto", is_remainder: false },
        { beneficiary_id: b.beneficiaryIds.b, amount: "27.09", pct: "30.0000", base: "neto", is_remainder: false },
        { beneficiary_id: b.beneficiaryIds.c, amount: "18.06", pct: "20.0000", base: "neto", is_remainder: false },
      ]),
    );

    const eventos = unwrap(
      await client.from("pay_transaction_events").select("kind, summary, data").eq("transaction_id", cobro.id),
      "historial",
    );
    expect(eventos).toEqual([{ kind: "creado", summary: "Cobro registrado", data: null }]);
  });

  it("si un elemento del lote falla, no queda nada de ninguno", async () => {
    const buena = referencia();
    const mala = referencia();

    const res = await client.rpc("pay_save_transactions", {
      p_items: [e1Item(b, { reference: buena }), e1Item(b, { reference: mala, net_amount: "90.31" })],
    });

    expectRejected(res, "23514", "pay_transactions_net_check");
    expect(await cobrosConReferencia(buena)).toBe(0);
    expect(await cobrosConReferencia(mala)).toBe(0);
  });

  it("actualiza solo lo que cambia, deja el reparto como está y agrega su evento", async () => {
    const { id, updatedAt } = await guardarE1(client, b);

    const resultado = await saveTransactions(client, [
      {
        mode: "update",
        tx: { id, note: "Pago de la matrícula" },
        expected_updated_at: updatedAt,
        allocations: null,
        event: { kind: "editado", summary: "Nota editada", data: { antes: null, despues: "Pago de la matrícula" } },
      },
    ]);

    expect(resultado).toEqual([{ id, inserted: false, skipped: false }]);
    const cobro = unwrap(
      await client
        .from("pay_transactions")
        .select("note, net_amount::text, updated_at, pay_allocations(amount::text), pay_transaction_events(kind)")
        .eq("id", id)
        .single(),
      "cobro actualizado",
    );
    expect(cobro.note).toBe("Pago de la matrícula");
    expect(cobro.net_amount).toBe("90.30");
    expect(cobro.updated_at).not.toBe(updatedAt);
    expect(cobro.pay_allocations.map((linea) => linea.amount).sort()).toEqual(["18.06", "27.09", "45.15"]);
    expect(cobro.pay_transaction_events.map((evento) => evento.kind).sort()).toEqual(["creado", "editado"]);
  });

  it("un reembolso total reemplaza el reparto por uno negativo que suma la base nueva (E4)", async () => {
    const { id, updatedAt } = await guardarE1(client, b);
    const reembolso: SaveItem = {
      mode: "update",
      tx: {
        id,
        refunded_amount: "100.00",
        gross_amount: "0.00",
        fees_total: "3.20",
        net_amount: "-3.20",
        alloc_base_amount: "-3.20",
      },
      expected_updated_at: updatedAt,
      allocations: [
        { beneficiary_id: b.beneficiaryIds.a, amount: "-1.60", base: "neto", pct: "50", is_remainder: false },
        { beneficiary_id: b.beneficiaryIds.b, amount: "-0.96", base: "neto", pct: "30", is_remainder: false },
        { beneficiary_id: b.beneficiaryIds.c, amount: "-0.64", base: "neto", pct: "20", is_remainder: false },
      ],
      event: { kind: "reembolso", summary: "Reembolso total", data: null },
    };

    await saveTransactions(client, [reembolso]);

    const cobro = unwrap(
      await client
        .from("pay_transactions")
        .select("gross_amount::text, net_amount::text, pay_allocations(beneficiary_id, amount::text)")
        .eq("id", id)
        .single(),
      "cobro reembolsado",
    );
    expect(cobro.gross_amount).toBe("0.00");
    expect(cobro.net_amount).toBe("-3.20");
    expect(cobro.pay_allocations).toHaveLength(3);
    expect(cobro.pay_allocations).toEqual(
      expect.arrayContaining([
        { beneficiary_id: b.beneficiaryIds.a, amount: "-1.60" },
        { beneficiary_id: b.beneficiaryIds.b, amount: "-0.96" },
        { beneficiary_id: b.beneficiaryIds.c, amount: "-0.64" },
      ]),
    );
  });

  it("un update con expected_updated_at viejo da pay_tx_conflict y no cambia nada", async () => {
    const { id, updatedAt } = await guardarE1(client, b);
    const editar = (note: string): SaveItem => ({
      mode: "update",
      tx: { id, note },
      expected_updated_at: updatedAt,
      event: { kind: "editado", summary: "Nota editada", data: null },
    });
    await saveTransactions(client, [editar("la primera edición gana")]);

    // La segunda edición salió de la misma lectura: su updated_at ya es viejo.
    const res = await client.rpc("pay_save_transactions", { p_items: [editar("la segunda llega tarde")] });

    expectRejected(res, "40001", "pay_tx_conflict");
    const cobro = unwrap(
      await client.from("pay_transactions").select("note, pay_transaction_events(kind)").eq("id", id).single(),
      "cobro",
    );
    expect(cobro.note).toBe("la primera edición gana");
    expect(cobro.pay_transaction_events).toHaveLength(2);
  });

  it("un update de un cobro que no existe da pay_tx_not_found", async () => {
    const res = await client.rpc("pay_save_transactions", {
      p_items: [{ mode: "update", tx: { id: randomUUID(), note: "no existe" } }],
    });

    expectRejected(res, "P0002", "pay_tx_not_found");
  });

  it("con p_skip_duplicates salta la referencia repetida y guarda las demás", async () => {
    const repetida = referencia();
    const nueva = referencia();
    await saveTransactions(client, [e1Item(b, { reference: repetida })]);

    const resultado = await saveTransactions(
      client,
      [e1Item(b, { reference: repetida }), e1Item(b, { reference: nueva })],
      true,
    );

    expect(resultado).toEqual([
      { id: expect.any(String), inserted: false, skipped: true },
      { id: expect.any(String), inserted: true, skipped: false },
    ]);
    expect(await cobrosConReferencia(repetida)).toBe(1);
    expect(await cobrosConReferencia(nueva)).toBe(1);
  });

  it("la referencia se guarda sin espacios, y p_skip_duplicates la reconoce aunque llegue con ellos", async () => {
    const ref = referencia();
    await saveTransactions(client, [e1Item(b, { reference: `  ${ref} ` })]);
    expect(await cobrosConReferencia(ref)).toBe(1);

    const resultado = await saveTransactions(client, [e1Item(b, { reference: ` ${ref}  ` })], true);

    expect(resultado).toEqual([{ id: expect.any(String), inserted: false, skipped: true }]);
    expect(await cobrosConReferencia(ref)).toBe(1);
  });

  it.each([
    { caso: "501 elementos", cuantos: 501 },
    { caso: "una lista vacía", cuantos: 0 },
  ])("$caso → pay_bad_payload y no se guarda nada", async ({ cuantos }) => {
    const prefijo = referencia();
    const items = Array.from({ length: cuantos }, (_, i) => e1Item(b, { reference: `${prefijo}-${i}` }));

    const res = await client.rpc("pay_save_transactions", { p_items: items });

    expectRejected(res, "22023", "pay_bad_payload");
    const guardados = unwrap(
      await client.from("pay_transactions").select("id").like("reference", `${prefijo}-%`),
      "cobros del lote",
    );
    expect(guardados).toEqual([]);
  });

  it("500 elementos, el máximo, sí se guardan", async () => {
    const prefijo = referencia();
    const items = Array.from({ length: 500 }, (_, i) => e1Item(b, { reference: `${prefijo}-${i}` }));

    const resultado = await saveTransactions(client, items);

    expect(resultado).toHaveLength(500);
    expect(resultado.every((cobro) => cobro.inserted && !cobro.skipped)).toBe(true);
    const guardados = await client
      .from("pay_transactions")
      .select("id", { count: "exact", head: true })
      .like("reference", `${prefijo}-%`);
    expect(guardados.count).toBe(500);
  });

  it("sin sesión de usuario (clave secreta) da pay_no_session", async () => {
    const res = await adminClient().rpc("pay_save_transactions", { p_items: [e1Item(b)] });

    expectRejected(res, "28000", "pay_no_session");
  });
});

describe("pay_save_scheme", () => {
  type Guardado = { scheme_id: string; version_id: string; version: number };

  async function versiones(schemeId: string) {
    return unwrap(
      await client
        .from("pay_scheme_versions")
        .select("id, version, effective_from, base, pay_scheme_lines(beneficiary_id, pct::text, sort)")
        .eq("scheme_id", schemeId)
        .order("version"),
      "versiones del esquema",
    );
  }

  it("crea la versión 1, luego la 2, reemplaza la que no tiene cobros y protege la que sí", async () => {
    const name = `Esquema ${randomUUID()}`;

    // Versión 1: nace el esquema, vigente «desde el inicio».
    const v1 = unwrap(
      await client.rpc("pay_save_scheme", { p: { name, lines: [{ beneficiary_id: b.beneficiaryIds.a, pct: "100" }] } }),
      "versión 1",
    ) as Guardado;
    expect(v1.version).toBe(1);

    // Versión 2: mismo esquema, vigente desde otra fecha.
    const desde = "2026-12-01";
    const lineas = (pctA: string, pctB: string) => [
      { beneficiary_id: b.beneficiaryIds.a, pct: pctA },
      { beneficiary_id: b.beneficiaryIds.b, pct: pctB },
    ];
    const v2 = unwrap(
      await client.rpc("pay_save_scheme", {
        p: { scheme_id: v1.scheme_id, base: "bruto", effective_from: desde, lines: lineas("60", "40") },
      }),
      "versión 2",
    ) as Guardado;
    expect(v2).toMatchObject({ scheme_id: v1.scheme_id, version: 2 });
    expect(await versiones(v1.scheme_id)).toEqual([
      {
        id: v1.version_id,
        version: 1,
        effective_from: "2000-01-01",
        base: "neto",
        pay_scheme_lines: [{ beneficiary_id: b.beneficiaryIds.a, pct: "100.0000", sort: 0 }],
      },
      {
        id: v2.version_id,
        version: 2,
        effective_from: desde,
        base: "bruto",
        pay_scheme_lines: expect.arrayContaining([
          { beneficiary_id: b.beneficiaryIds.a, pct: "60.0000", sort: 0 },
          { beneficiary_id: b.beneficiaryIds.b, pct: "40.0000", sort: 1 },
        ]),
      },
    ]);

    // Misma fecha y ningún cobro la usa: se reemplaza (siguen siendo dos versiones).
    const reemplazo = unwrap(
      await client.rpc("pay_save_scheme", {
        p: { scheme_id: v1.scheme_id, base: "bruto", effective_from: desde, lines: lineas("70", "30") },
      }),
      "reemplazo de la versión 2",
    ) as Guardado;
    expect(reemplazo.version).toBe(2);
    expect(reemplazo.version_id).not.toBe(v2.version_id);
    const trasReemplazo = await versiones(v1.scheme_id);
    expect(trasReemplazo.map((v) => v.id)).toEqual([v1.version_id, reemplazo.version_id]);
    expect(trasReemplazo[1]?.pay_scheme_lines.map((linea) => linea.pct).sort()).toEqual(["30.0000", "70.0000"]);

    // Un cobro usa esa versión: ya no se puede reemplazar.
    await saveTransactions(client, [e1Item(b, { scheme_id: v1.scheme_id, scheme_version_id: reemplazo.version_id })]);
    const res = await client.rpc("pay_save_scheme", {
      p: { scheme_id: v1.scheme_id, effective_from: desde, lines: lineas("50", "50") },
    });
    expectRejected(res, "23503", "pay_scheme_version_in_use");
    expect(await versiones(v1.scheme_id)).toEqual(trasReemplazo);
  });

  it("con un scheme_id que no existe da pay_scheme_not_found y no crea nada", async () => {
    const schemeId = randomUUID();

    const res = await client.rpc("pay_save_scheme", {
      p: { scheme_id: schemeId, name: "Esquema fantasma", lines: [{ beneficiary_id: b.beneficiaryIds.a, pct: "100" }] },
    });

    expectRejected(res, "P0002", "pay_scheme_not_found");
    expect(await versiones(schemeId)).toEqual([]);
  });

  it("con el esquema de otro usuario da pay_scheme_not_found y ese esquema queda como estaba", async () => {
    const admin = adminClient();
    const leer = async () =>
      unwrap(
        await admin
          .from("pay_schemes")
          .select("name, notes, updated_at, pay_scheme_versions(id, version)")
          .eq("id", b.schemeId)
          .single(),
        "esquema ajeno",
      );
    const antes = await leer();
    const intruso = (await createUser()).client;
    const suyo = unwrap(
      await intruso.from("pay_beneficiaries").insert({ name: "Grupo A" }).select("id").single(),
      "beneficiario del intruso",
    );

    const res = await intruso.rpc("pay_save_scheme", {
      p: {
        scheme_id: b.schemeId,
        name: "Tomado",
        notes: "tomado",
        effective_from: "2026-12-15",
        lines: [{ beneficiary_id: suyo.id, pct: "100" }],
      },
    });

    expectRejected(res, "P0002", "pay_scheme_not_found");
    expect(await leer()).toEqual(antes);
  });
});

describe("pay_create_gateway", () => {
  it("crea la pasarela, su tarifa «desde el inicio» y sus opciones", async () => {
    const name = `Pasarela ${randomUUID()}`;

    const gatewayId = unwrap(
      await client.rpc("pay_create_gateway", {
        p: {
          name,
          payout_days: 3,
          payout_day_type: "corridos",
          refunds_return_fee: true,
          dispute_fee: "15.00",
          fee: { pct: "3.49", fixed: "0.49" },
          extras: [
            { name: "Pago rápido", pct: "1.5", base: "bruto", payout_days_override: 0, default_on: true },
            { name: "Conversión de moneda", pct: "1", fixed: "0.25", base: "despues_de_comision" },
          ],
        },
      }),
      "pasarela",
    );

    const pasarela = unwrap(
      await client
        .from("pay_gateways")
        .select("name, payout_days, payout_day_type, refunds_return_fee, dispute_fee::text")
        .eq("id", gatewayId)
        .single(),
      "pasarela creada",
    );
    expect(pasarela).toEqual({
      name,
      payout_days: 3,
      payout_day_type: "corridos",
      refunds_return_fee: true,
      dispute_fee: "15.00",
    });

    const tarifas = unwrap(
      await client
        .from("pay_gateway_fee_versions")
        .select("pct::text, fixed::text, effective_from")
        .eq("gateway_id", gatewayId),
      "tarifas",
    );
    expect(tarifas).toEqual([{ pct: "3.4900", fixed: "0.49", effective_from: "2000-01-01" }]);

    const opciones = unwrap(
      await client
        .from("pay_gateway_extras")
        .select("name, pct::text, fixed::text, base, default_on, payout_days_override, sort")
        .eq("gateway_id", gatewayId)
        .order("sort"),
      "opciones",
    );
    expect(opciones).toEqual([
      {
        name: "Pago rápido",
        pct: "1.5000",
        fixed: "0.00",
        base: "bruto",
        default_on: true,
        payout_days_override: 0,
        sort: 0,
      },
      {
        name: "Conversión de moneda",
        pct: "1.0000",
        fixed: "0.25",
        base: "despues_de_comision",
        default_on: false,
        payout_days_override: null,
        sort: 1,
      },
    ]);
  });
});

describe("quién puede llamar a las funciones", () => {
  it.each(["pay_save_transactions", "pay_save_scheme", "pay_create_gateway"] as const)(
    "anon no puede llamar a %s",
    async (funcion) => {
      const anon = anonClient();
      const colado = { name: `Colado ${randomUUID()}`, fee: { pct: "1", fixed: "0" }, lines: [] };
      const res =
        funcion === "pay_save_transactions"
          ? await anon.rpc(funcion, { p_items: [e1Item(b)] })
          : await anon.rpc(funcion, { p: colado });

      expectRejected(res, "42501");
    },
  );

  it("las funciones internas (esquema private) no se pueden llamar por la API", async () => {
    const sinTipos = client as unknown as SupabaseClient;

    const internas = [
      { funcion: "pay_mfa_ok", args: {} },
      { funcion: "pay_assert_allocations", args: { p_tx: randomUUID() } },
      { funcion: "pay_assert_scheme_version", args: { p_version: randomUUID() } },
    ];
    for (const { funcion, args } of internas) {
      // PGRST202: la API no encuentra esa función entre las que expone.
      expectRejected(await sinTipos.rpc(funcion, args), "PGRST202");
    }
  });
});

describe("las vistas de totales cuadran con lo guardado", () => {
  let db: Db;
  let basics: Basics;
  let txId: string;
  let updatedAt: string;

  async function saldos(): Promise<Record<string, { assigned: string; settled: string; balance: string }>> {
    const filas = unwrap(
      await db
        .from("pay_beneficiary_balances")
        .select("beneficiary_id, currency, assigned::text, settled::text, balance::text"),
      "saldos",
    );
    return Object.fromEntries(
      filas.map((f) => [f.beneficiary_id, { assigned: f.assigned, settled: f.settled, balance: f.balance }]),
    );
  }

  beforeAll(async () => {
    // Usuario aparte: las vistas suman toda la historia del usuario.
    db = (await createUser()).client;
    basics = await seedBasics(db);
    ({ id: txId, updatedAt } = await guardarE1(db, basics));
  });

  it("con el cobro E1: totales por empresa, pasarela y cuenta, y lo asignado a cada beneficiario", async () => {
    const empresa = unwrap(
      await db.from("pay_company_totals").select("company_id, currency, tx_count, gross::text, fees::text, net::text"),
      "totales por empresa",
    );
    expect(empresa).toEqual([
      { company_id: basics.companyId, currency: "USD", tx_count: 1, gross: "100.00", fees: "9.70", net: "90.30" },
    ]);

    const pasarela = unwrap(
      await db.from("pay_gateway_totals").select("gateway_id, currency, tx_count, gross::text, fees::text, net::text"),
      "totales por pasarela",
    );
    expect(pasarela).toEqual([
      { gateway_id: basics.gatewayId, currency: "USD", tx_count: 1, gross: "100.00", fees: "9.70", net: "90.30" },
    ]);

    const cuenta = unwrap(
      await db
        .from("pay_bank_account_totals")
        .select("bank_account_id, currency, pending_count, pending_net::text, deposited_count, deposited_net::text"),
      "totales por cuenta",
    );
    expect(cuenta).toEqual([
      {
        bank_account_id: basics.bankAccountId,
        currency: "USD",
        pending_count: 1,
        pending_net: "90.30",
        deposited_count: 0,
        deposited_net: "0.00",
      },
    ]);

    expect(await saldos()).toEqual({
      [basics.beneficiaryIds.a]: { assigned: "45.15", settled: "0.00", balance: "45.15" },
      [basics.beneficiaryIds.b]: { assigned: "27.09", settled: "0.00", balance: "27.09" },
      [basics.beneficiaryIds.c]: { assigned: "18.06", settled: "0.00", balance: "18.06" },
    });
  });

  it("liquidado todo y después reembolsado (E4): los saldos quedan en −46,75 · −28,05 · −18,70", async () => {
    unwrap(
      await db
        .from("pay_settlements")
        .insert([
          { beneficiary_id: basics.beneficiaryIds.a, paid_on: "2026-11-14", amount: "45.15" },
          { beneficiary_id: basics.beneficiaryIds.b, paid_on: "2026-11-14", amount: "27.09" },
          { beneficiary_id: basics.beneficiaryIds.c, paid_on: "2026-11-14", amount: "18.06" },
        ])
        .select("id"),
      "liquidaciones",
    );
    await saveTransactions(db, [
      {
        mode: "update",
        tx: {
          id: txId,
          refunded_amount: "100.00",
          gross_amount: "0.00",
          fees_total: "3.20",
          net_amount: "-3.20",
          alloc_base_amount: "-3.20",
        },
        expected_updated_at: updatedAt,
        allocations: [
          { beneficiary_id: basics.beneficiaryIds.a, amount: "-1.60", base: "neto", pct: "50", is_remainder: false },
          { beneficiary_id: basics.beneficiaryIds.b, amount: "-0.96", base: "neto", pct: "30", is_remainder: false },
          { beneficiary_id: basics.beneficiaryIds.c, amount: "-0.64", base: "neto", pct: "20", is_remainder: false },
        ],
        event: { kind: "reembolso", summary: "Reembolso total", data: null },
      },
    ]);

    expect(await saldos()).toEqual({
      [basics.beneficiaryIds.a]: { assigned: "-1.60", settled: "45.15", balance: "-46.75" },
      [basics.beneficiaryIds.b]: { assigned: "-0.96", settled: "27.09", balance: "-28.05" },
      [basics.beneficiaryIds.c]: { assigned: "-0.64", settled: "18.06", balance: "-18.70" },
    });
  });

  it("un cobro en la papelera no cuenta en ningún total", async () => {
    const enPapelera = await db
      .from("pay_transactions")
      .update({ deleted_at: "2026-11-15T12:00:00+00:00" })
      .eq("id", txId)
      .select("id");
    expect(enPapelera.error).toBeNull();
    expect(enPapelera.data).toHaveLength(1);

    for (const vista of ["pay_company_totals", "pay_gateway_totals", "pay_bank_account_totals"] as const) {
      expect(unwrap(await db.from(vista).select("user_id"), vista)).toEqual([]);
    }
    expect(await saldos()).toEqual({
      [basics.beneficiaryIds.a]: { assigned: "0.00", settled: "45.15", balance: "-45.15" },
      [basics.beneficiaryIds.b]: { assigned: "0.00", settled: "27.09", balance: "-27.09" },
      [basics.beneficiaryIds.c]: { assigned: "0.00", settled: "18.06", balance: "-18.06" },
    });
  });
});
