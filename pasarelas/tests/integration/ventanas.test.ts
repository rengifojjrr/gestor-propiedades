import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { NewTxInput } from "@/lib/pasarelas";
import { saveCompanyGateway } from "@/server/pasarelas/ops/companies";
import {
  createGateway,
  saveExtra,
  saveInternational,
  updateGateway,
  type GatewayFields,
} from "@/server/pasarelas/ops/gateways";
import { loadUsHolidays } from "@/server/pasarelas/ops/holidays";
import { importTransactions, previewImport } from "@/server/pasarelas/ops/import";
import { createTx, previewRecalcTx, refreshEstimatesTx } from "@/server/pasarelas/ops/transactions";
import { getCompany } from "@/server/pasarelas/queries/companies";
import { getGateway } from "@/server/pasarelas/queries/gateways";
import { getSnapshots } from "@/server/pasarelas/queries/transactions";
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

// ─── Lo que hace la app con las ventanas (las operaciones de ops/) ──────────────────────────────────────────

/** Martes 10 de noviembre de 2026, 10:30 de Nueva York. El miércoles 11 es feriado bancario (Día de los Veteranos). */
const MARTES_10 = { occurredAt: "2026-11-10T15:30:00Z", occurredOn: "2026-11-10" };

/** Un usuario nuevo con lo de `seedBasics` y los feriados bancarios de 2026 (los que mueven los depósitos). */
async function freshUser(): Promise<{ db: Db; basics: Basics }> {
  const db = (await createUser()).client;
  const basics = await seedBasics(db);
  await loadUsHolidays(db, 2026);
  return { db, basics };
}

/** Un cobro de 100,00 USD el martes 10 con Stripe (sin canal ni esquema), con esas opciones. */
function charge(basics: Basics, patch: Partial<NewTxInput> = {}): NewTxInput {
  return {
    id: randomUUID(),
    companyId: basics.companyId,
    channelId: null,
    gatewayId: basics.gatewayId,
    extraIds: [],
    schemeId: null,
    ...MARTES_10,
    currency: "USD",
    grossOriginal: "100.00",
    reference: null,
    note: null,
    ...patch,
  };
}

/** Las dos fechas de la ventana de un cobro, como las lee la app: [desde, la estimada]. */
async function windowOfTx(db: Db, id: string) {
  const [tx] = await getSnapshots(db, [id]);
  return [tx?.estimatedDepositFrom, tx?.estimatedDepositOn];
}

/** Los datos de Stripe en `seedBasics`, como los guarda la pantalla: 2 días hábiles, con lo que se pida. */
const stripeFields = (patch: Partial<GatewayFields> = {}): GatewayFields => ({
  name: "Stripe",
  payoutDays: 2,
  payoutDaysMax: null,
  payoutDayType: "habiles",
  refundsReturnFee: false,
  disputeFee: "0.00",
  notes: null,
  ...patch,
});

