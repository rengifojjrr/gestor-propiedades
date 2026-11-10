import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  e1Item,
  createUser,
  unwrap,
  expectRejected,
  saveTransactions,
  seedBasics,
  type Basics,
  type Db,
  type SaveItem,
} from "./helpers";

/**
 * Los cuadres los defiende la base, no solo la app: lo que no cuadra no se guarda, entre por donde entre.
 * 23514 = restricción de comprobación; 23505 = unicidad; 23503 = clave foránea.
 */

let client: Db;
let b: Basics;

const referencia = (): string => `ref-${randomUUID()}`;

/** Cuántos cobros hay con esa referencia (0 = no se guardó). */
async function cobrosConReferencia(ref: string): Promise<number> {
  return unwrap(await client.from("pay_transactions").select("id").eq("reference", ref), "cobros").length;
}

/**
 * Un cobro sin esquema para insertar DIRECTO en la tabla (sin pasar por `pay_save_transactions`): su base es
 * cero y no lleva reparto, así que cuadra. `extra` agrega columnas.
 */
const cobroDirecto = (extra: { reference?: string; receipts_count?: number } = {}) => ({
  occurred_at: "2026-11-02T15:00:00+00:00",
  occurred_on: "2026-11-02",
  company_id: b.companyId,
  gateway_id: b.gatewayId,
  currency: "USD",
  gross_original: "10.00",
  gross_amount: "10.00",
  fees_total: "0.00",
  net_amount: "10.00",
  breakdown: { v: 1 },
  fee_version_id: b.feeVersionId,
  ...extra,
});

beforeAll(async () => {
  client = (await createUser()).client;
  b = await seedBasics(client);
});

describe("la configuración mínima de las pruebas (seedBasics)", () => {
  it("deja la empresa con su esquema por defecto y la cuenta de Stripe en esa empresa", async () => {
    const empresa = unwrap(
      await client.from("pay_companies").select("name, default_scheme_id").eq("id", b.companyId).single(),
      "empresa",
    );
    expect(empresa).toEqual({ name: "Escuela Demo", default_scheme_id: b.schemeId });

    const cuentasDePasarela = unwrap(
      await client
        .from("pay_company_gateways")
        .select("id, company_id, gateway_id, bank_account_id, payout_days_override, default_extra_ids")
        .eq("company_id", b.companyId),
      "cuenta de la pasarela en la empresa",
    );
    expect(cuentasDePasarela).toEqual([
      {
        id: b.companyGatewayId,
        company_id: b.companyId,
        gateway_id: b.gatewayId,
        bank_account_id: b.bankAccountId,
        payout_days_override: null,
        default_extra_ids: null,
      },
    ]);
  });
});

describe("el reparto de un cobro suma exactamente su base", () => {
  it("un reparto que no suma la base se rechaza y el cobro no queda", async () => {
    const ref = referencia();
    const item = e1Item(b, { reference: ref });
    // 45,15 + 27,09 + 18,05 = 90,29: falta un centavo para la base de 90,30.
    item.allocations = [
      { beneficiary_id: b.beneficiaryIds.a, amount: "45.15", base: "neto", pct: "50", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.b, amount: "27.09", base: "neto", pct: "30", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.c, amount: "18.05", base: "neto", pct: "20", is_remainder: false },
    ];

    const res = await client.rpc("pay_save_transactions", { p_items: [item] });

    expectRejected(res, "23514", "pay_alloc_sum_mismatch");
    expect(await cobrosConReferencia(ref)).toBe(0);
  });

  it("un cobro con base de reparto y sin reparto se rechaza", async () => {
    const ref = referencia();
    const item = e1Item(b, { reference: ref });
    item.allocations = [];

    expectRejected(await client.rpc("pay_save_transactions", { p_items: [item] }), "23514", "pay_alloc_sum_mismatch");
    expect(await cobrosConReferencia(ref)).toBe(0);
  });

  it("borrar una fila del reparto se rechaza y el reparto sigue completo", async () => {
    const [cobro] = await saveTransactions(client, [e1Item(b)]);
    const txId = cobro?.id ?? "";

    const res = await client
      .from("pay_allocations")
      .delete()
      .eq("transaction_id", txId)
      .eq("beneficiary_id", b.beneficiaryIds.c)
      .select("id");

    expectRejected(res, "23514", "pay_alloc_sum_mismatch");
    const reparto = unwrap(
      await client.from("pay_allocations").select("amount::text").eq("transaction_id", txId).order("amount"),
      "reparto",
    );
    expect(reparto.map((linea) => linea.amount)).toEqual(["18.06", "27.09", "45.15"]);
  });

  it("cambiar el monto de una fila del reparto se rechaza", async () => {
    const [cobro] = await saveTransactions(client, [e1Item(b)]);
    const txId = cobro?.id ?? "";

    const res = await client
      .from("pay_allocations")
      .update({ amount: "18.07" })
      .eq("transaction_id", txId)
      .eq("beneficiary_id", b.beneficiaryIds.c)
      .select("id");

    expectRejected(res, "23514", "pay_alloc_sum_mismatch");
  });
});

