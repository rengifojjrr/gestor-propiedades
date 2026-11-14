import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PAYOUT_ALREADY_SAVED_TEXT, PAYOUT_CHANGED_TEXT } from "@/components/pasarelas/splits/settlementText";
import { add, type Money, type NewTxInput, type PayoutStatus } from "@/lib/pasarelas";
import { errorMessage } from "@/server/pasarelas/errors";
import { createGateway, saveGatewayRetention } from "@/server/pasarelas/ops/gateways";
import { deleteSettlement, recordPayouts, type PayoutInput } from "@/server/pasarelas/ops/settlements";
import { saveScheme } from "@/server/pasarelas/ops/splits";
import { createTx, failTx, purgeTx, refundTx, trashTx } from "@/server/pasarelas/ops/transactions";
import { listOwed, listSettlements, listTxPayouts, payoutStatuses } from "@/server/pasarelas/queries/settlements";
import { getSnapshots, leanTx, listTx, parseTxFilters } from "@/server/pasarelas/queries/transactions";
import { createUser, expectRejected, seedBasics, unwrap, type Basics, type Db, type TestUser } from "./helpers";

/**
 * Marcar en cada cobro que ya se le pagó a cada parte del reparto (migración 20261116120000). Cada marca es una
 * liquidación ligada a sus cobros: `pay_settlement_items` dice de qué cobros es cada liquidación y cuánto de cada
 * uno. La base exige que cada parte sea del beneficiario de su liquidación, en la moneda de su cobro, y que las partes
 * sumen exactamente la liquidación. Los saldos siguen saliendo de las liquidaciones: no cambian.
 *
 * Los casos usan E10 de la tarea 49: OTF Demo (2,9 % + 0,20) retiene el 5 % para Titular A y Titular B, y el esquema
 * «Sobre el neto» da Grupo A 60 %, Grupo B 30 % y 5 % a cada titular. 1000,00 USD → Grupo A 580,53 · Grupo B 290,27 ·
 * Titular A 50,00 · Titular B 50,00, y a cada titular se le retuvieron 25,00.
 */

type E10 = {
  user: TestUser;
  db: Db;
  basics: Basics;
  otfId: string;
  schemeId: string;
  /** Grupo A y Grupo B son los de `seedBasics`; los titulares, nuevos. */
  ids: { ga: string; gb: string; ta: string; tb: string };
};

/** Un usuario nuevo con OTF Demo, su retención y el esquema de E10. */
async function setupE10(): Promise<E10> {
  const user = await createUser();
  const db = user.client;
  const basics = await seedBasics(db);
  const titulares = unwrap(
    await db.from("pay_beneficiaries").insert([{ name: "Titular A" }, { name: "Titular B" }]).select("id, name"),
    "titulares",
  );
  const idOf = (name: string) => titulares.find((row) => row.name === name)?.id ?? "";
  const ids = { ga: basics.beneficiaryIds.a, gb: basics.beneficiaryIds.b, ta: idOf("Titular A"), tb: idOf("Titular B") };
  const { id: otfId } = await createGateway(db, {
    name: "OTF Demo",
    payoutDays: 2,
    payoutDaysMax: null,
    payoutDayType: "habiles",
    refundsReturnFee: false,
    disputeFee: "0.00",
    notes: null,
    pct: "2.9",
    fixed: "0.20",
    extras: [],
  });
  const { schemeId } = await saveScheme(db, {
    schemeId: null,
    name: "Sobre el neto",
    base: "neto",
    remainderBeneficiaryId: null,
    effectiveFrom: "2000-01-01",
    lines: [
      { beneficiaryId: ids.ga, pct: "60", feeExempt: false },
      { beneficiaryId: ids.gb, pct: "30", feeExempt: false },
      { beneficiaryId: ids.ta, pct: "5", feeExempt: true },
      { beneficiaryId: ids.tb, pct: "5", feeExempt: true },
    ],
  });
  await saveGatewayRetention(db, {
    gatewayId: otfId,
    pct: "5",
    days: 30,
    recipients: [
      { beneficiaryId: ids.ta, pct: "50" },
      { beneficiaryId: ids.tb, pct: "50" },
    ],
  });
  return { user, db, basics, otfId, schemeId, ids };
}

/** Un cobro E10: 1000,00 USD el 10 nov 2026 por OTF Demo, sin opciones ni canal. Devuelve su id. */
async function chargeE10(e10: E10, patch: Partial<NewTxInput> = {}): Promise<string> {
  const { id } = await createTx(e10.db, {
    id: randomUUID(),
    companyId: e10.basics.companyId,
    bankAccountId: e10.basics.bankAccountId,
    channelId: null,
    gatewayId: e10.otfId,
    extraIds: [],
    schemeId: e10.schemeId,
    occurredAt: "2026-11-10T15:00:00Z",
    occurredOn: "2026-11-10",
    currency: "USD",
    grossOriginal: "1000.00",
    reference: `E10-${randomUUID().slice(0, 8)}`,
    note: null,
    feesPaidBy: "nosotros",
    ...patch,
  });
  return id;
}