describe("pasarelas, opciones y recargo internacional con ventana", () => {
  it("createGateway y updateGateway guardan «de 3 a 5 días»; las opciones, su máximo", async () => {
    const { db } = await freshUser();
    const name = `Ventana Demo ${randomUUID().slice(0, 8)}`;
    const { id } = await createGateway(db, {
      ...stripeFields({ name, payoutDays: 3, payoutDaysMax: 5 }),
      pct: "2.9",
      fixed: "0.30",
      extras: [
        {
          name: "Pago en 1 a 2 días",
          pct: "1",
          fixed: "0.00",
          base: "bruto",
          defaultOn: false,
          payoutDaysOverride: 1,
          payoutDaysOverrideMax: 2,
        },
      ],
    });
    const created = await getGateway(db, id);
    expect([created?.payoutDays, created?.payoutDaysMax]).toEqual([3, 5]);
    expect(created?.extras.map((extra) => [extra.payoutDaysOverride, extra.payoutDaysOverrideMax])).toEqual([[1, 2]]);

    await updateGateway(db, id, stripeFields({ name, payoutDays: 4, payoutDaysMax: null }));
    const updated = await getGateway(db, id);
    expect([updated?.payoutDays, updated?.payoutDaysMax]).toEqual([4, null]);

    await saveExtra(db, {
      id: updated?.extras[0]?.id,
      gatewayId: id,
      name: "Pago en 1 a 3 días",
      pct: "1",
      fixed: "0.00",
      base: "bruto",
      defaultOn: false,
      payoutDaysOverride: 1,
      payoutDaysOverrideMax: 3,
      active: true,
    });
    const saved = await getGateway(db, id);
    expect(saved?.extras.map((option) => [option.name, option.payoutDaysOverrideMax])).toEqual([
      ["Pago en 1 a 3 días", 3],
    ]);
  });

  it("saveInternational guarda los días propios del pago internacional, o «tardan lo mismo» (vacíos)", async () => {
    const { db, basics } = await freshUser();
    const fee = { gatewayId: basics.gatewayId, pct: "1.5", fixed: "0.00" };
    const { id } = await saveInternational(db, { ...fee, payoutDaysOverride: 7, payoutDaysOverrideMax: 10 });
    const international = async () => (await getGateway(db, basics.gatewayId))?.extras.find((extra) => extra.id === id);
    expect(await international()).toMatchObject({
      kind: "internacional",
      payoutDaysOverride: 7,
      payoutDaysOverrideMax: 10,
    });

    await saveInternational(db, { ...fee, id, payoutDaysOverride: null, payoutDaysOverrideMax: null });
    expect(await international()).toMatchObject({ payoutDaysOverride: null, payoutDaysOverrideMax: null });
  });

  it("saveCompanyGateway guarda la ventana propia de la empresa, y el cobro la usa", async () => {
    const { db, basics } = await freshUser();
    await saveCompanyGateway(db, {
      id: basics.companyGatewayId,
      companyId: basics.companyId,
      gatewayId: basics.gatewayId,
      dashboardUrl: null,
      checkoutUrl: null,
      bankAccountId: basics.bankAccountId,
      payoutDaysOverride: 3,
      payoutDaysOverrideMax: 5,
      defaultExtraIds: null,
    });
    const company = await getCompany(db, basics.companyId);
    expect(company?.gateways.map((account) => [account.payoutDaysOverride, account.payoutDaysOverrideMax])).toEqual([
      [3, 5],
    ]);
    const { id } = await createTx(db, charge(basics));
    expect(await windowOfTx(db, id)).toEqual(["2026-11-16", "2026-11-18"]);
  });
});

