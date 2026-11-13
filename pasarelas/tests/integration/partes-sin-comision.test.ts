import { beforeAll, describe, expect, it } from "vitest";
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