/** Una liquidación para `pay_record_payouts`, con sus partes. */
type PayoutPayload = {
  id: string;
  beneficiary_id: string;
  paid_on: string;
  currency: string;
  amount: string;
  method?: string | null;
  note?: string | null;
  items: { transaction_id: string; amount: string }[];
};

const payout = (
  beneficiaryId: string,
  items: PayoutPayload["items"],
  patch: Partial<PayoutPayload> = {},
): PayoutPayload => ({
  id: randomUUID(),
  beneficiary_id: beneficiaryId,
  paid_on: "2026-11-14",
  currency: "USD",
  amount: add("0.00", ...items.map((item) => item.amount)),
  method: "Transferencia",
  items,
  ...patch,
});

/** Las liquidaciones con sus partes: [beneficiario, monto, [[cobro, monto]…]], en orden de monto. */
async function settlementsOf(db: Db) {
  const rows = unwrap(
    await db
      .from("pay_settlements")
      .select("id, beneficiary_id, amount::text, pay_settlement_items(transaction_id, amount::text)")
      .order("amount", { ascending: false }),
    "liquidaciones",
  );
  return rows.map((row) => ({
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    amount: row.amount,
    items: row.pay_settlement_items
      .map((item) => [item.transaction_id, item.amount] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  }));
}

/** El saldo de un beneficiario en USD, tal como lo da la vista. */
async function balanceOf(db: Db, beneficiaryId: string) {
  return unwrap(
    await db
      .from("pay_beneficiary_balances")
      .select("assigned::text, settled::text, retained::text, balance::text")
      .eq("beneficiary_id", beneficiaryId)
      .eq("currency", "USD"),
    "saldo",
  )[0];
}

// ─── En la base ─────────────────────────────────────────────────────────────────────────────────────────────

describe("pay_record_payouts: liquidaciones con sus cobros, en una sola transacción", () => {
  it("P2: crea una liquidación por parte, cada una con su cobro, y devuelve sus ids", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    const payouts = [
      payout(e10.ids.ga, [{ transaction_id: tx, amount: "580.53" }]),
      payout(e10.ids.gb, [{ transaction_id: tx, amount: "290.27" }]),
      payout(e10.ids.ta, [{ transaction_id: tx, amount: "25.00" }]),
      payout(e10.ids.tb, [{ transaction_id: tx, amount: "25.00" }]),
    ];
    const res = await e10.db.rpc("pay_record_payouts", { p: { settlements: payouts } });
    expect(res.error).toBeNull();
    expect(res.data).toEqual(payouts.map((p) => ({ id: p.id, inserted: true })));
    const saved = await settlementsOf(e10.db);
    expect(saved.map((s) => [s.beneficiaryId, s.amount, s.items])).toEqual([
      [e10.ids.ga, "580.53", [[tx, "580.53"]]],
      [e10.ids.gb, "290.27", [[tx, "290.27"]]],
      [e10.ids.ta, "25.00", [[tx, "25.00"]]],
      [e10.ids.tb, "25.00", [[tx, "25.00"]]],
    ]);
    // El medio y la fecha quedan en la liquidación, como en una registrada a mano.
    const ga = unwrap(
      await e10.db.from("pay_settlements").select("paid_on, method, note").eq("id", payouts[0]!.id).single(),
      "liquidación",
    );
    expect(ga).toEqual({ paid_on: "2026-11-14", method: "Transferencia", note: null });
  });

  it("P3: una liquidación por parte con una parte por cobro", async () => {
    const e10 = await setupE10();
    const [t1, t2] = [await chargeE10(e10), await chargeE10(e10)];
    const gb = payout(e10.ids.gb, [
      { transaction_id: t1, amount: "290.27" },
      { transaction_id: t2, amount: "290.27" },
    ]);
    expect(gb.amount).toBe("580.54");
    unwrap(await e10.db.rpc("pay_record_payouts", { p: { settlements: [gb] } }), "pagar");
    const items = [t1, t2].sort().map((tx) => [tx, "290.27"]);
    expect((await settlementsOf(e10.db)).map((s) => [s.amount, s.items])).toEqual([["580.54", items]]);
  });

  it("es idempotente por el id de cada liquidación: repetir no duplica; con otros datos no se da por buena", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    const ga = payout(e10.ids.ga, [{ transaction_id: tx, amount: "580.53" }]);
    const gb = payout(e10.ids.gb, [{ transaction_id: tx, amount: "290.27" }]);
    unwrap(await e10.db.rpc("pay_record_payouts", { p: { settlements: [ga] } }), "primera vez");

    // La misma de nuevo (la respuesta se perdió) junto con una nueva: la primera se salta y la nueva se crea.
    const again = await e10.db.rpc("pay_record_payouts", { p: { settlements: [ga, gb] } });
    expect(again.error).toBeNull();
    expect(again.data).toEqual([
      { id: ga.id, inserted: false },
      { id: gb.id, inserted: true },
    ]);
    expect(await settlementsOf(e10.db)).toHaveLength(2);

    // Con el mismo id pero otro monto u otros cobros, no: quedó la del primer intento.
    for (const changed of [
      { ...ga, amount: "500.00", items: [{ transaction_id: tx, amount: "500.00" }] },
      { ...ga, beneficiary_id: e10.ids.gb },
      { ...ga, paid_on: "2026-11-15" },
    ]) {
      expectRejected(
        await e10.db.rpc("pay_record_payouts", { p: { settlements: [changed] } }),
        "23505",
        "pay_payout_already_saved",
      );
    }
    expect((await settlementsOf(e10.db)).map((s) => [s.id, s.amount])).toEqual([
      [ga.id, "580.53"],
      [gb.id, "290.27"],
    ]);
  });

  it("todo o nada: si una liquidación no cuadra, no se guarda ninguna", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    const ok = payout(e10.ids.ga, [{ transaction_id: tx, amount: "580.53" }]);
    const wrong = payout(e10.ids.gb, [{ transaction_id: tx, amount: "290.27" }], { amount: "290.00" });
    expectRejected(
      await e10.db.rpc("pay_record_payouts", { p: { settlements: [ok, wrong] } }),
      "23514",
      "pay_settlement_items_sum_mismatch",
    );
    expect(await settlementsOf(e10.db)).toEqual([]);
  });

  it("rechaza lo que no tiene forma de liquidación con sus cobros", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    const call = (p: unknown) => e10.db.rpc("pay_record_payouts", { p: p as never });
    expectRejected(await call({}), "22023", "pay_bad_payload");
    expectRejected(await call({ settlements: [] }), "22023", "pay_bad_payload");
    expectRejected(await call({ settlements: [{ ...payout(e10.ids.ga, []), amount: "1.00" }] }), "22023", "pay_bad_payload");
    // Dos veces el mismo cobro en una liquidación.
    expectRejected(
      await call({
        settlements: [
          payout(e10.ids.ga, [
            { transaction_id: tx, amount: "1.00" },
            { transaction_id: tx, amount: "2.00" },
          ]),
        ],
      }),
      "23505",
      "pay_settlement_items_uq",
    );
    expect(await settlementsOf(e10.db)).toEqual([]);
  });
});

