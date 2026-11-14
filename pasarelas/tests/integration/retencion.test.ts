import type { SupabaseClient } from "@supabase/supabase-js";
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
  type SaveItem,
} from "./helpers";

/**
 * La retención de la pasarela, en la base (migración 20261115120000). La pasarela retiene un porcentaje de cada cobro
 * durante unos días y lo retenido le cae a ciertas personas: es parte del neto que la pasarela les paga directo. Las
 * columnas nuevas nacen en 0 (todo da lo de antes), lo retenido de un cobro suma exactamente sus partes, y el saldo de
 * cada beneficiario descuenta lo que ya recibió de lo retenido.
 */

let client: Db;
let b: Basics;
/** Una persona que no está en el reparto 50/30/20 de `seedBasics`. */
let titularId: string;

beforeAll(async () => {
  client = (await createUser()).client;
  b = await seedBasics(client);
  titularId = unwrap(
    await client.from("pay_beneficiaries").insert({ name: "Titular A" }).select("id").single(),
    "titular",
  ).id;
});

/** Las columnas de la retención de una pasarela y sus personas, en su orden. */
async function retentionOf(db: Db, gatewayId: string) {
  const [gateway, recipients] = await Promise.all([
    db.from("pay_gateways").select("retention_pct::text, retention_days").eq("id", gatewayId).single(),
    db
      .from("pay_gateway_retention_recipients")
      .select("beneficiary_id, pct::text")
      .eq("gateway_id", gatewayId)
      .order("sort"),
  ]);
  return { ...unwrap(gateway, "pasarela"), recipients: unwrap(recipients, "personas") };
}

/** Una pasarela nueva sin retención (las columnas en su valor por defecto). */
async function newGateway(db: Db, name: string): Promise<string> {
  return unwrap(await db.rpc("pay_create_gateway", { p: { name, fee: { pct: "2.9", fixed: "0.20" } } }), "pasarela");
}

/** E1 con 5,00 retenido: lo que diga `shares` (por defecto, 2,50 a A y 2,50 al titular). */
function e1Retained(shares: { beneficiary_id: string; amount: string }[] | null, tx: SaveItem["tx"] = {}) {
  return { ...e1Item(b, { retention_amount: "5.00", ...tx }), retention_shares: shares };
}

describe("las columnas nuevas nacen en 0", () => {
  it("una pasarela no retiene y no tiene personas", async () => {
    expect(await retentionOf(client, b.gatewayId)).toEqual({
      retention_pct: "0.0000",
      retention_days: 0,
      recipients: [],
    });
  });

  it("un cobro guardado sin decirlo no tiene retenido ni partes", async () => {
    const [saved] = await saveTransactions(client, [e1Item(b)]);
    const tx = unwrap(
      await client.from("pay_transactions").select("retention_amount::text").eq("id", saved!.id).single(),
      "cobro",
    );
    expect(tx).toEqual({ retention_amount: "0.00" });
    const shares = unwrap(
      await client.from("pay_retention_shares").select("id").eq("transaction_id", saved!.id),
      "partes",
    );
    expect(shares).toEqual([]);
  });
});