describe("los cuadres del cobro", () => {
  it("neto distinto de bruto − comisiones se rechaza", async () => {
    const ref = referencia();
    // 100,00 − 9,70 = 90,30, no 90,31. (La base del reparto acompaña al neto: aquí solo falla el cuadre del neto.)
    const item = e1Item(b, { reference: ref, net_amount: "90.31", alloc_base_amount: "90.31" });

    const res = await client.rpc("pay_save_transactions", { p_items: [item] });

    expectRejected(res, "23514", "pay_transactions_net_check");
    expect(await cobrosConReferencia(ref)).toBe(0);
  });

  it("«depositado» sin fecha real se rechaza", async () => {
    const ref = referencia();
    const item = e1Item(b, { reference: ref, status: "depositado", deposited_on: null });

    const res = await client.rpc("pay_save_transactions", { p_items: [item] });

    expectRejected(res, "23514", "pay_transactions_deposit_check");
    expect(await cobrosConReferencia(ref)).toBe(0);
  });

  it("una fecha real de depósito sin estar «depositado» se rechaza", async () => {
    const ref = referencia();
    const item = e1Item(b, { reference: ref, status: "en_transito", deposited_on: "2026-11-16" });

    expectRejected(
      await client.rpc("pay_save_transactions", { p_items: [item] }),
      "23514",
      "pay_transactions_deposit_check",
    );
    expect(await cobrosConReferencia(ref)).toBe(0);
  });

  it("«depositado» con su fecha real sí se guarda", async () => {
    const ref = referencia();
    await saveTransactions(client, [e1Item(b, { reference: ref, status: "depositado", deposited_on: "2026-11-16" })]);

    const guardado = unwrap(
      await client.from("pay_transactions").select("status, deposited_on").eq("reference", ref).single(),
      "cobro depositado",
    );
    expect(guardado).toEqual({ status: "depositado", deposited_on: "2026-11-16" });
  });

  describe("un cobro fallido lleva todo en cero", () => {
    const ceros = { gross_amount: "0.00", fees_total: "0.00", net_amount: "0.00", alloc_base_amount: "0.00" };
    const repartoEnCero = (): SaveItem["allocations"] => [
      { beneficiary_id: b.beneficiaryIds.a, amount: "0.00", base: "neto", pct: "50", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.b, amount: "0.00", base: "neto", pct: "30", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.c, amount: "0.00", base: "neto", pct: "20", is_remainder: false },
    ];

    it("con todo en cero se guarda", async () => {
      const ref = referencia();
      const item = e1Item(b, { reference: ref, status: "fallido", ...ceros });
      item.allocations = repartoEnCero();

      await saveTransactions(client, [item]);

      expect(await cobrosConReferencia(ref)).toBe(1);
    });

    it("con comisiones se rechaza", async () => {
      const ref = referencia();
      // La base del reparto acompaña al neto (−9,70): lo único que no cuadra es que un fallido tenga comisiones.
      const conComisiones = { fees_total: "9.70", net_amount: "-9.70", alloc_base_amount: "-9.70" };
      const item = e1Item(b, { reference: ref, status: "fallido", ...ceros, ...conComisiones });
      item.allocations = repartoEnCero();

      const res = await client.rpc("pay_save_transactions", { p_items: [item] });

      expectRejected(res, "23514", "pay_transactions_gross_check");
      expect(await cobrosConReferencia(ref)).toBe(0);
    });

    it("con reparto se rechaza, aunque el reparto sume su base", async () => {
      const ref = referencia();
      // Bruto, comisiones y neto en cero, pero conserva la base de 90,30 y su reparto 45,15 · 27,09 · 18,06.
      // Lo frena primero la restricción que ata la base del reparto al neto (que es cero).
      const item = e1Item(b, { reference: ref, status: "fallido", ...ceros, alloc_base_amount: "90.30" });

      const res = await client.rpc("pay_save_transactions", { p_items: [item] });

      expectRejected(res, "23514", "pay_transactions_alloc_base_check");
      expect(await cobrosConReferencia(ref)).toBe(0);
    });
  });

  it("la referencia repetida en la misma pasarela se rechaza", async () => {
    const ref = referencia();
    await saveTransactions(client, [e1Item(b, { reference: ref })]);

    const res = await client.rpc("pay_save_transactions", { p_items: [e1Item(b, { reference: ref })] });

    expectRejected(res, "23505", "pay_transactions_reference_uq");
    expect(await cobrosConReferencia(ref)).toBe(1);
  });

  it("la misma referencia en otra pasarela sí se guarda", async () => {
    const ref = referencia();
    await saveTransactions(client, [e1Item(b, { reference: ref })]);
    const otraPasarela = unwrap(
      await client.rpc("pay_create_gateway", { p: { name: `Pasarela ${ref}`, fee: { pct: "0", fixed: "0" } } }),
      "otra pasarela",
    );
    const suTarifa = unwrap(
      await client.from("pay_gateway_fee_versions").select("id").eq("gateway_id", otraPasarela).single(),
      "tarifa de la otra pasarela",
    );

    await saveTransactions(client, [
      e1Item(b, { reference: ref, gateway_id: otraPasarela, fee_version_id: suTarifa.id }),
    ]);

    expect(await cobrosConReferencia(ref)).toBe(2);
  });

  it("una referencia con espacios en los extremos, insertada directo en la tabla, se rechaza", async () => {
    const ref = referencia();

    const res = await client
      .from("pay_transactions")
      .insert(cobroDirecto({ reference: ` ${ref} ` }))
      .select("id");

    expectRejected(res, "23514", "pay_transactions_reference_check");
    expect(await cobrosConReferencia(` ${ref} `)).toBe(0);
  });

  it("la misma referencia ya recortada, insertada directo en la tabla, sí se guarda", async () => {
    const ref = referencia();

    const res = await client.from("pay_transactions").insert(cobroDirecto({ reference: ref })).select("reference");

    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ reference: ref }]);
  });

  it("un cobro con la versión de OTRO esquema se rechaza: la versión tiene que ser de su esquema", async () => {
    const ref = referencia();
    const otroEsquema = unwrap(
      await client.rpc("pay_save_scheme", {
        p: { name: `Esquema ${ref}`, lines: [{ beneficiary_id: b.beneficiaryIds.a, pct: "100" }] },
      }),
      "otro esquema",
    ) as { scheme_id: string; version_id: string };

    // El esquema es el de seedBasics, pero la versión es la del esquema recién creado.
    const res = await client.rpc("pay_save_transactions", {
      p_items: [e1Item(b, { reference: ref, scheme_id: b.schemeId, scheme_version_id: otroEsquema.version_id })],
    });

    expectRejected(res, "23503", "pay_transactions_scheme_version_id_scheme_id_user_id_fkey");
    expect(await cobrosConReferencia(ref)).toBe(0);
  });
});