describe("pay_settlement_items: lo que la base hace cumplir", () => {
  /** Una liquidación sin partes, insertada a mano como las de siempre. */
  async function plainSettlement(e10: E10, beneficiaryId: string, amount: string, currency = "USD"): Promise<string> {
    return unwrap(
      await e10.db
        .from("pay_settlements")
        .insert({ beneficiary_id: beneficiaryId, paid_on: "2026-11-14", amount, currency })
        .select("id")
        .single(),
      "liquidación",
    ).id;
  }

  it("cada parte es del beneficiario de su liquidación", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    const settlement = await plainSettlement(e10, e10.ids.ga, "10.00");
    expectRejected(
      await e10.db
        .from("pay_settlement_items")
        .insert({ settlement_id: settlement, transaction_id: tx, beneficiary_id: e10.ids.gb, amount: "10.00" })
        .select("id"),
      "23503",
    );
    // Y una liquidación con partes no cambia de beneficiario.
    unwrap(
      await e10.db
        .from("pay_settlement_items")
        .insert({ settlement_id: settlement, transaction_id: tx, beneficiary_id: e10.ids.ga, amount: "10.00" })
        .select("id"),
      "parte",
    );
    expectRejected(
      await e10.db.from("pay_settlements").update({ beneficiary_id: e10.ids.gb }).eq("id", settlement).select("id"),
      "23503",
    );
  });

  it("la moneda del cobro es la de la liquidación (también si después cambia una de las dos)", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    const eur = await plainSettlement(e10, e10.ids.ga, "10.00", "EUR");
    expectRejected(
      await e10.db
        .from("pay_settlement_items")
        .insert({ settlement_id: eur, transaction_id: tx, beneficiary_id: e10.ids.ga, amount: "10.00" })
        .select("id"),
      "23514",
      "pay_settlement_items_currency_mismatch",
    );
    expectRejected(
      await e10.db.rpc("pay_record_payouts", {
        p: { settlements: [payout(e10.ids.ga, [{ transaction_id: tx, amount: "10.00" }], { currency: "EUR" })] },
      }),
      "23514",
      "pay_settlement_items_currency_mismatch",
    );

    const usd = payout(e10.ids.ga, [{ transaction_id: tx, amount: "10.00" }]);
    unwrap(await e10.db.rpc("pay_record_payouts", { p: { settlements: [usd] } }), "pagar en USD");
    expectRejected(
      await e10.db.from("pay_settlements").update({ currency: "EUR" }).eq("id", usd.id).select("id"),
      "23514",
      "pay_settlement_items_currency_mismatch",
    );
    expectRejected(
      await e10.db.from("pay_transactions").update({ currency: "EUR" }).eq("id", tx).select("id"),
      "23514",
      "pay_settlement_items_currency_mismatch",
    );
    // Lo demás del cobro se sigue pudiendo cambiar.
    unwrap(await e10.db.from("pay_transactions").update({ note: "nota" }).eq("id", tx).select("id"), "nota");
  });

  it("si una liquidación tiene partes, suman exactamente su monto; sin partes, como siempre", async () => {
    const e10 = await setupE10();
    const [t1, t2] = [await chargeE10(e10), await chargeE10(e10)];
    const settlement = await plainSettlement(e10, e10.ids.ga, "100.00");
    const item = (transactionId: string, amount: string) => ({
      settlement_id: settlement,
      transaction_id: transactionId,
      beneficiary_id: e10.ids.ga,
      amount,
    });
    expectRejected(
      await e10.db.from("pay_settlement_items").insert(item(t1, "90.00")).select("id"),
      "23514",
      "pay_settlement_items_sum_mismatch",
    );
    unwrap(await e10.db.from("pay_settlement_items").insert([item(t1, "90.00"), item(t2, "10.00")]).select("id"), "dos");

    // Cambiar el monto de la liquidación, el de una parte o quitar una parte deja de cuadrar.
    expectRejected(
      await e10.db.from("pay_settlements").update({ amount: "99.00" }).eq("id", settlement).select("id"),
      "23514",
      "pay_settlement_items_sum_mismatch",
    );
    expectRejected(
      await e10.db
        .from("pay_settlement_items")
        .update({ amount: "11.00" })
        .eq("settlement_id", settlement)
        .eq("transaction_id", t2)
        .select("id"),
      "23514",
      "pay_settlement_items_sum_mismatch",
    );
    expectRejected(
      await e10.db.from("pay_settlement_items").delete().eq("settlement_id", settlement).eq("transaction_id", t2).select("id"),
      "23514",
      "pay_settlement_items_sum_mismatch",
    );
    // Sin ninguna parte vuelve a ser una liquidación de las de siempre.
    unwrap(await e10.db.from("pay_settlement_items").delete().eq("settlement_id", settlement).select("id"), "todas");
    unwrap(await e10.db.from("pay_settlements").update({ amount: "99.00" }).eq("id", settlement).select("id"), "monto");
    // Una parte nunca es 0.
    expectRejected(
      await e10.db.from("pay_settlement_items").insert(item(t1, "0.00")).select("id"),
      "23514",
      "pay_settlement_items_amount_check",
    );
  });

  it("borrar la liquidación borra sus partes; borrar del todo un cobro con partes pagadas no se puede", async () => {
    const e10 = await setupE10();
    const [t1, t2] = [await chargeE10(e10), await chargeE10(e10)];
    const gb = payout(e10.ids.gb, [
      { transaction_id: t1, amount: "290.27" },
      { transaction_id: t2, amount: "290.27" },
    ]);
    unwrap(await e10.db.rpc("pay_record_payouts", { p: { settlements: [gb] } }), "pagar");
    expectRejected(await e10.db.from("pay_transactions").delete().eq("id", t1).select("id"), "23503");

    unwrap(await e10.db.from("pay_settlements").delete().eq("id", gb.id).select("id"), "borrar la liquidación");
    expect(unwrap(await e10.db.from("pay_settlement_items").select("id"), "partes")).toEqual([]);
    unwrap(await e10.db.from("pay_transactions").delete().eq("id", t1).select("id"), "borrar el cobro");
  });

  it("otro usuario no ve las partes ni puede pagar con un cobro ajeno", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    unwrap(
      await e10.db.rpc("pay_record_payouts", {
        p: { settlements: [payout(e10.ids.ga, [{ transaction_id: tx, amount: "580.53" }])] },
      }),
      "pagar",
    );
    const other = await setupE10();
    expect(unwrap(await other.db.from("pay_settlement_items").select("id"), "ajenas")).toEqual([]);
    // Con su propio beneficiario y el cobro de otro: la clave compuesta del cobro no lo encuentra.
    expectRejected(
      await other.db.rpc("pay_record_payouts", {
        p: { settlements: [payout(other.ids.ga, [{ transaction_id: tx, amount: "1.00" }])] },
      }),
      "23503",
    );
    expect(await settlementsOf(other.db)).toEqual([]);
  });
});

