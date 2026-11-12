import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ZERO, add, compute, type NewTxInput, type State } from "@/lib/pasarelas";
import type { Json } from "@/lib/supabase/types";
import { createTx, disputeTx, editTx, refundTx } from "@/server/pasarelas/ops/transactions";
import { getCompany } from "@/server/pasarelas/queries/companies";
import { listGatewayTotals } from "@/server/pasarelas/queries/gateways";
import { getSnapshots } from "@/server/pasarelas/queries/transactions";
import {
  basicsRules,
  createUser,
  e1Item,
  expectRejected,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type Db,
  type SaveItem,
} from "./helpers";

/**
 * ¿Quién paga la comisión? en la base (migración 20261113120000). Cada cobro dice si la pagó el negocio
 * («nosotros», lo de siempre) o el comprador, al que se le cobró de más para cubrirla. Lo de antes sigue entrando
 * igual: un cobro guardado sin decirlo queda en «nosotros». Con «comprador», lo que el comprador pagó de más no es
 * venta del negocio: el reparto va sobre el neto, y en los totales esa comisión sale aparte.
 *
 * Lo que pagaron los compradores de cada cobro se guarda en `buyer_fees`: las comisiones que se cobran sobre lo que el
 * comprador sigue pagando (pasarela, opciones y plataforma). El costo del reembolso y el de la disputa son del
 * negocio. Con «nosotros», 0.
 */

let client: Db;
let b: Basics;

beforeAll(async () => {
  client = (await createUser()).client;
  b = await seedBasics(client);
});

/** El cobro E1 con su reparto «Sobre el bruto» (50/30/20 de 100,00), con quien se diga que pagó la comisión. */
function e1OnGross(columns: Record<string, string> = {}): SaveItem {
  const item = e1Item(b, { alloc_base: "bruto", alloc_base_amount: "100.00", ...columns });
  return {
    ...item,
    allocations: [
      { beneficiary_id: b.beneficiaryIds.a, amount: "50.00", base: "bruto", pct: "50", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.b, amount: "30.00", base: "bruto", pct: "30", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.c, amount: "20.00", base: "bruto", pct: "20", is_remainder: false },
    ],
  };
}

/** El desglose de E1 con la comisión a cargo del comprador (y lo que cambie `patch`), como lo congela el motor. */
function e1BuyerBreakdown(basics: Basics, patch: Partial<State> = {}): Json {
  const state: State = {
    grossOriginal: "100.00",
    refunded: "0.00",
    dispute: null,
    failed: false,
    feesPaidBy: "comprador",
    ...patch,
  };
  return compute(basicsRules(basics), state, "USD") as unknown as Json;
}

/**
 * El cobro E1 con la comisión a cargo del comprador, coherente: la columna y el desglose congelado dicen
 * «comprador», y `buyer_fees` son sus 9,70 (pasarela, opción y plataforma). El reparto es el de E1, sobre el neto.
 */
function e1ByBuyer(basics: Basics, columns: Record<string, Json> = {}): SaveItem {
  return e1Item(basics, {
    fees_paid_by: "comprador",
    buyer_fees: "9.70",
    breakdown: e1BuyerBreakdown(basics),
    ...columns,
  });
}

/** Manda ese cobro a la papelera (el alta de `pay_save_transactions` no la escribe). */
async function trash(db: Db, id: string): Promise<void> {
  unwrap(
    await db.from("pay_transactions").update({ deleted_at: "2026-11-13T16:00:00+00:00" }).eq("id", id).select("id"),
    "papelera",
  );
}

async function feesPaidByOf(db: Db, id: string): Promise<string> {
  const row = unwrap(await db.from("pay_transactions").select("fees_paid_by").eq("id", id).single(), "cobro");
  return row.fees_paid_by;
}

/** Quién pagó, lo que pagaron los compradores y las comisiones de un cobro, con el dinero como texto exacto. */
async function feesOf(db: Db, id: string) {
  return unwrap(
    await db
      .from("pay_transactions")
      .select("fees_paid_by, buyer_fees::text, fees_total::text, net_amount::text")
      .eq("id", id)
      .single(),
    "cobro",
  );
}