describe("la base del reparto queda atada al cobro", () => {
  const SIN_ESQUEMA = { scheme_id: null, scheme_version_id: null, alloc_base: null, alloc_base_amount: "0.00" };
  /** El reparto 50/30/20 de 100,00 (el bruto de E1). */
  const repartoDelBruto = (): SaveItem["allocations"] => [
    { beneficiary_id: b.beneficiaryIds.a, amount: "50.00", base: "bruto", pct: "50", is_remainder: false },
    { beneficiary_id: b.beneficiaryIds.b, amount: "30.00", base: "bruto", pct: "30", is_remainder: false },
    { beneficiary_id: b.beneficiaryIds.c, amount: "20.00", base: "bruto", pct: "20", is_remainder: false },
  ];

  it("sobre el neto con una base que no es el neto se rechaza, aunque el reparto sume esa base", async () => {
    const ref = referencia();
    // El neto de E1 es 90,30; la base dice 100,00 (el bruto) y el reparto suma 100,00.
    const item = e1Item(b, { reference: ref, alloc_base: "neto", alloc_base_amount: "100.00" });
    item.allocations = repartoDelBruto();

    const res = await client.rpc("pay_save_transactions", { p_items: [item] });

    expectRejected(res, "23514", "pay_transactions_alloc_base_check");
    expect(await cobrosConReferencia(ref)).toBe(0);
  });

  it("sobre el bruto con una base que no es el bruto se rechaza, aunque el reparto sume esa base", async () => {
    const ref = referencia();
    // El bruto de E1 es 100,00; la base dice 90,30 (el neto) y el reparto de E1 suma 90,30.
    const item = e1Item(b, { reference: ref, alloc_base: "bruto", alloc_base_amount: "90.30" });

    const res = await client.rpc("pay_save_transactions", { p_items: [item] });

    expectRejected(res, "23514", "pay_transactions_alloc_base_check");
    expect(await cobrosConReferencia(ref)).toBe(0);
  });

  it.each([
    { caso: "con base «neto»", tx: (): SaveItem["tx"] => ({ ...SIN_ESQUEMA, alloc_base: "neto" }) },
    { caso: "con esquema", tx: (): SaveItem["tx"] => ({ ...SIN_ESQUEMA, scheme_id: b.schemeId }) },
  ])("sin versión de esquema, un cobro $caso se rechaza", async ({ tx }) => {
    const ref = referencia();
    const item = e1Item(b, { reference: ref, ...tx() });
    item.allocations = [];

    const res = await client.rpc("pay_save_transactions", { p_items: [item] });

    expectRejected(res, "23514", "pay_transactions_alloc_base_check");
    expect(await cobrosConReferencia(ref)).toBe(0);
  });

  it("sobre el neto con el neto como base se guarda (E1)", async () => {
    const ref = referencia();

    await saveTransactions(client, [e1Item(b, { reference: ref })]);

    expect(await cobrosConReferencia(ref)).toBe(1);
  });

  it("sobre el bruto con el bruto como base se guarda", async () => {
    const ref = referencia();
    const item = e1Item(b, { reference: ref, alloc_base: "bruto", alloc_base_amount: "100.00" });
    item.allocations = repartoDelBruto();

    await saveTransactions(client, [item]);

    expect(await cobrosConReferencia(ref)).toBe(1);
  });

  it("sin esquema, sin base y sin reparto se guarda", async () => {
    const ref = referencia();
    const item = e1Item(b, { reference: ref, ...SIN_ESQUEMA });
    item.allocations = [];

    await saveTransactions(client, [item]);

    const guardado = unwrap(
      await client
        .from("pay_transactions")
        .select("scheme_id, scheme_version_id, alloc_base, alloc_base_amount::text")
        .eq("reference", ref)
        .single(),
      "cobro sin esquema",
    );
    expect(guardado).toEqual(SIN_ESQUEMA);
  });

  it("un fallido con esquema y todo en cero se guarda", async () => {
    const ref = referencia();
    const ceros = { gross_amount: "0.00", fees_total: "0.00", net_amount: "0.00", alloc_base_amount: "0.00" };
    const item = e1Item(b, { reference: ref, status: "fallido", ...ceros });
    item.allocations = [];

    await saveTransactions(client, [item]);

    const guardado = unwrap(
      await client
        .from("pay_transactions")
        .select("status, scheme_version_id, alloc_base, alloc_base_amount::text")
        .eq("reference", ref)
        .single(),
      "cobro fallido",
    );
    expect(guardado).toEqual({
      status: "fallido",
      scheme_version_id: b.schemeVersionId,
      alloc_base: "neto",
      alloc_base_amount: "0.00",
    });
  });
});