describe("los saldos no cambian: las partes viven dentro de las liquidaciones", () => {
  it("pagar con partes da exactamente el mismo saldo que pagar con liquidaciones de las de siempre", async () => {
    const [linked, plain] = [await setupE10(), await setupE10()];
    const paid = (e10: E10) => [
      [e10.ids.ga, "580.53"],
      [e10.ids.gb, "100.00"],
      [e10.ids.ta, "25.00"],
    ];
    const linkedTx = await chargeE10(linked);
    await chargeE10(plain);
    unwrap(
      await linked.db.rpc("pay_record_payouts", {
        p: {
          settlements: paid(linked).map(([id, amount]) => payout(id!, [{ transaction_id: linkedTx, amount: amount! }])),
        },
      }),
      "pagar con partes",
    );
    unwrap(
      await plain.db
        .from("pay_settlements")
        .insert(paid(plain).map(([id, amount]) => ({ beneficiary_id: id!, paid_on: "2026-11-14", amount: amount! })))
        .select("id"),
      "pagar a mano",
    );
    for (const key of ["ga", "gb", "ta", "tb"] as const) {
      expect(await balanceOf(linked.db, linked.ids[key])).toEqual(await balanceOf(plain.db, plain.ids[key]));
    }
    expect(await balanceOf(linked.db, linked.ids.ga)).toEqual({
      assigned: "580.53",
      settled: "580.53",
      retained: "0.00",
      balance: "0.00",
    });
    expect(await balanceOf(linked.db, linked.ids.ta)).toEqual({
      assigned: "50.00",
      settled: "25.00",
      retained: "25.00",
      balance: "0.00",
    });
  });
});