describe("pay_transactions.fees_paid_by", () => {
  it("nace en «nosotros»: un cobro guardado sin decir quién pagó la comisión queda como los de antes", async () => {
    const [saved] = await saveTransactions(client, [e1Item(b)]);
    expect(await feesPaidByOf(client, saved!.id)).toBe("nosotros");
  });

  it("solo admite «nosotros» o «comprador»", async () => {
    const [saved] = await saveTransactions(client, [e1Item(b)]);
    expectRejected(
      await client.from("pay_transactions").update({ fees_paid_by: "cliente" }).eq("id", saved!.id).select("id"),
      "23514",
      "pay_transactions_fees_paid_by_check",
    );
  });

  it("con «comprador» el reparto no puede ir sobre el bruto: lo que pagó de más no es venta del negocio", async () => {
    const res = await client.rpc("pay_save_transactions", {
      p_items: [e1OnGross({ fees_paid_by: "comprador" })],
    });
    expectRejected(res, "23514", "pay_transactions_fees_paid_by_alloc_check");
    // Con «nosotros», el mismo reparto sobre el bruto entra (es lo de siempre).
    const [saved] = await saveTransactions(client, [e1OnGross()]);
    expect(await feesPaidByOf(client, saved!.id)).toBe("nosotros");
  });
});

describe("pay_transactions.buyer_fees", () => {
  it("nace en 0: un cobro guardado sin decirlo, como los de antes, no tiene comisiones de compradores", async () => {
    const [saved] = await saveTransactions(client, [e1Item(b)]);
    expect(await feesOf(client, saved!.id)).toEqual({
      fees_paid_by: "nosotros",
      buyer_fees: "0.00",
      fees_total: "9.70",
      net_amount: "90.30",
    });
    // Un alta de «comprador» que no la dice también queda en 0 (como `fees_paid_by` sin decirlo).
    const [bare] = await saveTransactions(client, [e1Item(b, { fees_paid_by: "comprador" })]);
    expect((await feesOf(client, bare!.id)).buyer_fees).toBe("0.00");
  });

  it("el check rechaza comisiones de compradores en un cobro de «nosotros», y negativas en cualquiera", async () => {
    expectRejected(
      await client.rpc("pay_save_transactions", { p_items: [e1Item(b, { buyer_fees: "9.70" })] }),
      "23514",
      "pay_transactions_buyer_fees_check",
    );
    const [own, byBuyer] = await saveTransactions(client, [e1Item(b), e1ByBuyer(b)]);
    expectRejected(
      await client.from("pay_transactions").update({ buyer_fees: "0.01" }).eq("id", own!.id).select("id"),
      "23514",
      "pay_transactions_buyer_fees_check",
    );
    expectRejected(
      await client.from("pay_transactions").update({ buyer_fees: "-0.01" }).eq("id", byBuyer!.id).select("id"),
      "23514",
      "pay_transactions_buyer_fees_check",
    );
    // Pasar a «nosotros» sin quitarle lo de los compradores tampoco entra.
    expectRejected(
      await client.from("pay_transactions").update({ fees_paid_by: "nosotros" }).eq("id", byBuyer!.id).select("id"),
      "23514",
      "pay_transactions_buyer_fees_check",
    );
  });
});

