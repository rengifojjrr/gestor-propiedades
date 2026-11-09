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

beforeAll(async () => {
  client = (await createUser()).client;
  b = await seedBasics(client);
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
    // 100,00 − 9,70 = 90,30, no 90,31.
    const item = e1Item(b, { reference: ref, net_amount: "90.31" });

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
      const item = e1Item(b, { reference: ref, status: "fallido", ...ceros, fees_total: "9.70", net_amount: "-9.70" });
      item.allocations = repartoEnCero();

      const res = await client.rpc("pay_save_transactions", { p_items: [item] });

      expectRejected(res, "23514", "pay_transactions_gross_check");
      expect(await cobrosConReferencia(ref)).toBe(0);
    });

    it("con reparto se rechaza, aunque el reparto sume su base", async () => {
      const ref = referencia();
      // Bruto, comisiones y neto en cero, pero conserva la base de 90,30 y su reparto 45,15 · 27,09 · 18,06.
      const item = e1Item(b, { reference: ref, status: "fallido", ...ceros, alloc_base_amount: "90.30" });

      const res = await client.rpc("pay_save_transactions", { p_items: [item] });

      expectRejected(res, "23514", "pay_transactions_gross_check");
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
