import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { SCHEME_ISSUE_TEXT, type NewTxInput } from "@/lib/pasarelas";
import { errorMessage } from "@/server/pasarelas/errors";
import { importTransactions } from "@/server/pasarelas/ops/import";
import { saveScheme } from "@/server/pasarelas/ops/splits";
import { createTx, editTx } from "@/server/pasarelas/ops/transactions";
import { getSnapshots } from "@/server/pasarelas/queries/transactions";
import { createUser, e1Item, expectRejected, saveTransactions, seedBasics, unwrap, type Basics, type Db } from "./helpers";

/**
 * Partes que no pagan comisión, en la base (migración 20261114120000). Cada línea de un esquema lleva la marca «No
 * paga comisión» (`pay_scheme_lines.fee_exempt`); lo que ya existía queda sin ella. En el reparto de un cobro, la
 * fila de una parte que no paga comisión va sobre el bruto y las demás sobre el neto: las restricciones y los
 * disparadores de siempre lo admiten tal cual, y el reparto sigue sumando el neto.
 */

let client: Db;
let b: Basics;

beforeAll(async () => {
  client = (await createUser()).client;
  b = await seedBasics(client);
});

/** Las líneas de una versión de un esquema, en su orden, con su marca. */
async function linesOf(db: Db, versionId: string) {
  return unwrap(
    await db
      .from("pay_scheme_lines")
      .select("beneficiary_id, pct::text, fee_exempt")
      .eq("scheme_version_id", versionId)
      .order("sort"),
    "líneas del esquema",
  );
}

describe("pay_scheme_lines.fee_exempt", () => {
  it("nace en false: un esquema guardado sin decirlo queda como los de antes", async () => {
    expect(await linesOf(client, b.schemeVersionId)).toEqual([
      { beneficiary_id: b.beneficiaryIds.a, pct: "50.0000", fee_exempt: false },
      { beneficiary_id: b.beneficiaryIds.b, pct: "30.0000", fee_exempt: false },
      { beneficiary_id: b.beneficiaryIds.c, pct: "20.0000", fee_exempt: false },
    ]);
  });

  it("pay_save_scheme la guarda en cada línea; la que no la dice queda en false", async () => {
    const saved = unwrap(
      await client.rpc("pay_save_scheme", {
        p: {
          name: "Grupo C sin comisión",
          base: "neto",
          lines: [
            { beneficiary_id: b.beneficiaryIds.a, pct: "50", fee_exempt: false },
            { beneficiary_id: b.beneficiaryIds.b, pct: "30" },
            { beneficiary_id: b.beneficiaryIds.c, pct: "20", fee_exempt: true },
          ],
        },
      }),
      "esquema",
    ) as { version_id: string };
    expect(await linesOf(client, saved.version_id)).toEqual([
      { beneficiary_id: b.beneficiaryIds.a, pct: "50.0000", fee_exempt: false },
      { beneficiary_id: b.beneficiaryIds.b, pct: "30.0000", fee_exempt: false },
      { beneficiary_id: b.beneficiaryIds.c, pct: "20.0000", fee_exempt: true },
    ]);
  });
});

describe("pay_allocations con una parte que no paga comisión", () => {
  /**
   * E1 (100,00; comisiones 9,70; neto 90,30) con el Grupo C sin comisión: C recibe el 20 % del bruto (20,00) y A y B
   * se reparten los 70,30 que quedan del neto en proporción 50:30 (43,94 · 26,36). La suma es el neto.
   */
  const e1Spared = (amounts: { a: string; b: string; c: string }) => ({
    ...e1Item(b),
    allocations: [
      { beneficiary_id: b.beneficiaryIds.a, amount: amounts.a, base: "neto", pct: "50", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.b, amount: amounts.b, base: "neto", pct: "30", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.c, amount: amounts.c, base: "bruto", pct: "20", is_remainder: false },
    ],
  });

  it("las restricciones y los disparadores de siempre admiten una base por fila: la exenta sobre el bruto", async () => {
    const [saved] = await saveTransactions(client, [e1Spared({ a: "43.94", b: "26.36", c: "20.00" })]);
    const tx = unwrap(
      await client.from("pay_transactions").select("alloc_base, alloc_base_amount::text").eq("id", saved!.id).single(),
      "cobro",
    );
    expect(tx).toEqual({ alloc_base: "neto", alloc_base_amount: "90.30" });
    const rows = unwrap(
      await client
        .from("pay_allocations")
        .select("beneficiary_id, amount::text, base, pct::text")
        .eq("transaction_id", saved!.id)
        .order("amount", { ascending: false }),
      "reparto",
    );
    expect(rows).toEqual([
      { beneficiary_id: b.beneficiaryIds.a, amount: "43.94", base: "neto", pct: "50.0000" },
      { beneficiary_id: b.beneficiaryIds.b, amount: "26.36", base: "neto", pct: "30.0000" },
      { beneficiary_id: b.beneficiaryIds.c, amount: "20.00", base: "bruto", pct: "20.0000" },
    ]);
  });

  it("el reparto tiene que seguir sumando el neto: con bases mezcladas, un centavo de más no entra", async () => {
    expectRejected(
      await client.rpc("pay_save_transactions", { p_items: [e1Spared({ a: "43.95", b: "26.36", c: "20.00" })] }),
      "23514",
      "pay_alloc_sum_mismatch",
    );
  });
});