// ─── Con las operaciones de la app ──────────────────────────────────────────────────────────────────────────

/** El estado de pago de un cobro, como lo lee la app (de la base, con el motor). */
async function statusOf(db: Db, txId: string): Promise<PayoutStatus | null> {
  const [tx] = await getSnapshots(db, [txId]);
  if (tx === undefined) throw new Error("No existe el cobro");
  return (await payoutStatuses(db, [tx])).get(txId) ?? null;
}

type PartRow = [beneficiaryId: string, state: string, owed: Money];
/** Por beneficiario: en la base, el reparto no guarda orden (en pantalla va el del desglose). */
const byId = (rows: PartRow[]): PartRow[] => [...rows].sort((a, b) => a[0].localeCompare(b[0]));
/** Cada parte como [beneficiario, estado, lo que debe]. */
const partsOf = (status: PayoutStatus | null): PartRow[] | undefined =>
  status?.parts && byId(status.parts.map((part) => [part.beneficiaryId, part.state, part.owed]));
/** La parte de un beneficiario. */
const partOf = (status: PayoutStatus | null, beneficiaryId: string): PartRow | undefined =>
  partsOf(status)?.find((row) => row[0] === beneficiaryId);

/** Un pago desde la app: una liquidación de un beneficiario con lo de cada cobro. */
const pay = (beneficiaryId: string, items: [string, Money][], paidOn = "2026-11-14"): PayoutInput => ({
  id: randomUUID(),
  beneficiaryId,
  currency: "USD",
  paidOn,
  method: null,
  items: items.map(([transactionId, amount]) => ({ transactionId, amount })),
});

/** «Marcar todo el reparto pagado» de E10: a cada parte, lo que le falta. */
const payAllE10 = (e10: E10, tx: string): PayoutInput[] => [
  pay(e10.ids.ga, [[tx, "580.53"]]),
  pay(e10.ids.gb, [[tx, "290.27"]]),
  pay(e10.ids.ta, [[tx, "25.00"]]),
  pay(e10.ids.tb, [[tx, "25.00"]]),
];

/** Lo que el error le dice a la persona. */
async function failureText(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return errorMessage(error);
  }
  throw new Error("debió fallar");
}