describe("pay_save_transactions con «comprador»", () => {
  it("guarda quién pagó y lo de los compradores al registrar y al cambiarlo; lo que no se dice no se toca", async () => {
    const [saved] = await saveTransactions(client, [e1ByBuyer(b)]);
    const id = saved!.id;
    const row = unwrap(
      await client
        .from("pay_transactions")
        .select("fees_paid_by, buyer_fees::text, alloc_base, alloc_base_amount::text, net_amount::text")
        .eq("id", id)
        .single(),
      "cobro",
    );
    expect(row).toEqual({
      fees_paid_by: "comprador",
      buyer_fees: "9.70",
      alloc_base: "neto",
      alloc_base_amount: "90.30",
      net_amount: "90.30",
    });

    await saveTransactions(client, [
      { mode: "update", tx: { id, note: "Sin tocar quién pagó" }, event: { kind: "editado", summary: "Nota", data: null } },
    ]);
    expect(await feesOf(client, id)).toMatchObject({ fees_paid_by: "comprador", buyer_fees: "9.70" });

    await saveTransactions(client, [
      {
        mode: "update",
        tx: { id, fees_paid_by: "nosotros", buyer_fees: "0.00" },
        event: { kind: "editado", summary: "Quién", data: null },
      },
    ]);
    expect(await feesOf(client, id)).toMatchObject({ fees_paid_by: "nosotros", buyer_fees: "0.00" });
  });
});

describe("registrar con «comprador» (el motor y la base juntos)", () => {
  it("E7: 1040 con un esquema «Sobre el bruto» se guarda con el reparto sobre el neto, 1009,54", async () => {
    const own = await createUser();
    const basics = await seedBasics(own.client);
    const scheme = unwrap(
      await own.client.rpc("pay_save_scheme", {
        p: {
          name: "Reparto sobre el bruto",
          base: "bruto",
          lines: [
            { beneficiary_id: basics.beneficiaryIds.a, pct: "50" },
            { beneficiary_id: basics.beneficiaryIds.b, pct: "30" },
            { beneficiary_id: basics.beneficiaryIds.c, pct: "20" },
          ],
        },
      }),
      "esquema",
    ) as { scheme_id: string };
    const id = randomUUID();
    const input: NewTxInput = {
      id,
      companyId: basics.companyId,
      channelId: null,
      gatewayId: basics.gatewayId,
      extraIds: [],
      schemeId: scheme.scheme_id,
      occurredAt: "2026-11-13T15:00:00Z",
      occurredOn: "2026-11-13",
      currency: "USD",
      grossOriginal: "1040.00",
      reference: null,
      note: null,
      feesPaidBy: "comprador",
    };
    await createTx(own.client, input);
    const row = unwrap(
      await own.client
        .from("pay_transactions")
        .select(
          "fees_paid_by, buyer_fees::text, fees_total::text, net_amount::text, alloc_base, alloc_base_amount::text, breakdown",
        )
        .eq("id", id)
        .single(),
      "cobro",
    );
    expect(row).toMatchObject({
      fees_paid_by: "comprador",
      buyer_fees: "30.46",
      fees_total: "30.46",
      net_amount: "1009.54",
      alloc_base: "neto",
      alloc_base_amount: "1009.54",
    });
    expect((row.breakdown as { state: { feesPaidBy: string } }).state.feesPaidBy).toBe("comprador");
    const shares = unwrap(
      await own.client.from("pay_allocations").select("amount::text, base").eq("transaction_id", id).order("amount"),
      "reparto",
    );
    expect(shares).toEqual([
      { amount: "201.91", base: "neto" },
      { amount: "302.86", base: "neto" },
      { amount: "504.77", base: "neto" },
    ]);

    // Al leerlo, el cobro dice quién pagó; editar a «nosotros» lo vuelve a repartir sobre el bruto.
    const [saved] = await getSnapshots(own.client, [id]);
    expect(saved).toMatchObject({ feesPaidBy: "comprador", buyerFees: "30.46" });
    await editTx(own.client, id, { feesPaidBy: "nosotros" });
    const [edited] = await getSnapshots(own.client, [id]);
    expect(edited).toMatchObject({ feesPaidBy: "nosotros", buyerFees: "0.00", fees: "30.46", net: "1009.54" });
    expect(edited?.breakdown.alloc).toMatchObject({ baseKind: "bruto", baseAmount: "1040.00" });
  });
});