describe("el contador de comprobantes del cobro", () => {
  it("lo lleva la base al agregar y al quitar, y no cuenta como edición del cobro", async () => {
    const [cobro] = await saveTransactions(client, [e1Item(b)]);
    const txId = cobro?.id ?? "";
    const leer = async () =>
      unwrap(
        await client.from("pay_transactions").select("user_id, receipts_count, updated_at").eq("id", txId).single(),
        "cobro",
      );
    const alCrear = await leer();
    expect(alCrear.receipts_count).toBe(0);

    const comprobante = unwrap(
      await client
        .from("pay_transaction_receipts")
        .insert({
          transaction_id: txId,
          path: `${alCrear.user_id}/${txId}/recibo.png`,
          mime: "image/png",
          size_bytes: 2048,
        })
        .select("id")
        .single(),
      "comprobante",
    );
    expect(await leer()).toEqual({ ...alCrear, receipts_count: 1 });

    const quitado = await client.from("pay_transaction_receipts").delete().eq("id", comprobante.id).select("id");
    expect(quitado.data).toHaveLength(1);
    expect(await leer()).toEqual(alCrear);
  });

  describe("no se escribe a mano", () => {
    type Cobro = { receipts_count: number; note: string | null; updated_at: string };
    const COLUMNAS = "receipts_count, note, updated_at";

    /** Un cobro insertado directo en la tabla, pidiéndole 3 comprobantes que no tiene. */
    async function crearPidiendoTres(): Promise<{ id: string; userId: string; receiptsCount: number }> {
      const creado = unwrap(
        await client
          .from("pay_transactions")
          .insert(cobroDirecto({ receipts_count: 3 }))
          .select("id, user_id, receipts_count")
          .single(),
        "cobro insertado directo",
      );
      return { id: creado.id, userId: creado.user_id, receiptsCount: creado.receipts_count };
    }
    const leer = async (id: string): Promise<Cobro> =>
      unwrap(await client.from("pay_transactions").select(COLUMNAS).eq("id", id).single(), "cobro");
    /** Un `update` directo sobre el cobro; devuelve la fila como quedó. */
    const escribirAMano = async (id: string, cambio: { receipts_count: number; note?: string }): Promise<Cobro> =>
      unwrap(
        await client.from("pay_transactions").update(cambio).eq("id", id).select(COLUMNAS).single(),
        "update directo",
      );

    it("una inserción directa lo deja en 0 y un update directo deja el valor anterior", async () => {
      const cobro = await crearPidiendoTres();
      expect(cobro.receiptsCount).toBe(0);

      expect((await escribirAMano(cobro.id, { receipts_count: 7 })).receipts_count).toBe(0);

      // Subir un comprobante sigue sumando 1…
      const comprobante = unwrap(
        await client
          .from("pay_transaction_receipts")
          .insert({
            transaction_id: cobro.id,
            path: `${cobro.userId}/${cobro.id}/recibo.png`,
            mime: "image/png",
            size_bytes: 2048,
          })
          .select("id")
          .single(),
        "comprobante",
      );
      expect((await leer(cobro.id)).receipts_count).toBe(1);

      // …a mano no se puede bajar ni subir…
      expect((await escribirAMano(cobro.id, { receipts_count: 0 })).receipts_count).toBe(1);
      expect((await escribirAMano(cobro.id, { receipts_count: 9 })).receipts_count).toBe(1);

      // …y quitarlo sigue restando 1.
      const quitado = await client.from("pay_transaction_receipts").delete().eq("id", comprobante.id).select("id");
      expect(quitado.data).toHaveLength(1);
      expect((await leer(cobro.id)).receipts_count).toBe(0);
    });

    it("un update que cambia la nota y de paso el contador guarda la nota y cuenta como edición", async () => {
      const cobro = await crearPidiendoTres();
      const antes = await leer(cobro.id);

      const despues = await escribirAMano(cobro.id, { receipts_count: 9, note: "con nota" });

      expect(despues).toEqual({ receipts_count: 0, note: "con nota", updated_at: expect.any(String) });
      expect(despues.updated_at).not.toBe(antes.updated_at);
    });
  });

  it("un comprobante fuera de la carpeta de su cobro se rechaza", async () => {
    const [cobro] = await saveTransactions(client, [e1Item(b)]);
    const txId = cobro?.id ?? "";

    const res = await client
      .from("pay_transaction_receipts")
      .insert({ transaction_id: txId, path: `otra-carpeta/${txId}/recibo.png`, mime: "image/png", size_bytes: 2048 })
      .select("id");

    expectRejected(res, "23514", "pay_transaction_receipts_path_check");
  });
});