describe("cobros con ventana", () => {
  it("con 3 a 5 hábiles el mar 10 (feriado y fin de semana en medio): del lun 16 al mié 18", async () => {
    const { db, basics } = await freshUser();
    await updateGateway(db, basics.gatewayId, stripeFields({ payoutDays: 3, payoutDaysMax: 5 }));
    const { id } = await createTx(db, charge(basics));
    expect(await windowOfTx(db, id)).toEqual(["2026-11-16", "2026-11-18"]);
    // Con «Pago rápido» (0 días), el mismo día: un solo día, sin «desde».
    const fast = await createTx(db, charge(basics, { extraIds: [basics.extraId] }));
    expect(await windowOfTx(db, fast.id)).toEqual([null, "2026-11-10"]);
    // A mano, un solo día.
    const manual = await createTx(db, charge(basics, { estimatedDepositOn: "2026-11-30" }));
    expect(await windowOfTx(db, manual.id)).toEqual([null, "2026-11-30"]);
  });

  it("internacional de 7 a 10 hábiles: su ventana; con «Pago rápido» además, la más rápida", async () => {
    const { db, basics } = await freshUser();
    const { id: internationalId } = await saveInternational(db, {
      gatewayId: basics.gatewayId,
      pct: "1.5",
      fixed: "0.00",
      payoutDaysOverride: 7,
      payoutDaysOverrideMax: 10,
    });
    const abroad = await createTx(db, charge(basics, { extraIds: [internationalId] }));
    expect(await windowOfTx(db, abroad.id)).toEqual(["2026-11-20", "2026-11-25"]);
    const fast = await createTx(db, charge(basics, { extraIds: [basics.extraId, internationalId] }));
    expect(await windowOfTx(db, fast.id)).toEqual([null, "2026-11-10"]);
  });

  it("refreshEstimatesTx: una fila vieja de un solo día no se toca; con ventana en la pasarela, las dos", async () => {
    const { db, basics } = await freshUser();
    // Una fila vieja, guardada sin «from» como antes de las ventanas: E1 el viernes 13 con «Pago rápido».
    const [old] = await saveTransactions(db, [e1Item(basics, { reference: `vieja-${randomUUID()}` })]);
    // 2 días hábiles desde el martes 10, con el feriado del 11: el viernes 13.
    const single = await createTx(db, charge(basics));
    expect(await windowOfTx(db, single.id)).toEqual([null, "2026-11-13"]);
    // Ya al día: no se escribe nada, y la fila vieja sigue sin «from».
    expect(await refreshEstimatesTx(db)).toBe(0);
    expect(await windowOfTx(db, old!.id)).toEqual([null, "2026-11-13"]);

    await updateGateway(db, basics.gatewayId, stripeFields({ payoutDays: 3, payoutDaysMax: 5 }));
    expect(await refreshEstimatesTx(db, { gatewayId: basics.gatewayId })).toBe(1);
    expect(await windowOfTx(db, single.id)).toEqual(["2026-11-16", "2026-11-18"]);
    // La vieja llevaba «Pago rápido» congelado: sigue el mismo día.
    expect(await windowOfTx(db, old!.id)).toEqual([null, "2026-11-13"]);
  });

  it("previewRecalcTx dice desde y hasta cuándo, antes y después, si hay una ventana de por medio", async () => {
    const { db, basics } = await freshUser();
    const { id } = await createTx(db, charge(basics));
    await updateGateway(db, basics.gatewayId, stripeFields({ payoutDays: 3, payoutDaysMax: 5 }));
    const preview = await previewRecalcTx(db, [id], "hoy", "2026-11-20");
    expect(preview.items.map((item) => item.changes.filter((row) => row.key.startsWith("estimated")))).toEqual([
      [
        { key: "estimatedDepositFrom", label: "Llega desde", before: "2026-11-13", after: "2026-11-16" },
        { key: "estimatedDepositOn", label: "Llega hasta", before: "2026-11-13", after: "2026-11-18" },
      ],
    ]);
  });
});

describe("importar con ventana", () => {
  it("cada cobro importado guarda las dos fechas, y la vista previa las dice", async () => {
    const { db, basics } = await freshUser();
    await updateGateway(db, basics.gatewayId, stripeFields({ payoutDays: 3, payoutDaysMax: 5 }));
    const reference = `txn_${randomUUID().slice(0, 8)}`;
    const rows = [
      {
        line: 2,
        reference,
        ...MARTES_10,
        grossOriginal: "100.00",
        currency: "USD",
        reportedFee: null,
        note: null,
      },
    ];
    const batch = { companyId: basics.companyId, gatewayId: basics.gatewayId, channelId: null, extraIds: [] };
    const preview = await previewImport(db, { ...batch, useReportedFee: false, rows });
    expect(preview.estimates).toEqual([
      { line: 2, estimatedDepositFrom: "2026-11-16", estimatedDepositOn: "2026-11-18" },
    ]);
    const result = await importTransactions(db, { ...batch, useReportedFee: false, alreadyDeposited: false, rows });
    expect(result).toMatchObject({ created: 1 });
    const imported = await db
      .from("pay_transactions")
      .select("estimated_deposit_from, estimated_deposit_on")
      .eq("reference", reference)
      .single();
    expect(unwrap(imported, "cobro importado")).toEqual({
      estimated_deposit_from: "2026-11-16",
      estimated_deposit_on: "2026-11-18",
    });
  });
});