describe("reembolsos y disputas sobre un cobro «comprador» (E8)", () => {
  it("los compradores pagan la comisión de lo que siguen pagando; el reembolso y la disputa los paga el negocio", async () => {
    const own = await createUser();
    const basics = await seedBasics(own.client);
    // La Stripe de prueba no devuelve la comisión al reembolsar; con un costo de disputa de 15,00.
    unwrap(
      await own.client.from("pay_gateways").update({ dispute_fee: "15.00" }).eq("id", basics.gatewayId).select("id"),
      "pasarela",
    );
    const register = async (): Promise<string> => {
      const id = randomUUID();
      await createTx(own.client, {
        id,
        companyId: basics.companyId,
        channelId: null,
        gatewayId: basics.gatewayId,
        extraIds: [],
        schemeId: basics.schemeId,
        occurredAt: "2026-11-13T15:00:00Z",
        occurredOn: "2026-11-13",
        currency: "USD",
        grossOriginal: "1040.00",
        reference: null,
        note: null,
        feesPaidBy: "comprador",
      });
      return id;
    };
    const partial = await register();
    const total = await register();
    expect(await feesOf(own.client, partial)).toEqual({
      fees_paid_by: "comprador",
      buyer_fees: "30.46",
      fees_total: "30.46",
      net_amount: "1009.54",
    });

    // E8b: reembolso parcial de 520. El comprador pagó la comisión de lo que sigue pagando (15,38); lo que la
    // pasarela se quedó de lo reembolsado (15,08) es del negocio.
    await refundTx(own.client, partial, { amount: "520.00", on: "2026-11-14" });
    expect(await feesOf(own.client, partial)).toMatchObject({
      buyer_fees: "15.38",
      fees_total: "30.46",
      net_amount: "489.54",
    });
    // Con la disputa abierta, su costo (15,00) también es del negocio.
    await disputeTx(own.client, partial, { action: "abrir", on: "2026-11-15" });
    expect(await feesOf(own.client, partial)).toMatchObject({
      buyer_fees: "15.38",
      fees_total: "45.46",
      net_amount: "474.54",
    });
    // Perdida: el reembolso es total y el comprador no pagó nada; todo lo que cobró la pasarela, del negocio.
    await disputeTx(own.client, partial, { action: "perder", on: "2026-11-20" });
    expect(await feesOf(own.client, partial)).toMatchObject({
      buyer_fees: "0.00",
      fees_total: "45.46",
      net_amount: "-45.46",
    });

    // E8a: reembolso total. El comprador recuperó todo; los 30,46 que se quedó la pasarela los perdió el negocio.
    await refundTx(own.client, total, { amount: "1040.00", on: "2026-11-14" });
    expect(await feesOf(own.client, total)).toMatchObject({
      buyer_fees: "0.00",
      fees_total: "30.46",
      net_amount: "-30.46",
    });
    const [snapshot] = await getSnapshots(own.client, [total]);
    expect(snapshot).toMatchObject({ feesPaidBy: "comprador", buyerFees: "0.00", fees: "30.46", net: "-30.46" });
  });
});

/** Las filas de una vista de totales de un usuario, con el dinero como texto exacto. */
async function companyTotals(db: Db) {
  return unwrap(
    await db
      .from("pay_company_totals")
      .select("company_id, currency, tx_count, gross::text, fees::text, net::text, buyer_fees::text"),
    "pay_company_totals",
  );
}

async function gatewayTotals(db: Db) {
  return unwrap(
    await db
      .from("pay_gateway_totals")
      .select("gateway_id, currency, tx_count, gross::text, fees::text, net::text, buyer_fees::text"),
    "pay_gateway_totals",
  );
}