describe("el estado de pago de cada cobro, leído de la base", () => {
  it("P1 y P2: recién registrado falta todo; «Marcar todo el reparto pagado» lo deja pagado y baja los saldos", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    expect(partsOf(await statusOf(e10.db, tx))).toEqual(
      byId([
        [e10.ids.ga, "falta", "580.53"],
        [e10.ids.gb, "falta", "290.27"],
        [e10.ids.ta, "falta", "25.00"],
        [e10.ids.tb, "falta", "25.00"],
      ]),
    );
    const before = await balanceOf(e10.db, e10.ids.ga);

    expect(await recordPayouts(e10.db, payAllE10(e10, tx))).toEqual({ created: 4 });

    const status = await statusOf(e10.db, tx);
    expect(status?.parts.every((part) => part.state === "pagado")).toBe(true);
    expect([status?.paidCount, status?.pending]).toEqual([4, false]);
    expect(before?.balance).toBe("580.53");
    expect((await balanceOf(e10.db, e10.ids.ga))?.balance).toBe("0.00");
    expect((await balanceOf(e10.db, e10.ids.ta))?.balance).toBe("0.00");
  });

  it("P4: después de P2, el reembolso total deja a cada parte con lo que se le pagó de más", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    await recordPayouts(e10.db, payAllE10(e10, tx));
    await refundTx(e10.db, tx, { amount: "1000.00", on: "2026-11-15" });
    expect(partsOf(await statusOf(e10.db, tx))).toEqual(
      byId([
        [e10.ids.ga, "de_mas", "-600.00"],
        [e10.ids.gb, "de_mas", "-300.00"],
        [e10.ids.ta, "de_mas", "-25.00"],
        [e10.ids.tb, "de_mas", "-25.00"],
      ]),
    );
  });

  it("sin reparto, fallido o en la papelera no hay estado; varios cobros se leen de una vez", async () => {
    const e10 = await setupE10();
    const [plain, failed, trashed, fresh] = [
      await chargeE10(e10, { schemeId: null }),
      await chargeE10(e10),
      await chargeE10(e10),
      await chargeE10(e10),
    ];
    await failTx(e10.db, failed);
    await trashTx(e10.db, [trashed]);
    const txs = await getSnapshots(e10.db, [plain, failed, trashed, fresh]);
    const statuses = await payoutStatuses(e10.db, txs);
    expect([plain, failed, trashed].map((id) => statuses.get(id))).toEqual([null, null, null]);
    expect(statuses.get(fresh)?.paidCount).toBe(0);
    expect((await payoutStatuses(e10.db, [])).size).toBe(0);
  });
});