// ─── Con las operaciones de la app ──────────────────────────────────────────────────────────────────────────

/** Lo que el error le dice a la persona. */
async function failureText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error("debió fallar");
}

/** El reparto guardado de un cobro, de mayor a menor. */
async function allocationsOf(db: Db, id: string) {
  return unwrap(
    await db
      .from("pay_allocations")
      .select("beneficiary_id, amount::text, base, pct::text")
      .eq("transaction_id", id)
      .order("amount", { ascending: false }),
    "reparto",
  );
}

describe("esquemas y cobros con partes que no pagan comisión (ops)", () => {
  /** Un esquema 50/30/20 sobre el neto con el Grupo C marcado «No paga comisión» (`saveScheme`, como la pantalla). */
  async function schemeWithC(name: string): Promise<{ schemeId: string; versionId: string }> {
    return saveScheme(client, {
      schemeId: null,
      name,
      base: "neto",
      remainderBeneficiaryId: null,
      effectiveFrom: "2000-01-01",
      lines: [
        { beneficiaryId: b.beneficiaryIds.a, pct: "50", feeExempt: false },
        { beneficiaryId: b.beneficiaryIds.b, pct: "30", feeExempt: false },
        { beneficiaryId: b.beneficiaryIds.c, pct: "20", feeExempt: true },
      ],
    });
  }

  /** E9: 1000,00 USD por Stripe (2,9 % + 0,30), sin opciones ni canal, pagando nosotros. */
  const e9 = (schemeId: string, patch: Partial<NewTxInput> = {}): NewTxInput => ({
    id: randomUUID(),
    companyId: b.companyId,
    channelId: null,
    gatewayId: b.gatewayId,
    extraIds: [],
    schemeId,
    occurredAt: "2026-11-13T15:00:00Z",
    occurredOn: "2026-11-13",
    currency: "USD",
    grossOriginal: "1000.00",
    reference: null,
    note: null,
    feesPaidBy: "nosotros",
    ...patch,
  });

  it("saveScheme guarda la marca de cada línea", async () => {
    const saved = await schemeWithC("Grupo C sin comisión (ops)");
    expect((await linesOf(client, saved.versionId)).map((line) => line.fee_exempt)).toEqual([false, false, true]);
  });

  it("un esquema en el que nadie paga la comisión no se guarda: lo dice con el texto de la pantalla", async () => {
    const text = await failureText(
      saveScheme(client, {
        schemeId: null,
        name: "Nadie paga",
        base: "neto",
        remainderBeneficiaryId: null,
        effectiveFrom: "2000-01-01",
        lines: [
          { beneficiaryId: b.beneficiaryIds.a, pct: "50", feeExempt: true },
          { beneficiaryId: b.beneficiaryIds.b, pct: "50", feeExempt: true },
        ],
      }),
    );
    expect(text).toBe(SCHEME_ISSUE_TEXT.nadie_paga_comision);
    const { data } = await client.from("pay_schemes").select("id").eq("name", "Nadie paga");
    expect(data).toEqual([]);
  });

  it("E9: createTx guarda las bases por fila (la de C sobre el bruto) y la suma es el neto", async () => {
    const { schemeId } = await schemeWithC("Grupo C sin comisión (E9)");
    const { id } = await createTx(client, e9(schemeId));
    const tx = unwrap(
      await client
        .from("pay_transactions")
        .select("fees_total::text, net_amount::text, alloc_base, alloc_base_amount::text")
        .eq("id", id)
        .single(),
      "cobro",
    );
    expect(tx).toEqual({ fees_total: "29.30", net_amount: "970.70", alloc_base: "neto", alloc_base_amount: "970.70" });
    expect(await allocationsOf(client, id)).toEqual([
      { beneficiary_id: b.beneficiaryIds.a, amount: "481.69", base: "neto", pct: "50.0000" },
      { beneficiary_id: b.beneficiaryIds.b, amount: "289.01", base: "neto", pct: "30.0000" },
      { beneficiary_id: b.beneficiaryIds.c, amount: "200.00", base: "bruto", pct: "20.0000" },
    ]);
    // El desglose congelado se lee tal cual y dice quién no pagó comisión.
    const [snapshot] = await getSnapshots(client, [id]);
    expect(snapshot?.breakdown.alloc.lines.map((line) => line.feeExempt)).toEqual([false, false, true]);
  });

  it("la marca cambiada para un cobro queda en ese cobro; el esquema y los demás cobros no cambian", async () => {
    const { schemeId, versionId } = await schemeWithC("Grupo C sin comisión (un cobro)");
    const { id } = await createTx(client, e9(schemeId, { feeExemptIds: [] }));
    expect((await allocationsOf(client, id)).map((row) => [row.amount, row.base])).toEqual([
      ["485.35", "neto"],
      ["291.21", "neto"],
      ["194.14", "neto"],
    ]);
    expect((await linesOf(client, versionId)).map((line) => line.fee_exempt)).toEqual([false, false, true]);

    // Editarlo vuelve a marcar a C solo en este cobro; el historial lo dice.
    const [before] = await getSnapshots(client, [id]);
    await editTx(client, id, { feeExemptIds: [b.beneficiaryIds.c] }, before?.updatedAt);
    expect((await allocationsOf(client, id)).map((row) => [row.amount, row.base])).toEqual([
      ["481.69", "neto"],
      ["289.01", "neto"],
      ["200.00", "bruto"],
    ]);
    const event = unwrap(
      await client
        .from("pay_transaction_events")
        .select("summary")
        .eq("transaction_id", id)
        .eq("kind", "editado")
        .single(),
      "evento",
    );
    expect(event.summary).toBe("Editado: quién no paga comisión");
  });

  it("E9c: registrar con todas las partes marcadas se rechaza con su mensaje y no guarda nada", async () => {
    const { schemeId } = await schemeWithC("Grupo C sin comisión (E9c)");
    const all = [b.beneficiaryIds.a, b.beneficiaryIds.b, b.beneficiaryIds.c];
    const input = e9(schemeId, { feeExemptIds: all });
    expect(await failureText(createTx(client, input))).toBe(
      "Alguien tiene que pagar la comisión: deja al menos una parte sin marcar.",
    );
    expect(await getSnapshots(client, [input.id])).toEqual([]);
  });

  it("importar usa las marcas del esquema de la empresa", async () => {
    // Otro usuario: aquí el esquema por defecto de su empresa es el que tiene al Grupo C sin comisión.
    const owner = (await createUser()).client;
    const basics = await seedBasics(owner);
    const { schemeId } = await saveScheme(owner, {
      schemeId: null,
      name: "Grupo C sin comisión (importar)",
      base: "neto",
      remainderBeneficiaryId: null,
      effectiveFrom: "2000-01-01",
      lines: [
        { beneficiaryId: basics.beneficiaryIds.a, pct: "50" },
        { beneficiaryId: basics.beneficiaryIds.b, pct: "30" },
        { beneficiaryId: basics.beneficiaryIds.c, pct: "20", feeExempt: true },
      ],
    });
    unwrap(
      await owner.from("pay_companies").update({ default_scheme_id: schemeId }).eq("id", basics.companyId).select("id"),
      "esquema por defecto",
    );
    const reference = `txn_${randomUUID().slice(0, 8)}`;
    const result = await importTransactions(owner, {
      companyId: basics.companyId,
      gatewayId: basics.gatewayId,
      channelId: null,
      extraIds: [],
      useReportedFee: false,
      alreadyDeposited: false,
      rows: [
        {
          line: 2,
          reference,
          occurredAt: "2026-11-13T15:30:00.000Z",
          occurredOn: "2026-11-13",
          grossOriginal: "1000.00",
          currency: "USD",
          reportedFee: null,
          note: null,
        },
      ],
    });
    expect(result).toMatchObject({ created: 1 });
    const tx = unwrap(await owner.from("pay_transactions").select("id").eq("reference", reference).single(), "cobro");
    expect((await allocationsOf(owner, tx.id)).map((row) => [row.amount, row.base])).toEqual([
      ["481.69", "neto"],
      ["289.01", "neto"],
      ["200.00", "bruto"],
    ]);
  });
});