describe("las restricciones", () => {
  it("el % de la pasarela va de 0 a 100 y los días de 0 a 365", async () => {
    expectRejected(
      await client.from("pay_gateways").update({ retention_pct: "100.0001" }).eq("id", b.gatewayId).select("id"),
      "23514",
      "pay_gateways_retention_pct_check",
    );
    expectRejected(
      await client.from("pay_gateways").update({ retention_days: 366 }).eq("id", b.gatewayId).select("id"),
      "23514",
      "pay_gateways_retention_days_check",
    );
    expectRejected(
      await client.from("pay_gateways").update({ retention_days: -1 }).eq("id", b.gatewayId).select("id"),
      "23514",
      "pay_gateways_retention_days_check",
    );
  });

  it("lo retenido de un cobro no es negativo ni pasa del bruto vigente", async () => {
    expectRejected(
      await client.rpc("pay_save_transactions", {
        p_items: [{ ...e1Item(b, { retention_amount: "-0.01" }), retention_shares: [] }],
      }),
      "23514",
      "pay_transactions_retention_amount_check",
    );
    expectRejected(
      await client.rpc("pay_save_transactions", {
        p_items: [
          {
            ...e1Item(b, { retention_amount: "100.01" }),
            retention_shares: [{ beneficiary_id: titularId, amount: "100.01" }],
          },
        ],
      }),
      "23514",
      "pay_transactions_retention_amount_check",
    );
  });

  it("un fallido tiene el bruto vigente en 0: su retenido también", async () => {
    const failed = (retention: string) => ({
      ...e1Item(b, {
        status: "fallido",
        gross_amount: "0.00",
        fees_total: "0.00",
        net_amount: "0.00",
        alloc_base_amount: "0.00",
        retention_amount: retention,
      }),
      allocations: [
        { beneficiary_id: b.beneficiaryIds.a, amount: "0.00", base: "neto", pct: "50", is_remainder: false },
        { beneficiary_id: b.beneficiaryIds.b, amount: "0.00", base: "neto", pct: "30", is_remainder: false },
        { beneficiary_id: b.beneficiaryIds.c, amount: "0.00", base: "neto", pct: "20", is_remainder: false },
      ],
      retention_shares: [{ beneficiary_id: titularId, amount: retention }],
    });
    expectRejected(
      await client.rpc("pay_save_transactions", { p_items: [failed("0.01")] }),
      "23514",
      "pay_transactions_retention_amount_check",
    );
    const [saved] = await saveTransactions(client, [failed("0.00")]);
    expect(saved?.inserted).toBe(true);
  });

  it("cada parte es de 0 o más", async () => {
    expectRejected(
      await client.rpc("pay_save_transactions", {
        p_items: [
          e1Retained([
            { beneficiary_id: b.beneficiaryIds.a, amount: "5.01" },
            { beneficiary_id: titularId, amount: "-0.01" },
          ]),
        ],
      }),
      "23514",
      "pay_retention_shares_amount_check",
    );
  });
});

describe("pay_save_gateway_retention", () => {
  it("fija el %, los días y las personas; al volver a guardar, las reemplaza", async () => {
    const gatewayId = await newGateway(client, "OTF Demo");
    const saved = await client.rpc("pay_save_gateway_retention", {
      p: {
        gateway_id: gatewayId,
        pct: "5",
        days: 30,
        recipients: [
          { beneficiary_id: titularId, pct: "50" },
          { beneficiary_id: b.beneficiaryIds.a, pct: "50" },
        ],
      },
    });
    expect(saved.error).toBeNull();
    expect(await retentionOf(client, gatewayId)).toEqual({
      retention_pct: "5.0000",
      retention_days: 30,
      recipients: [
        { beneficiary_id: titularId, pct: "50.0000" },
        { beneficiary_id: b.beneficiaryIds.a, pct: "50.0000" },
      ],
    });

    await client.rpc("pay_save_gateway_retention", {
      p: {
        gateway_id: gatewayId,
        pct: "2.5",
        days: 7,
        recipients: [{ beneficiary_id: b.beneficiaryIds.b, pct: "100" }],
      },
    });
    expect(await retentionOf(client, gatewayId)).toEqual({
      retention_pct: "2.5000",
      retention_days: 7,
      recipients: [{ beneficiary_id: b.beneficiaryIds.b, pct: "100.0000" }],
    });

    // Con 0 % deja de retener y no queda nadie.
    await client.rpc("pay_save_gateway_retention", { p: { gateway_id: gatewayId, pct: "0", days: 0, recipients: [] } });
    expect(await retentionOf(client, gatewayId)).toEqual({
      retention_pct: "0.0000",
      retention_days: 0,
      recipients: [],
    });
  });

  it("valida las reglas y, si no se cumplen, no cambia nada", async () => {
    const gatewayId = await newGateway(client, "OTF Demo (reglas)");
    const save = (p: Record<string, unknown>) =>
      client.rpc("pay_save_gateway_retention", { p: { gateway_id: gatewayId, days: 30, ...p } } as never);
    const half = (id: string) => ({ beneficiary_id: id, pct: "50" });

    expectRejected(await save({ pct: "5", recipients: [] }), "23514", "pay_retention_without_recipients");
    expectRejected(
      await save({ pct: "0", recipients: [{ beneficiary_id: titularId, pct: "100" }] }),
      "23514",
      "pay_retention_recipients_without_pct",
    );
    expectRejected(
      await save({ pct: "5", recipients: [half(titularId), { beneficiary_id: b.beneficiaryIds.a, pct: "49.9999" }] }),
      "23514",
      "pay_retention_not_100",
    );
    expectRejected(
      await save({ pct: "5", recipients: [half(titularId), half(titularId)] }),
      "23505",
      "pay_gateway_retention_recipients_uq",
    );
    expectRejected(
      await save({
        pct: "5",
        recipients: [
          { beneficiary_id: titularId, pct: "0" },
          { beneficiary_id: b.beneficiaryIds.a, pct: "100" },
        ],
      }),
      "23514",
      "pay_gateway_retention_recipients_pct_check",
    );
    expectRejected(
      await save({ pct: "100.5", recipients: [{ beneficiary_id: titularId, pct: "100" }] }),
      "23514",
      "pay_gateways_retention_pct_check",
    );
    expectRejected(
      await save({ pct: "5", days: 400, recipients: [{ beneficiary_id: titularId, pct: "100" }] }),
      "23514",
      "pay_gateways_retention_days_check",
    );

    // Un beneficiario inactivo no recibe.
    const inactive = unwrap(
      await client.from("pay_beneficiaries").insert({ name: "Titular inactivo", active: false }).select("id").single(),
      "inactivo",
    ).id;
    expectRejected(
      await save({ pct: "5", recipients: [{ beneficiary_id: inactive, pct: "100" }] }),
      "23514",
      "pay_retention_inactive_beneficiary",
    );

    // Uno de otro usuario no se ve: cuenta como que no existe.
    const other = (await createUser()).client;
    const foreign = unwrap(
      await other.from("pay_beneficiaries").insert({ name: "Ajeno" }).select("id").single(),
      "ajeno",
    ).id;
    expectRejected(
      await save({ pct: "5", recipients: [{ beneficiary_id: foreign, pct: "100" }] }),
      "23514",
      "pay_retention_inactive_beneficiary",
    );

    expect(await retentionOf(client, gatewayId)).toEqual({
      retention_pct: "0.0000",
      retention_days: 0,
      recipients: [],
    });
  });

  it("una pasarela que no existe (o de otro usuario) no se toca", async () => {
    const other = (await createUser()).client;
    const foreign = await newGateway(other, "OTF Demo ajena");
    expectRejected(
      await client.rpc("pay_save_gateway_retention", {
        p: { gateway_id: foreign, pct: "5", days: 30, recipients: [{ beneficiary_id: titularId, pct: "100" }] },
      }),
      "P0002",
      "pay_gateway_not_found",
    );
    expect(await retentionOf(other, foreign)).toEqual({ retention_pct: "0.0000", retention_days: 0, recipients: [] });
  });
});