describe("las vistas de totales", () => {
  it("con una mezcla: bruto, comisiones y neto son las sumas de siempre; `buyer_fees`, la suma de la columna", async () => {
    const own = await createUser();
    const basics = await seedBasics(own.client);
    // E1 pagando nosotros (bruto 100,00, comisiones 9,70, neto 90,30) y E1 pagando el comprador (las mismas cifras;
    // sus 9,70 de comisiones los pagó el comprador). Más uno fallido y uno en la papelera, que no cuentan.
    const failed = e1ByBuyer(basics, {
      status: "fallido",
      gross_amount: "0.00",
      fees_total: "0.00",
      net_amount: "0.00",
      alloc_base_amount: "0.00",
      buyer_fees: "0.00",
      breakdown: e1BuyerBreakdown(basics, { failed: true }),
    });
    const saved = await saveTransactions(own.client, [
      e1Item(basics),
      e1ByBuyer(basics),
      // El fallido no reparte nada: sus repartos suman cero.
      { ...failed, allocations: failed.allocations!.map((line) => ({ ...line, amount: "0.00" })) },
      e1ByBuyer(basics),
    ]);
    await trash(own.client, saved[3]!.id);
    const expected = { currency: "USD", tx_count: 2, gross: "200.00", fees: "19.40", net: "180.60", buyer_fees: "9.70" };
    expect(await companyTotals(own.client)).toEqual([{ company_id: basics.companyId, ...expected }]);
    expect(await gatewayTotals(own.client)).toEqual([{ gateway_id: basics.gatewayId, ...expected }]);

    // Lo que leen las pantallas: `gross` es todo lo cobrado y `sale`, lo facturado (sin lo que pagaron los
    // compradores); `fees`, las comisiones del negocio.
    const figures = { gross: "200.00", sale: "190.30", fees: "9.70", buyerFees: "9.70", net: "180.60" };
    expect((await getCompany(own.client, basics.companyId))?.totals).toEqual([
      { currency: "USD", count: 2, ...figures, firstOn: "2026-11-13", lastOn: "2026-11-13" },
    ]);
    expect(await listGatewayTotals(own.client)).toMatchObject([
      { gatewayId: basics.gatewayId, currency: "USD", txCount: 2, ...figures },
    ]);
  });

  it("un libro sin «comprador» da los mismos totales que antes: la suma de bruto, comisiones y neto de sus cobros", async () => {
    const own = await createUser();
    const basics = await seedBasics(own.client);
    const saved = await saveTransactions(own.client, [
      e1Item(basics),
      e1Item(basics, { status: "depositado", deposited_on: "2026-11-16" }),
      e1Item(basics, { currency: "EUR" }),
      e1Item(basics),
    ]);
    await trash(own.client, saved[3]!.id);
    // La definición de antes: la suma de las columnas de los cobros que cuentan (sin papelera ni fallidos).
    const rows = unwrap(
      await own.client
        .from("pay_transactions")
        .select("currency, gross_amount::text, fees_total::text, net_amount::text")
        .is("deleted_at", null)
        .neq("status", "fallido"),
      "cobros",
    );
    const before = (currency: string) => {
      const mine = rows.filter((row) => row.currency === currency);
      return {
        currency,
        tx_count: mine.length,
        gross: add(ZERO, ...mine.map((row) => row.gross_amount)),
        fees: add(ZERO, ...mine.map((row) => row.fees_total)),
        net: add(ZERO, ...mine.map((row) => row.net_amount)),
        buyer_fees: ZERO,
      };
    };
    const byCurrency = (a: { currency: string | null }, z: { currency: string | null }) =>
      (a.currency ?? "").localeCompare(z.currency ?? "");
    expect((await companyTotals(own.client)).sort(byCurrency)).toEqual(
      ["EUR", "USD"].map((currency) => ({ company_id: basics.companyId, ...before(currency) })),
    );
    expect((await gatewayTotals(own.client)).sort(byCurrency)).toEqual(
      ["EUR", "USD"].map((currency) => ({ gateway_id: basics.gatewayId, ...before(currency) })),
    );
    expect(before("USD")).toMatchObject({ gross: "200.00", fees: "19.40", net: "180.60" });
    // En las pantallas, lo facturado es el bruto y las comisiones del negocio son todas: lo de siempre.
    const usd = { gross: "200.00", sale: "200.00", fees: "19.40", buyerFees: "0.00", net: "180.60" };
    expect((await getCompany(own.client, basics.companyId))?.totals).toMatchObject([{ currency: "EUR" }, usd]);
    expect((await listGatewayTotals(own.client)).find((row) => row.currency === "USD")).toMatchObject(usd);
  });
});
