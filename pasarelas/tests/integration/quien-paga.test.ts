import { beforeAll, describe, expect, it } from "vitest";
import { ZERO, add } from "@/lib/pasarelas";
import {
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

describe("pay_save_transactions con «comprador»", () => {
  it("guarda quién pagó al registrar y al cambiarlo; una actualización que no lo dice no lo toca", async () => {
    const [saved] = await saveTransactions(client, [e1Item(b, { fees_paid_by: "comprador" })]);
    const id = saved!.id;
    const row = unwrap(
      await client
        .from("pay_transactions")
        .select("fees_paid_by, alloc_base, alloc_base_amount::text, net_amount::text")
        .eq("id", id)
        .single(),
      "cobro",
    );
    expect(row).toEqual({
      fees_paid_by: "comprador",
      alloc_base: "neto",
      alloc_base_amount: "90.30",
      net_amount: "90.30",
    });

    await saveTransactions(client, [
      { mode: "update", tx: { id, note: "Sin tocar quién pagó" }, event: { kind: "editado", summary: "Nota", data: null } },
    ]);
    expect(await feesPaidByOf(client, id)).toBe("comprador");

    await saveTransactions(client, [
      { mode: "update", tx: { id, fees_paid_by: "nosotros" }, event: { kind: "editado", summary: "Quién", data: null } },
    ]);
    expect(await feesPaidByOf(client, id)).toBe("nosotros");
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
  it("con una mezcla, lo facturado es la venta del negocio y las comisiones son las suyas; las de los compradores, aparte", async () => {
    const own = await createUser();
    const basics = await seedBasics(own.client);
    // E1 pagando nosotros (bruto 100,00, comisiones 9,70, neto 90,30) y E1 pagando el comprador: su venta es el
    // neto (90,30), sus comisiones las pagó el comprador (9,70). Más uno fallido y uno en la papelera, que no cuentan.
    const failed = e1Item(basics, {
      fees_paid_by: "comprador",
      status: "fallido",
      gross_amount: "0.00",
      fees_total: "0.00",
      net_amount: "0.00",
      alloc_base_amount: "0.00",
    });
    const saved = await saveTransactions(own.client, [
      e1Item(basics),
      e1Item(basics, { fees_paid_by: "comprador" }),
      // El fallido no reparte nada: sus repartos suman cero.
      { ...failed, allocations: failed.allocations!.map((line) => ({ ...line, amount: "0.00" })) },
      e1Item(basics, { fees_paid_by: "comprador" }),
    ]);
    await trash(own.client, saved[3]!.id);
    const expected = { currency: "USD", tx_count: 2, gross: "190.30", fees: "9.70", net: "180.60", buyer_fees: "9.70" };
    expect(await companyTotals(own.client)).toEqual([{ company_id: basics.companyId, ...expected }]);
    expect(await gatewayTotals(own.client)).toEqual([{ gateway_id: basics.gatewayId, ...expected }]);
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
  });
});