describe("pay_retention_shares", () => {
  async function sharesOf(db: Db, txId: string) {
    return unwrap(
      await db
        .from("pay_retention_shares")
        .select("beneficiary_id, amount::text")
        .eq("transaction_id", txId)
        .order("amount", { ascending: false })
        .order("beneficiary_id"),
      "partes",
    );
  }

  it("un cobro guarda sus partes con pay_save_transactions", async () => {
    const [saved] = await saveTransactions(client, [
      e1Retained([
        { beneficiary_id: b.beneficiaryIds.a, amount: "3.00" },
        { beneficiary_id: titularId, amount: "2.00" },
      ]),
    ]);
    expect(await sharesOf(client, saved!.id)).toEqual([
      { beneficiary_id: b.beneficiaryIds.a, amount: "3.00" },
      { beneficiary_id: titularId, amount: "2.00" },
    ]);
  });

  it("la suma de las partes la controla el disparador: un centavo de menos, o sin partes, no entra", async () => {
    expectRejected(
      await client.rpc("pay_save_transactions", {
        p_items: [
          e1Retained([
            { beneficiary_id: b.beneficiaryIds.a, amount: "2.50" },
            { beneficiary_id: titularId, amount: "2.49" },
          ]),
        ],
      }),
      "23514",
      "pay_retention_sum_mismatch",
    );
    expectRejected(
      await client.rpc("pay_save_transactions", { p_items: [e1Retained(null)] }),
      "23514",
      "pay_retention_sum_mismatch",
    );
    // Una parte suelta, por la API, tampoco descuadra un cobro.
    const [saved] = await saveTransactions(client, [e1Item(b)]);
    expectRejected(
      await client
        .from("pay_retention_shares")
        .insert({ transaction_id: saved!.id, beneficiary_id: titularId, amount: "1.00" }),
      "23514",
      "pay_retention_sum_mismatch",
    );
  });

  it("sin retention_shares (o nulas) no se tocan; si vienen, se reemplazan", async () => {
    const [saved] = await saveTransactions(client, [
      e1Retained([
        { beneficiary_id: b.beneficiaryIds.a, amount: "2.50" },
        { beneficiary_id: titularId, amount: "2.50" },
      ]),
    ]);
    const id = saved!.id;
    await saveTransactions(client, [{ mode: "update", tx: { id, note: "sin tocar las partes" } }]);
    await saveTransactions(client, [{ mode: "update", tx: { id, note: "nulas" }, retention_shares: null }]);
    expect(await sharesOf(client, id)).toHaveLength(2);

    await saveTransactions(client, [{ mode: "update", tx: { id, retention_amount: "0.00" }, retention_shares: [] }]);
    expect(await sharesOf(client, id)).toEqual([]);
  });
});