describe("el historial del cobro", () => {
  let txId: string;

  beforeAll(async () => {
    const [cobro] = await saveTransactions(client, [e1Item(b)]);
    txId = cobro?.id ?? "";
  });

  it("admite el evento «disputa_anulada»", async () => {
    const res = await client
      .from("pay_transaction_events")
      .insert({ transaction_id: txId, kind: "disputa_anulada", summary: "Disputa anulada" })
      .select("kind");

    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ kind: "disputa_anulada" }]);
  });

  it("un tipo de evento inventado se rechaza", async () => {
    const res = await client
      .from("pay_transaction_events")
      .insert({ transaction_id: txId, kind: "disputa_inventada", summary: "No existe" })
      .select("kind");

    expectRejected(res, "23514", "pay_transaction_events_kind_check");
  });
});

describe("un esquema de reparto válido", () => {
  const lineas = (a: string, bPct: string | null): { beneficiary_id: string; pct: string }[] => [
    { beneficiary_id: b.beneficiaryIds.a, pct: a },
    ...(bPct === null ? [] : [{ beneficiary_id: b.beneficiaryIds.b, pct: bPct }]),
  ];

  async function esquemasConNombre(name: string): Promise<number> {
    return unwrap(await client.from("pay_schemes").select("id").eq("name", name), "esquemas").length;
  }

  it("50 + 30 sin «Resto» se rechaza y no queda el esquema", async () => {
    const name = `Esquema ${randomUUID()}`;

    const res = await client.rpc("pay_save_scheme", { p: { name, lines: lineas("50", "30") } });

    expectRejected(res, "23514", "pay_scheme_under_100");
    expect(await esquemasConNombre(name)).toBe(0);
  });

  it("60 + 50 se rechaza aunque haya «Resto»", async () => {
    const name = `Esquema ${randomUUID()}`;

    const res = await client.rpc("pay_save_scheme", {
      p: { name, remainder_beneficiary_id: b.beneficiaryIds.c, lines: lineas("60", "50") },
    });

    expectRejected(res, "23514", "pay_scheme_over_100");
    expect(await esquemasConNombre(name)).toBe(0);
  });

  it("un «Resto» que además es línea se rechaza", async () => {
    const name = `Esquema ${randomUUID()}`;

    const res = await client.rpc("pay_save_scheme", {
      p: { name, remainder_beneficiary_id: b.beneficiaryIds.b, lines: lineas("50", "30") },
    });

    expectRejected(res, "23514", "pay_scheme_remainder_in_lines");
    expect(await esquemasConNombre(name)).toBe(0);
  });

  it("50 + 30 con «Resto» se guarda", async () => {
    const name = `Esquema ${randomUUID()}`;

    const guardado = unwrap(
      await client.rpc("pay_save_scheme", {
        p: { name, remainder_beneficiary_id: b.beneficiaryIds.c, lines: lineas("50", "30") },
      }),
      "esquema con «Resto»",
    ) as { version_id: string };

    const version = unwrap(
      await client
        .from("pay_scheme_versions")
        .select("remainder_beneficiary_id, pay_scheme_lines(pct::text)")
        .eq("id", guardado.version_id)
        .single(),
      "versión guardada",
    );
    expect(version.remainder_beneficiary_id).toBe(b.beneficiaryIds.c);
    expect(version.pay_scheme_lines.map((linea) => linea.pct).sort()).toEqual(["30.0000", "50.0000"]);
  });

  it("agregar a mano una línea que pasa de 100 % se rechaza", async () => {
    // El esquema de seedBasics ya suma 100 % (50 + 30 + 20) entre A, B y C.
    const otro = unwrap(
      await client.from("pay_beneficiaries").insert({ name: `Grupo ${randomUUID()}` }).select("id").single(),
      "otro beneficiario",
    );

    const res = await client
      .from("pay_scheme_lines")
      .insert({ scheme_version_id: b.schemeVersionId, beneficiary_id: otro.id, pct: "0.0001" })
      .select("id");

    expectRejected(res, "23514", "pay_scheme_over_100");
  });
});