describe("recordPayouts: pagar desde un cobro o desde la lista", () => {
  it("un pago parcial deja lo que falta; no se paga más de lo que falta, ni a quien no le falta nada", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    await recordPayouts(e10.db, [pay(e10.ids.ga, [[tx, "500.00"]])]);
    expect(partOf(await statusOf(e10.db, tx), e10.ids.ga)).toEqual([e10.ids.ga, "falta", "80.53"]);

    for (const tried of [
      [pay(e10.ids.ga, [[tx, "80.54"]])],
      [pay(e10.ids.ga, [[tx, "-1.00"]])],
      // Dos pagos en la misma llamada que juntos pasan de lo que falta.
      [pay(e10.ids.ga, [[tx, "50.00"]]), pay(e10.ids.ga, [[tx, "30.54"]])],
      // Grupo C no está en el reparto de E10.
      [pay(e10.basics.beneficiaryIds.c, [[tx, "1.00"]])],
    ]) {
      expect(await failureText(recordPayouts(e10.db, tried))).toBe(PAYOUT_CHANGED_TEXT);
    }
    expect(partOf(await statusOf(e10.db, tx), e10.ids.ga)).toEqual([e10.ids.ga, "falta", "80.53"]);
    await recordPayouts(e10.db, [pay(e10.ids.ga, [[tx, "80.53"]])]);
    expect(partOf(await statusOf(e10.db, tx), e10.ids.ga)).toEqual([e10.ids.ga, "pagado", "0.00"]);
  });

  it("repetir el mismo pago (la respuesta se perdió) no lo duplica; con otros datos, quedó el primero", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    const first = pay(e10.ids.gb, [[tx, "290.27"]]);
    expect(await recordPayouts(e10.db, [first])).toEqual({ created: 1 });
    expect(await recordPayouts(e10.db, [first])).toEqual({ created: 0 });
    expect(await settlementsOf(e10.db)).toHaveLength(1);
    expect(await failureText(recordPayouts(e10.db, [{ ...first, paidOn: "2026-11-15" }]))).toBe(
      PAYOUT_ALREADY_SAVED_TEXT,
    );
    expect(await settlementsOf(e10.db)).toHaveLength(1);
  });

  it("P3: dos cobros como E10, una liquidación por parte con una parte por cobro; a un fallido no", async () => {
    const e10 = await setupE10();
    const [t1, t2, failed] = [await chargeE10(e10), await chargeE10(e10), await chargeE10(e10)];
    await failTx(e10.db, failed);
    const both = (id: string, amount: Money) =>
      pay(id, [
        [t1, amount],
        [t2, amount],
      ]);
    const payouts = [
      both(e10.ids.ga, "580.53"),
      both(e10.ids.gb, "290.27"),
      both(e10.ids.ta, "25.00"),
      both(e10.ids.tb, "25.00"),
    ];
    expect(await recordPayouts(e10.db, payouts)).toEqual({ created: 4 });
    expect((await settlementsOf(e10.db)).map((s) => [s.amount, s.items.length])).toEqual([
      ["1161.06", 2],
      ["580.54", 2],
      ["50.00", 2],
      ["50.00", 2],
    ]);
    expect((await statusOf(e10.db, t2))?.pending).toBe(false);
    // Un cobro fallido no tiene nada pendiente: no se le paga a nadie.
    expect(await failureText(recordPayouts(e10.db, [pay(e10.ids.ga, [[failed, "1.00"]])]))).toBe(
      PAYOUT_CHANGED_TEXT,
    );
  });

  it("P3 en la lista: lo que se le debe a cada parte en los cobros elegidos, por moneda y por nombre", async () => {
    const e10 = await setupE10();
    const [t1, t2, refunded, eur] = [
      await chargeE10(e10),
      await chargeE10(e10),
      await chargeE10(e10),
      await chargeE10(e10, { currency: "EUR" }),
    ];
    const groups = await listOwed(e10.db, [t1, t2]);
    expect(groups.map((group) => [group.name, group.currency, group.owed, group.items.length])).toEqual([
      ["Grupo A", "USD", "1161.06", 2],
      ["Grupo B", "USD", "580.54", 2],
      ["Titular A", "USD", "50.00", 2],
      ["Titular B", "USD", "50.00", 2],
    ]);
    // Pagadas las de un cobro y reembolsado del todo después: a cada parte se le pagó de más (en EUR, aparte).
    await recordPayouts(e10.db, payAllE10(e10, refunded));
    await refundTx(e10.db, refunded, { amount: "1000.00", on: "2026-11-15" });
    const mixed = await listOwed(e10.db, [refunded, eur, randomUUID()]);
    expect(mixed.map((group) => [group.name, group.currency, group.owed])).toEqual([
      ["Grupo A", "EUR", "580.53"],
      ["Grupo B", "EUR", "290.27"],
      ["Titular A", "EUR", "25.00"],
      ["Titular B", "EUR", "25.00"],
      ["Grupo A", "USD", "-600.00"],
      ["Grupo B", "USD", "-300.00"],
      ["Titular A", "USD", "-25.00"],
      ["Titular B", "USD", "-25.00"],
    ]);
    expect(await listOwed(e10.db, [])).toEqual([]);
  });

  it("P5: lo pagado en un cobro, con los otros cobros de cada liquidación; deshacer la borra con sus partes", async () => {
    const e10 = await setupE10();
    const [t1, t2] = [await chargeE10(e10), await chargeE10(e10)];
    const gb = pay(e10.ids.gb, [
      [t1, "290.27"],
      [t2, "290.27"],
    ]);
    const ta = pay(e10.ids.ta, [[t1, "10.00"]]);
    await recordPayouts(e10.db, [gb, ta]);

    const payouts = await listTxPayouts(e10.db, t1);
    expect(payouts.map((p) => [p.settlementId, p.beneficiaryId, p.amount, p.here, p.others.length])).toEqual(
      expect.arrayContaining([
        [gb.id, e10.ids.gb, "580.54", "290.27", 1],
        [ta.id, e10.ids.ta, "10.00", "10.00", 0],
      ]),
    );
    expect(payouts).toHaveLength(2);
    const [reference] = (await getSnapshots(e10.db, [t2])).map((tx) => tx.reference);
    expect(payouts.find((p) => p.settlementId === gb.id)).toMatchObject({
      paidOn: "2026-11-14",
      currency: "USD",
      others: [{ transactionId: t2, amount: "290.27", occurredOn: "2026-11-10", grossOriginal: "1000.00", reference }],
    });

    // Deshacer: borrar la liquidación de Grupo B desmarca los dos cobros.
    await deleteSettlement(e10.db, e10.user.id, gb.id);
    expect(partOf(await statusOf(e10.db, t1), e10.ids.gb)).toEqual([e10.ids.gb, "falta", "290.27"]);
    expect(partOf(await statusOf(e10.db, t2), e10.ids.gb)).toEqual([e10.ids.gb, "falta", "290.27"]);
    expect((await listTxPayouts(e10.db, t1)).map((p) => p.settlementId)).toEqual([ta.id]);
  });

  it("la ficha del beneficiario lee de qué cobros es cada liquidación; las de siempre, sin cobros", async () => {
    const e10 = await setupE10();
    const [t1, t2] = [await chargeE10(e10), await chargeE10(e10)];
    await recordPayouts(e10.db, [
      pay(e10.ids.gb, [
        [t1, "290.27"],
        [t2, "290.27"],
      ]),
    ]);
    unwrap(
      await e10.db
        .from("pay_settlements")
        .insert({ beneficiary_id: e10.ids.gb, paid_on: "2026-11-01", amount: "5.00" })
        .select("id"),
      "a mano",
    );
    const page = await listSettlements(e10.db, e10.ids.gb, 1);
    expect(page.total).toBe(2);
    expect(page.rows.map((row) => [row.amount, row.items.map((item) => [item.transactionId, item.amount])])).toEqual([
      [
        "580.54",
        expect.arrayContaining([
          [t1, "290.27"],
          [t2, "290.27"],
        ]),
      ],
      ["5.00", []],
    ]);
    expect(page.rows[0]?.items[0]).toMatchObject({
      occurredOn: "2026-11-10",
      grossOriginal: "1000.00",
      currency: "USD",
    });
  });
});