describe("las vistas", () => {
  type Balance = { beneficiary_id: string; assigned: string; settled: string; balance: string; retained: string };

  let owner: Db;
  let ob: Basics;
  let holderId: string;
  let txId: string;

  beforeAll(async () => {
    owner = (await createUser()).client;
    ob = await seedBasics(owner);
    holderId = unwrap(
      await owner.from("pay_beneficiaries").insert({ name: "Titular B" }).select("id").single(),
      "titular",
    ).id;
    // E1 con 5,00 retenido: 2,50 al Grupo A (está en el reparto) y 2,50 al titular (no está).
    const [saved] = await saveTransactions(owner, [
      {
        ...e1Item(ob, { retention_amount: "5.00" }),
        retention_shares: [
          { beneficiary_id: ob.beneficiaryIds.a, amount: "2.50" },
          { beneficiary_id: holderId, amount: "2.50" },
        ],
      },
    ]);
    txId = saved!.id;
    // Uno en la papelera con su retenido: no cuenta en nada.
    const [trashed] = await saveTransactions(owner, [
      {
        ...e1Item(ob, { retention_amount: "1.00" }),
        retention_shares: [{ beneficiary_id: holderId, amount: "1.00" }],
      },
    ]);
    await saveTransactions(owner, [{ mode: "update", tx: { id: trashed!.id, deleted_at: "2026-11-14T00:00:00Z" } }]);
    unwrap(
      await owner
        .from("pay_settlements")
        .insert({ beneficiary_id: ob.beneficiaryIds.a, paid_on: "2026-11-14", amount: "10.00" })
        .select("id"),
      "liquidación",
    );
  });

  async function balances(): Promise<Record<string, Omit<Balance, "beneficiary_id">>> {
    const rows = unwrap(
      await owner
        .from("pay_beneficiary_balances")
        .select("beneficiary_id, assigned::text, settled::text, balance::text, retained::text"),
      "saldos",
    ) as Balance[];
    return Object.fromEntries(rows.map(({ beneficiary_id, ...rest }) => [beneficiary_id, rest]));
  }

  it("pay_beneficiary_balances: el saldo descuenta lo retenido; asignado y liquidado no cambian", async () => {
    expect(await balances()).toEqual({
      [ob.beneficiaryIds.a]: { assigned: "45.15", settled: "10.00", balance: "32.65", retained: "2.50" },
      [ob.beneficiaryIds.b]: { assigned: "27.09", settled: "0.00", balance: "27.09", retained: "0.00" },
      [ob.beneficiaryIds.c]: { assigned: "18.06", settled: "0.00", balance: "18.06", retained: "0.00" },
      // Recibe retención sin estar en el reparto: lo retenido es un adelanto y su saldo queda negativo.
      [holderId]: { assigned: "0.00", settled: "0.00", balance: "-2.50", retained: "2.50" },
    });
  });

  it("pay_bank_account_totals: lo que llega al banco es el neto menos lo retenido", async () => {
    const read = async () =>
      unwrap(
        await owner
          .from("pay_bank_account_totals")
          .select(
            "deposited_count, deposited_net::text, pending_count, pending_net::text, deposited_payout::text, pending_payout::text",
          )
          .eq("bank_account_id", ob.bankAccountId)
          .single(),
        "totales de la cuenta",
      );
    expect(await read()).toEqual({
      deposited_count: 0,
      deposited_net: "0.00",
      pending_count: 1,
      pending_net: "90.30",
      deposited_payout: "0.00",
      pending_payout: "85.30",
    });
    await saveTransactions(owner, [
      { mode: "update", tx: { id: txId, status: "depositado", deposited_on: "2026-11-16" } },
    ]);
    expect(await read()).toEqual({
      deposited_count: 1,
      deposited_net: "90.30",
      pending_count: 0,
      pending_net: "0.00",
      deposited_payout: "85.30",
      pending_payout: "0.00",
    });
  });

  it("pay_company_totals y pay_gateway_totals: la columna nueva suma lo retenido; las de antes, lo de siempre", async () => {
    const company = unwrap(
      await owner
        .from("pay_company_totals")
        .select("tx_count, gross::text, fees::text, net::text, buyer_fees::text, retention::text")
        .eq("company_id", ob.companyId)
        .single(),
      "totales de la empresa",
    );
    expect(company).toEqual({
      tx_count: 1,
      gross: "100.00",
      fees: "9.70",
      net: "90.30",
      buyer_fees: "0.00",
      retention: "5.00",
    });
    const gateway = unwrap(
      await owner
        .from("pay_gateway_totals")
        .select("tx_count, gross::text, fees::text, net::text, buyer_fees::text, retention::text")
        .eq("gateway_id", ob.gatewayId)
        .single(),
      "totales de la pasarela",
    );
    expect(gateway).toEqual(company);
  });

  it("sin retención, las vistas dan exactamente lo de antes", async () => {
    const plain = (await createUser()).client;
    const pb = await seedBasics(plain);
    await saveTransactions(plain, [e1Item(pb)]);
    const rows = unwrap(
      await plain
        .from("pay_beneficiary_balances")
        .select("assigned::text, settled::text, balance::text, retained::text")
        .order("assigned", { ascending: false }),
      "saldos",
    );
    expect(rows).toEqual([
      { assigned: "45.15", settled: "0.00", balance: "45.15", retained: "0.00" },
      { assigned: "27.09", settled: "0.00", balance: "27.09", retained: "0.00" },
      { assigned: "18.06", settled: "0.00", balance: "18.06", retained: "0.00" },
    ]);
    const account = unwrap(
      await plain
        .from("pay_bank_account_totals")
        .select("pending_net::text, pending_payout::text, deposited_net::text, deposited_payout::text")
        .single(),
      "cuenta",
    );
    expect(account).toEqual({
      pending_net: "90.30",
      pending_payout: "90.30",
      deposited_net: "0.00",
      deposited_payout: "0.00",
    });
    const company = unwrap(await plain.from("pay_company_totals").select("retention::text").single(), "empresa");
    expect(company).toEqual({ retention: "0.00" });
  });
});