describe("nada que parezca un número de cuenta o de tarjeta, ni links peligrosos", () => {
  it("last4 con 5 dígitos se rechaza", async () => {
    const res = await client
      .from("pay_bank_accounts")
      .insert({ alias: "Cuenta de prueba", last4: "12345" })
      .select("id");
    expectRejected(res, "23514", "last4");
  });

  it("un alias de cuenta con 7 dígitos seguidos se rechaza", async () => {
    const res = await client.from("pay_bank_accounts").insert({ alias: "Cuenta 1234567" }).select("id");
    expectRejected(res, "23514", "alias");
  });

  it("un alias de cuenta con 6 dígitos seguidos sí se guarda", async () => {
    const res = await client.from("pay_bank_accounts").insert({ alias: "Cuenta 123456" }).select("alias").single();
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ alias: "Cuenta 123456" });
  });

  it("el alias de la cuenta de un beneficiario con 7 dígitos seguidos se rechaza", async () => {
    const res = await client
      .from("pay_beneficiaries")
      .insert({ name: `Grupo ${randomUUID()}`, account_alias: "Banco 7654321" })
      .select("id");
    expectRejected(res, "23514", "account_alias");
  });

  it("una web con javascript: se rechaza", async () => {
    const res = await client
      .from("pay_companies")
      .insert({ name: `Empresa ${randomUUID()}`, website: "javascript:alert(1)" })
      .select("id");
    expectRejected(res, "23514", "website");
  });

  it("una web con https:// sí se guarda", async () => {
    const res = await client
      .from("pay_companies")
      .insert({ name: `Empresa ${randomUUID()}`, website: "https://escuela-demo.example.com" })
      .select("website")
      .single();
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ website: "https://escuela-demo.example.com" });
  });
});