describe("borrar del todo un cobro con partes pagadas", () => {
  it("no se puede, y lo dice; deshechos los pagos, sí", async () => {
    const e10 = await setupE10();
    const tx = await chargeE10(e10);
    const ga = pay(e10.ids.ga, [[tx, "580.53"]]);
    await recordPayouts(e10.db, [ga]);
    await trashTx(e10.db, [tx]);
    expect(await failureText(purgeTx(e10.db, e10.user.id, [tx]))).toBe(
      "No se puede borrar del todo un cobro con partes del reparto ya pagadas. Deshaz esos pagos (en el detalle " +
        "del cobro o en la ficha de cada beneficiario) y vuelve a intentarlo.",
    );
    expect(await getSnapshots(e10.db, [tx])).toHaveLength(1);

    await deleteSettlement(e10.db, e10.user.id, ga.id);
    expect(await purgeTx(e10.db, e10.user.id, [tx])).toBe(1);
  });
});

describe("el filtro «Reparto pendiente»", () => {
  it("trae los cobros con alguna parte a la que le falta algo o se le pagó de más, con páginas y totales", async () => {
    const e10 = await setupE10();
    const fresh = await chargeE10(e10);
    const paid = await chargeE10(e10);
    const refunded = await chargeE10(e10);
    const partial = await chargeE10(e10);
    const failed = await chargeE10(e10);
    const unshared = await chargeE10(e10, { schemeId: null });
    const trashed = await chargeE10(e10);
    await recordPayouts(e10.db, [...payAllE10(e10, paid), ...payAllE10(e10, refunded)]);
    await refundTx(e10.db, refunded, { amount: "1000.00", on: "2026-11-15" });
    await recordPayouts(e10.db, [pay(e10.ids.ga, [[partial, "580.53"]])]);
    await failTx(e10.db, failed);
    await trashTx(e10.db, [trashed]);

    const today = "2026-11-16";
    const { filters, sort } = parseTxFilters(
      { periodo: "personalizado", desde: "2026-11-01", hasta: "2026-11-30", reparto: "pendiente" },
      today,
    );
    expect(filters.payout).toBe("pendiente");
    const list = await listTx(e10.db, filters, sort, 1, today);
    const expected = [fresh, refunded, partial].sort();
    expect(list.rows.map((row) => row.id).sort()).toEqual(expected);
    expect(list.total).toBe(3);
    expect((await leanTx(e10.db, filters, today)).map((row) => row.id).sort()).toEqual(expected);
    // Una página de 2: el total sigue siendo el del filtro.
    expect((await listTx(e10.db, filters, sort, 2, today, 2)).rows).toHaveLength(1);

    // Sin el filtro están todos (menos la papelera); la base y el motor dicen lo mismo de cada uno.
    const all = await listTx(e10.db, { ...filters, payout: undefined }, sort, 1, today);
    expect(all.total).toBe(6);
    const statuses = await payoutStatuses(e10.db, all.rows);
    const pending = all.rows.filter((row) => statuses.get(row.id)?.pending === true).map((row) => row.id);
    expect(pending.sort()).toEqual(expected);
    expect([paid, unshared, failed].map((id) => statuses.get(id)?.pending ?? false)).toEqual([false, false, false]);
    // «reparto» con otro valor no es un filtro.
    expect(parseTxFilters({ reparto: "otro" }, today).filters.payout).toBeUndefined();
  });
});