describe("RLS de las tablas nuevas", () => {
  it("otro usuario no ve ni escribe las personas de una pasarela ni las partes de un cobro", async () => {
    const gatewayId = await newGateway(client, "OTF Demo (RLS)");
    await client.rpc("pay_save_gateway_retention", {
      p: { gateway_id: gatewayId, pct: "5", days: 30, recipients: [{ beneficiary_id: titularId, pct: "100" }] },
    });
    const [saved] = await saveTransactions(client, [
      e1Retained([
        { beneficiary_id: b.beneficiaryIds.a, amount: "2.50" },
        { beneficiary_id: titularId, amount: "2.50" },
      ]),
    ]);
    const intruder = (await createUser()).client as unknown as SupabaseClient;

    for (const [table, column, id] of [
      ["pay_gateway_retention_recipients", "gateway_id", gatewayId],
      ["pay_retention_shares", "transaction_id", saved!.id],
    ] as const) {
      const seen = await intruder.from(table).select("id").eq(column, id);
      expect(seen.error).toBeNull();
      expect(seen.data).toEqual([]);
      const changed = await intruder
        .from(table)
        .update({ created_at: "2026-01-01T00:00:00Z" })
        .eq(column, id)
        .select("id");
      expect(changed.data ?? []).toEqual([]);
      const deleted = await intruder.from(table).delete().eq(column, id).select("id");
      expect(deleted.data ?? []).toEqual([]);
    }
    // Intentar escribir apuntando a lo de otro usuario choca con las claves compuestas o con la RLS.
    const own = (await createUser()).client;
    const ownBasics = await seedBasics(own);
    const res = await own
      .from("pay_gateway_retention_recipients")
      .insert({ gateway_id: gatewayId, beneficiary_id: ownBasics.beneficiaryIds.a, pct: "100" })
      .select("id");
    expect(res.error?.code).toBe("23503");
    expect((await retentionOf(client, gatewayId)).recipients).toEqual([{ beneficiary_id: titularId, pct: "100.0000" }]);
  });
});