describe("el nombre es único por usuario, sin distinguir mayúsculas ni espacios de los extremos", () => {
  const CON_NOMBRE_UNICO = [
    { que: "una empresa", tabla: "pay_companies", indice: "pay_companies_name_uq" },
    { que: "una pasarela", tabla: "pay_gateways", indice: "pay_gateways_name_uq" },
    { que: "un beneficiario", tabla: "pay_beneficiaries", indice: "pay_beneficiaries_name_uq" },
    { que: "un esquema", tabla: "pay_schemes", indice: "pay_schemes_name_uq" },
  ] as const;
  let otro: Db;

  beforeAll(async () => {
    otro = (await createUser()).client;
  });

  it.each(CON_NOMBRE_UNICO)("$que con un nombre que ya existe se rechaza", async (caso) => {
    const name = `Demo ${randomUUID()}`;
    unwrap(await client.from(caso.tabla).insert({ name }).select("id"), caso.tabla);

    const res = await client.from(caso.tabla).insert({ name: ` ${name.toUpperCase()} ` }).select("id");

    expectRejected(res, "23505", caso.indice);
  });

  it.each(CON_NOMBRE_UNICO)("$que con el nombre que ya usa otro usuario sí se guarda", async (caso) => {
    const name = `Demo ${randomUUID()}`;
    unwrap(await client.from(caso.tabla).insert({ name }).select("id"), caso.tabla);

    const res = await otro.from(caso.tabla).insert({ name }).select("name");

    expect(res.error).toBeNull();
    expect(res.data).toEqual([{ name }]);
  });
});

describe("lo que tiene cobros no se puede borrar (foco 5)", () => {
  let otro: Db;
  let propio: Basics;
  let txId: string;

  beforeAll(async () => {
    // Configuración aparte, para que estos intentos de borrado no toquen la de las demás pruebas.
    otro = (await createUser()).client;
    propio = await seedBasics(otro);
    const [cobro] = await saveTransactions(otro, [e1Item(propio)]);
    txId = cobro?.id ?? "";
  });

  const CON_COBROS = [
    { que: "una pasarela", tabla: "pay_gateways", id: () => propio.gatewayId },
    { que: "un canal", tabla: "pay_channels", id: () => propio.channelId },
    { que: "un beneficiario", tabla: "pay_beneficiaries", id: () => propio.beneficiaryIds.a },
    { que: "una versión de esquema", tabla: "pay_scheme_versions", id: () => propio.schemeVersionId },
  ] as const;

  it.each(CON_COBROS)("borrar $que con cobros da error de clave foránea y la fila sigue ahí", async (caso) => {
    const res = await otro.from(caso.tabla).delete().eq("id", caso.id()).select("id");

    expectRejected(res, "23503");
    const sigue = unwrap(await otro.from(caso.tabla).select("id").eq("id", caso.id()), caso.tabla);
    expect(sigue).toEqual([{ id: caso.id() }]);
  });

  it("después de los intentos, el cobro y su reparto siguen completos", async () => {
    const cobro = unwrap(
      await otro
        .from("pay_transactions")
        .select("gateway_id, channel_id, scheme_version_id, net_amount::text, pay_allocations(amount::text)")
        .eq("id", txId)
        .single(),
      "cobro",
    );
    expect(cobro.gateway_id).toBe(propio.gatewayId);
    expect(cobro.channel_id).toBe(propio.channelId);
    expect(cobro.scheme_version_id).toBe(propio.schemeVersionId);
    expect(cobro.net_amount).toBe("90.30");
    expect(cobro.pay_allocations.map((linea) => linea.amount).sort()).toEqual(["18.06", "27.09", "45.15"]);
  });
});
