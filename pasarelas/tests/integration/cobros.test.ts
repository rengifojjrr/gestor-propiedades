import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  ESTIMATE_REFRESH_SUMMARY,
  PAY_STATE_TEXT,
  PayRuleError,
  PayStateError,
  planCreate,
  planDeposit,
  type NewTxInput,
} from "@/lib/pasarelas";
import { UserError, errorMessage } from "@/server/pasarelas/errors";
import { saveInternational } from "@/server/pasarelas/ops/gateways";
import { addHoliday } from "@/server/pasarelas/ops/holidays";
import { receiptSignedUrl, registerReceipt, removeReceipt } from "@/server/pasarelas/ops/receipts";
import {
  applyRecalcOneTx,
  applyRecalcTx,
  createTx,
  depositOneTx,
  depositTx,
  depositTxWithSkips,
  disputeTx,
  editTx,
  failTx,
  previewRecalcTx,
  purgeTx,
  refreshEstimatesAfterTx,
  refreshEstimatesTx,
  refundTx,
  reopenTx,
  restoreTx,
  revertDepositTx,
  setEstimatedTx,
  setRefundTotalTx,
  transitTx,
  trashTx,
} from "@/server/pasarelas/ops/transactions";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { getSnapshots, getTx, lastTx, leanTx, listTx, type TxFilters } from "@/server/pasarelas/queries/transactions";
import { saveTx } from "@/server/pasarelas/tx-save";
import {
  adminClient,
  createUser,
  e1Item,
  saveTransactions,
  seedBasics,
  unwrap,
  type Basics,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Los cobros de punta a punta contra la base: cada operación de `ops/` con la sesión real del usuario de prueba
 * (la clave secreta solo prepara o inspecciona datos), y las lecturas de `queries/` sobre lo que dejan.
 */

const BUCKET = "comprobantes";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
/** Viernes 13 de noviembre de 2026, 10:30 de Nueva York. */
const VIERNES_10_30 = "2026-11-13T15:30:00Z";
const VIERNES = "2026-11-13";
const MARTES = "2026-11-17";
const TODAY = "2026-11-20";
/** Todo el año: las lecturas de estas pruebas no dependen del período. */
const ALL: TxFilters = {};

const admin = adminClient();

/** El recargo internacional sin días propios: tarda lo mismo que un pago nacional. */
const SAME_DAYS = { payoutDaysOverride: null, payoutDaysOverrideMax: null } as const;

/** El cobro E1 del spec: 100,00 por el canal al 5 %, con Stripe y «Pago rápido», repartido 50/30/20. */
function e1(b: Basics, patch: Partial<NewTxInput> = {}): NewTxInput {
  return {
    id: randomUUID(),
    companyId: b.companyId,
    channelId: b.channelId,
    gatewayId: b.gatewayId,
    extraIds: [b.extraId],
    schemeId: b.schemeId,
    occurredOn: VIERNES,
    occurredAt: VIERNES_10_30,
    currency: "USD",
    grossOriginal: "100.00",
    reference: null,
    note: null,
    ...patch,
  };
}

/** Registra E1 (con lo que se pida distinto) y devuelve su id. */
async function register(user: TestUser, b: Basics, patch: Partial<NewTxInput> = {}): Promise<string> {
  const { id, created } = await createTx(user.client, e1(b, patch));
  expect(created).toBe(true);
  return id;
}

/** El cobro tal como quedó en la base (leído con la clave secreta, con el dinero como texto). */
async function rowOf(id: string) {
  return unwrap(
    await admin
      .from("pay_transactions")
      .select(
        "status, currency, gross_original::text, refunded_amount::text, gross_amount::text, fees_total::text, net_amount::text, alloc_base_amount::text, dispute_state, dispute_opened_on, dispute_closed_on, estimated_deposit_on, estimated_is_manual, deposited_on, bank_account_id, reference, note, deleted_at, updated_at, receipts_count",
      )
      .eq("id", id)
      .single(),
    "cobro",
  );
}

/** Lo que le toca a los Grupos A, B y C de ese cobro. */
async function sharesOf(id: string, b: Basics): Promise<(string | undefined)[]> {
  const rows = unwrap(
    await admin.from("pay_allocations").select("beneficiary_id, amount::text").eq("transaction_id", id),
    "reparto",
  );
  const { a, b: second, c } = b.beneficiaryIds;
  return [a, second, c].map((beneficiary) => rows.find((row) => row.beneficiary_id === beneficiary)?.amount);
}

/** Los tipos de evento del historial del cobro, del más antiguo al más reciente. */
async function eventKinds(id: string): Promise<string[]> {
  const rows = unwrap(
    await admin.from("pay_transaction_events").select("kind").eq("transaction_id", id).order("at"),
    "historial",
  );
  return rows.map((row) => row.kind);
}

async function upload(client: Db, path: string, contentType = "image/png"): Promise<void> {
  const { error } = await client.storage.from(BUCKET).upload(path, PNG, { contentType });
  if (error) throw new Error(`No se pudo subir ${path}: ${error.message}`);
}

async function filesIn(folder: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (error) throw new Error(`No se pudo listar ${folder}: ${error.message}`);
  return data.map((file) => file.name).sort();
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Se esperaba un error y no lo hubo");
}

async function expectStateError(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await caught(promise);
  expect(error).toBeInstanceOf(PayStateError);
  expect((error as PayStateError).code).toBe(code);
}

async function expectUserError(promise: Promise<unknown>, message: string): Promise<void> {
  const error = await caught(promise);
  expect(error).toBeInstanceOf(UserError);
  expect((error as UserError).message).toBe(message);
}

const ids = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);

// ─── Registrar ──────────────────────────────────────────────────────────────────────────────────────────────

describe("createTx", () => {
  let user: TestUser;
  let b: Basics;

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
  });

  it("E1 queda en la base con comisiones 9,70, neto 90,30, reparto 45,15 · 27,09 · 18,06 y un evento «creado»", async () => {
    const input = e1(b, { reference: "ch_demo_0001", note: "Inscripción de noviembre" });

    expect(await createTx(user.client, input)).toEqual({ id: input.id, created: true });

    expect(await rowOf(input.id)).toMatchObject({
      status: "registrado",
      currency: "USD",
      gross_original: "100.00",
      refunded_amount: "0.00",
      gross_amount: "100.00",
      fees_total: "9.70",
      net_amount: "90.30",
      alloc_base_amount: "90.30",
      // «Pago rápido»: cae el mismo día, en la cuenta de Stripe de la empresa.
      estimated_deposit_on: VIERNES,
      estimated_is_manual: false,
      deposited_on: null,
      bank_account_id: b.bankAccountId,
      reference: "ch_demo_0001",
      note: "Inscripción de noviembre",
      deleted_at: null,
    });
    expect(await sharesOf(input.id, b)).toEqual(["45.15", "27.09", "18.06"]);
    const events = unwrap(
      await admin.from("pay_transaction_events").select("kind, summary, data").eq("transaction_id", input.id),
      "historial",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "creado",
      summary: "Cobro de $100,00 por Stripe",
      data: { antes: null, despues: { bruto: "100.00", comisiones: "9.70", neto: "90.30", estado: "registrado" } },
    });
  });

  it("es idempotente por id: el mismo envío dos veces deja una sola fila y la segunda dice created: false", async () => {
    const input = e1(b);
    expect(await createTx(user.client, input)).toEqual({ id: input.id, created: true });
    const before = await rowOf(input.id);

    // El reenvío del mismo formulario no toca nada.
    expect(await createTx(user.client, input)).toEqual({ id: input.id, created: false });

    const rows = unwrap(await admin.from("pay_transactions").select("id").eq("id", input.id), "filas");
    expect(rows).toHaveLength(1);
    expect(await rowOf(input.id)).toEqual(before);
    expect(await eventKinds(input.id)).toEqual(["creado"]);
    expect(await sharesOf(input.id, b)).toEqual(["45.15", "27.09", "18.06"]);
  });

  it("con el mismo id y otros datos (el monto corregido tras un corte) no escribe nada y lo dice", async () => {
    const input = e1(b);
    expect(await createTx(user.client, input)).toEqual({ id: input.id, created: true });
    const before = await rowOf(input.id);

    await expectStateError(createTx(user.client, { ...input, grossOriginal: "150.00" }), "ya_registrado");
    await expectStateError(createTx(user.client, { ...input, reference: "ch_demo_corregida" }), "ya_registrado");
    // También lo de «Más opciones»: el estado inicial, la fecha estimada a mano o la nota corregidos tras un corte.
    await expectStateError(
      createTx(user.client, { ...input, status: "depositado", depositedOn: "2026-11-16" }),
      "ya_registrado",
    );
    await expectStateError(createTx(user.client, { ...input, estimatedDepositOn: "2026-11-30" }), "ya_registrado");
    await expectStateError(createTx(user.client, { ...input, note: "Corregida" }), "ya_registrado");
    // Ni vuelve a calcularlo: lo que hoy ya no se podría registrar también es «otros datos».
    await expectStateError(createTx(user.client, { ...input, extraIds: [randomUUID()] }), "ya_registrado");

    expect(await rowOf(input.id)).toEqual(before);
    expect(await eventKinds(input.id)).toEqual(["creado"]);
  });

  it("dos envíos a la vez con el mismo id y otros datos: uno lo crea y el otro dice que ya estaba con otros datos", async () => {
    const input = e1(b);

    const results = await Promise.allSettled([
      createTx(user.client, input),
      createTx(user.client, { ...input, grossOriginal: "150.00" }),
    ]);

    const created = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    const refused = results.flatMap((result) => (result.status === "rejected" ? [result.reason as unknown] : []));
    expect(created).toEqual([{ id: input.id, created: true }]);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(PayStateError);
    expect((refused[0] as PayStateError).code).toBe("ya_registrado");
    expect(await eventKinds(input.id)).toEqual(["creado"]);
  });

  it("dos envíos a la vez con el mismo id: uno lo crea, el otro dice created: false, y queda una sola fila", async () => {
    const input = e1(b);

    const results = await Promise.all([createTx(user.client, input), createTx(user.client, input)]);

    expect(results.map((result) => result.id)).toEqual([input.id, input.id]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(await eventKinds(input.id)).toEqual(["creado"]);
  });

  it("una referencia repetida en la misma pasarela se rechaza con un mensaje en español", async () => {
    await register(user, b, { reference: "ch_demo_repetida" });
    const again = e1(b, { reference: "ch_demo_repetida" });

    const error = await caught(createTx(user.client, again));

    expect(errorMessage(error)).toBe("Ya hay un cobro de esa pasarela con esa referencia.");
    expect(unwrap(await admin.from("pay_transactions").select("id").eq("id", again.id), "filas")).toEqual([]);
  });

  it("lo que no se puede resolver con la configuración no se guarda (PayRuleError)", async () => {
    const input = e1(b, { extraIds: [randomUUID()] });

    const error = await caught(createTx(user.client, input));

    expect(error).toBeInstanceOf(PayRuleError);
    expect(errorMessage(error)).toBe("Una de las opciones elegidas no es de esa pasarela.");
    expect(unwrap(await admin.from("pay_transactions").select("id").eq("id", input.id), "filas")).toEqual([]);
  });

  it("el id de un cobro de otro usuario no se puede pisar ni se da por creado", async () => {
    const other = await createUser();
    const theirs = await seedBasics(other.client);
    const id = await register(other, theirs);

    const error = await caught(createTx(user.client, e1(b, { id })));

    expect(errorMessage(error)).toBe("Ya existe un registro con esos datos.");
    expect(await getTx(user.client, id)).toBeNull();
    expect(await eventKinds(id)).toEqual(["creado"]);
  });
});

// ─── Reembolsos ─────────────────────────────────────────────────────────────────────────────────────────────

describe("refundTx y setRefundTotalTx", () => {
  let user: TestUser;
  let b: Basics;

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
  });

  it("E5: un reembolso de 40 deja el neto en 52,90 y el reparto en 26,45 · 15,87 · 10,58", async () => {
    const id = await register(user, b);

    await refundTx(user.client, id, { amount: "40.00", on: "2026-11-16", note: "Devolvió un curso" });

    expect(await rowOf(id)).toMatchObject({
      refunded_amount: "40.00",
      gross_amount: "60.00",
      fees_total: "7.10",
      net_amount: "52.90",
      alloc_base_amount: "52.90",
    });
    expect(await sharesOf(id, b)).toEqual(["26.45", "15.87", "10.58"]);
    const events = unwrap(
      await admin.from("pay_transaction_events").select("kind, summary, data").eq("transaction_id", id).order("at"),
      "historial",
    );
    expect(events.map((event) => event.kind)).toEqual(["creado", "reembolso"]);
    expect(events[1]).toMatchObject({
      summary: "Reembolso de $40,00",
      data: {
        monto: "40.00",
        fecha: "2026-11-16",
        nota: "Devolvió un curso",
        antes: { neto: "90.30" },
        despues: { neto: "52.90" },
      },
    });
  });

  it("un reembolso que pasa de lo que queda no se guarda", async () => {
    const id = await register(user, b);
    await refundTx(user.client, id, { amount: "40.00", on: "2026-11-16" });

    await expectStateError(refundTx(user.client, id, { amount: "60.01", on: "2026-11-17" }), "reembolso_excede");

    expect(await rowOf(id)).toMatchObject({ refunded_amount: "40.00" });
    expect(await eventKinds(id)).toEqual(["creado", "reembolso"]);
  });

  it("setRefundTotalTx corrige el total; si ya es ese, no escribe ni deja evento", async () => {
    const id = await register(user, b);
    await refundTx(user.client, id, { amount: "40.00", on: "2026-11-16" });

    await setRefundTotalTx(user.client, id, "10.00");

    const corrected = await rowOf(id);
    expect(corrected).toMatchObject({ refunded_amount: "10.00", gross_amount: "90.00" });
    expect(await eventKinds(id)).toEqual(["creado", "reembolso", "reembolso"]);

    await setRefundTotalTx(user.client, id, "10.00");

    expect(await rowOf(id)).toEqual(corrected);
    expect(await eventKinds(id)).toEqual(["creado", "reembolso", "reembolso"]);
  });

  it("un cobro que no existe (o que es de otro) da un error para la persona", async () => {
    await expectUserError(
      refundTx(user.client, randomUUID(), { amount: "1.00", on: VIERNES }),
      "Ese cobro ya no existe.",
    );
  });
});

describe("E4: reembolso total con lo ya liquidado", () => {
  it("con 45,15 · 27,09 · 18,06 liquidados y el reembolso total, los saldos quedan en −46,75 · −28,05 · −18,70", async () => {
    const user = await createUser();
    const b = await seedBasics(user.client);
    const id = await register(user, b);
    unwrap(
      await user.client
        .from("pay_settlements")
        .insert([
          { beneficiary_id: b.beneficiaryIds.a, paid_on: "2026-11-14", amount: "45.15" },
          { beneficiary_id: b.beneficiaryIds.b, paid_on: "2026-11-14", amount: "27.09" },
          { beneficiary_id: b.beneficiaryIds.c, paid_on: "2026-11-14", amount: "18.06" },
        ])
        .select("id"),
      "liquidaciones",
    );

    await refundTx(user.client, id, { amount: "100.00", on: "2026-11-16" });

    expect(await rowOf(id)).toMatchObject({ gross_amount: "0.00", fees_total: "3.20", net_amount: "-3.20" });
    expect(await sharesOf(id, b)).toEqual(["-1.60", "-0.96", "-0.64"]);
    const balances = unwrap(
      await user.client
        .from("pay_beneficiary_balances")
        .select("beneficiary_id, currency, assigned::text, settled::text, balance::text"),
      "saldos",
    );
    const balanceOf = (beneficiary: string) => balances.find((row) => row.beneficiary_id === beneficiary);
    expect(balanceOf(b.beneficiaryIds.a)).toMatchObject({
      currency: "USD",
      assigned: "-1.60",
      settled: "45.15",
      balance: "-46.75",
    });
    expect(balanceOf(b.beneficiaryIds.b)).toMatchObject({
      currency: "USD",
      assigned: "-0.96",
      settled: "27.09",
      balance: "-28.05",
    });
    expect(balanceOf(b.beneficiaryIds.c)).toMatchObject({
      currency: "USD",
      assigned: "-0.64",
      settled: "18.06",
      balance: "-18.70",
    });
  });
});

// ─── Disputas, fallido, edición y fecha estimada ────────────────────────────────────────────────────────────

describe("disputeTx, failTx, reopenTx, editTx y setEstimatedTx", () => {
  let user: TestUser;
  let b: Basics;

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
    // E6: la disputa de Stripe cuesta 15,00.
    unwrap(
      await user.client
        .from("pay_gateways")
        .update({ dispute_fee: "15.00" })
        .eq("id", b.gatewayId)
        .select("id")
        .single(),
      "costo de disputa",
    );
  });

  it("E6: la disputa abierta cuesta 15,00 (neto 75,30; reparto 37,65 · 22,59 · 15,06) y ganada vuelve a E1", async () => {
    const id = await register(user, b);

    await disputeTx(user.client, id, { action: "abrir", on: "2026-11-16" });

    expect(await rowOf(id)).toMatchObject({
      dispute_state: "abierta",
      dispute_opened_on: "2026-11-16",
      dispute_closed_on: null,
      fees_total: "24.70",
      net_amount: "75.30",
    });
    expect(await sharesOf(id, b)).toEqual(["37.65", "22.59", "15.06"]);

    await disputeTx(user.client, id, { action: "ganar", on: "2026-11-20" });

    expect(await rowOf(id)).toMatchObject({
      dispute_state: "ganada",
      dispute_closed_on: "2026-11-20",
      fees_total: "9.70",
      net_amount: "90.30",
    });
    expect(await sharesOf(id, b)).toEqual(["45.15", "27.09", "18.06"]);
    expect(await eventKinds(id)).toEqual(["creado", "disputa_abierta", "disputa_ganada"]);
  });

  it("perder la disputa reembolsa todo; anularla la borra", async () => {
    const lost = await register(user, b);
    await disputeTx(user.client, lost, { action: "abrir", on: "2026-11-16" });
    await disputeTx(user.client, lost, { action: "perder", on: "2026-11-20" });
    expect(await rowOf(lost)).toMatchObject({
      dispute_state: "perdida",
      refunded_amount: "100.00",
      gross_amount: "0.00",
      // Lo que Stripe se queda de lo reembolsado (3,20) más la disputa (15,00).
      net_amount: "-18.20",
    });

    const voided = await register(user, b);
    await disputeTx(user.client, voided, { action: "abrir", on: "2026-11-16" });
    await disputeTx(user.client, voided, { action: "anular", on: "2026-11-17" });
    expect(await rowOf(voided)).toMatchObject({ dispute_state: null, dispute_opened_on: null, net_amount: "90.30" });
    expect(await eventKinds(voided)).toEqual(["creado", "disputa_abierta", "disputa_anulada"]);

    await expectStateError(
      disputeTx(user.client, voided, { action: "ganar", on: "2026-11-18" }),
      "sin_disputa_abierta",
    );
  });

  it("fallido deja todo en cero y reabrir devuelve los números de antes", async () => {
    const id = await register(user, b);

    await failTx(user.client, id);

    expect(await rowOf(id)).toMatchObject({
      status: "fallido",
      gross_original: "100.00",
      gross_amount: "0.00",
      fees_total: "0.00",
      net_amount: "0.00",
      alloc_base_amount: "0.00",
    });
    expect(await sharesOf(id, b)).toEqual(["0.00", "0.00", "0.00"]);
    await expectStateError(failTx(user.client, id), "fallido");

    await reopenTx(user.client, id);

    expect(await rowOf(id)).toMatchObject({ status: "registrado", gross_amount: "100.00", net_amount: "90.30" });
    expect(await sharesOf(id, b)).toEqual(["45.15", "27.09", "18.06"]);
    expect(await eventKinds(id)).toEqual(["creado", "fallido", "reabierto"]);
    await expectStateError(reopenTx(user.client, id), "no_fallido");
  });

  it("editar el monto vuelve a calcular con las reglas congeladas; editar solo la nota no toca el reparto", async () => {
    const id = await register(user, b);

    await editTx(user.client, id, { grossOriginal: "200.00" });

    expect(await rowOf(id)).toMatchObject({ gross_original: "200.00", fees_total: "19.10", net_amount: "180.90" });
    expect(await sharesOf(id, b)).toEqual(["90.45", "54.27", "36.18"]);

    await editTx(user.client, id, { note: "Corregido", reference: "ch_demo_editado" });

    expect(await rowOf(id)).toMatchObject({ note: "Corregido", reference: "ch_demo_editado", net_amount: "180.90" });
    expect(await eventKinds(id)).toEqual(["creado", "editado", "editado"]);
    await expectStateError(editTx(user.client, id, { note: "Corregido" }), "sin_cambios");
  });

  it("la fecha estimada se puede fijar a mano y volver a la automática", async () => {
    const id = await register(user, b, { extraIds: [] });
    expect(await rowOf(id)).toMatchObject({ estimated_deposit_on: MARTES, estimated_is_manual: false });

    await setEstimatedTx(user.client, id, "2026-11-25");
    expect(await rowOf(id)).toMatchObject({ estimated_deposit_on: "2026-11-25", estimated_is_manual: true });

    await setEstimatedTx(user.client, id, null);
    expect(await rowOf(id)).toMatchObject({ estimated_deposit_on: MARTES, estimated_is_manual: false });
    expect(await eventKinds(id)).toEqual(["creado", "fecha_estimada", "fecha_estimada"]);
  });
});

// ─── Pagos internacionales ──────────────────────────────────────────────────────────────────────────────────

describe("pagos internacionales: el recargo de la pasarela se aplica como una opción del cobro", () => {
  /** Un usuario con lo de E1 y el recargo internacional de Stripe: 1,5 % sobre el bruto. */
  async function withSurcharge(): Promise<{ user: TestUser; b: Basics; international: string }> {
    const user = await createUser();
    const b = await seedBasics(user.client);
    const { id } = await saveInternational(user.client, { ...SAME_DAYS, gatewayId: b.gatewayId, pct: "1.5", fixed: "0.00" });
    return { user, b, international: id };
  }

  /** 100,00 por Stripe, sin canal ni «Pago rápido», repartido 50/30/20 sobre el neto. */
  const via = (extraIds: string[]): Partial<NewTxInput> => ({ channelId: null, extraIds });

  it("nacional paga la tarifa (3,20); internacional, 3,20 + 1,50 = 4,70, con su línea en el desglose", async () => {
    const { user, b, international } = await withSurcharge();
    const national = await register(user, b, via([]));
    expect(await rowOf(national)).toMatchObject({ fees_total: "3.20", net_amount: "96.80" });

    const abroad = await register(user, b, via([international]));
    expect(await rowOf(abroad)).toMatchObject({ fees_total: "4.70", net_amount: "95.30" });
    expect(await sharesOf(abroad, b)).toEqual(["47.65", "28.59", "19.06"]);
    const [snapshot] = await getSnapshots(user.client, [abroad]);
    expect(snapshot?.breakdown.lines.map((line) => [line.kind, line.name, line.amount])).toEqual([
      ["pasarela", "Stripe", "3.20"],
      ["opcion", "Pago internacional", "1.50"],
    ]);
  });

  it("con «Pago rápido» y la plataforma al 5 %, se suman las tres: 3,20 + 1,50 + 1,50 + 5,00 = 11,20", async () => {
    const { user, b, international } = await withSurcharge();
    const id = await register(user, b, { extraIds: [b.extraId, international] });
    expect(await rowOf(id)).toMatchObject({ fees_total: "11.20", net_amount: "88.80" });
  });

  it("editar de nacional a internacional vuelve a calcular, y de vuelta a nacional también", async () => {
    const { user, b, international } = await withSurcharge();
    const id = await register(user, b, via([]));
    await editTx(user.client, id, { extraIds: [international] });
    expect(await rowOf(id)).toMatchObject({ fees_total: "4.70", net_amount: "95.30" });
    await editTx(user.client, id, { extraIds: [] });
    expect(await rowOf(id)).toMatchObject({ fees_total: "3.20", net_amount: "96.80" });
  });

  it("cambiar el recargo no mueve el cobro ya registrado; uno nuevo usa el nuevo (2 % + 0,10)", async () => {
    const { user, b, international } = await withSurcharge();
    const before = await register(user, b, via([international]));
    await saveInternational(user.client, { ...SAME_DAYS, id: international, gatewayId: b.gatewayId, pct: "2", fixed: "0.10" });
    expect(await rowOf(before)).toMatchObject({ fees_total: "4.70", net_amount: "95.30" });
    const after = await register(user, b, via([international]));
    expect(await rowOf(after)).toMatchObject({ fees_total: "5.30", net_amount: "94.70" });
  });
});

// ─── El camino del dinero ───────────────────────────────────────────────────────────────────────────────────

describe("transitTx, depositTx y revertDepositTx", () => {
  let user: TestUser;
  let b: Basics;

  const gatewayTotals = async () =>
    unwrap(
      await user.client
        .from("pay_gateway_totals")
        .select("tx_count, deposited_count, avg_days::text, median_days::text")
        .eq("gateway_id", b.gatewayId)
        .single(),
      "totales de la pasarela",
    );

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
  });

  it("depositTx en lote de 3: los 3 quedan depositados y cambia el promedio de días de la pasarela", async () => {
    const three = [await register(user, b), await register(user, b), await register(user, b)];
    expect(await gatewayTotals()).toEqual({ tx_count: 3, deposited_count: 0, avg_days: null, median_days: null });

    expect(await depositTx(user.client, three, MARTES)).toBe(3);

    for (const id of three) {
      expect(await rowOf(id)).toMatchObject({ status: "depositado", deposited_on: MARTES });
      expect(await eventKinds(id)).toEqual(["creado", "depositado"]);
    }
    // Del viernes 13 al martes 17: 4 días de calendario.
    expect(await gatewayTotals()).toEqual({ tx_count: 3, deposited_count: 3, avg_days: "4.00", median_days: "4.00" });

    // Con la misma fecha no hay nada que cambiar: no escribe ni deja evento.
    expect(await depositTx(user.client, three, MARTES)).toBe(0);
    expect(await eventKinds(three[0] as string)).toEqual(["creado", "depositado"]);

    // Con otra fecha, la corrige.
    expect(await depositTx(user.client, [three[0] as string], "2026-11-19")).toBe(1);
    expect(await gatewayTotals()).toMatchObject({ avg_days: "4.67" });
  });

  it("en un lote, los que no admiten el cambio se saltan y no cuentan; los demás se guardan", async () => {
    const pending = await register(user, b);
    const failed = await register(user, b);
    const trashed = await register(user, b);
    await failTx(user.client, failed);
    expect(await trashTx(user.client, [trashed])).toBe(1);

    const written = await depositTx(user.client, [pending, failed, trashed, randomUUID(), pending], MARTES);

    expect(written).toBe(1);
    expect(await rowOf(pending)).toMatchObject({ status: "depositado" });
    expect(await rowOf(failed)).toMatchObject({ status: "fallido", deposited_on: null });
    expect(await rowOf(trashed)).toMatchObject({ status: "registrado", deposited_on: null });
  });

  it("en el lote (solo lo por caer), uno ya depositado y uno en disputa se saltan: devuelve 1 y la fecha del depositado no cambia", async () => {
    const deposited = await register(user, b);
    expect(await depositTx(user.client, [deposited], VIERNES)).toBe(1);
    const disputed = await register(user, b);
    await disputeTx(user.client, disputed, { action: "abrir", on: "2026-11-16" });
    const pending = await register(user, b);

    expect(await depositTx(user.client, [deposited, disputed, pending], MARTES, { onlyPending: true })).toBe(1);

    expect(await rowOf(deposited)).toMatchObject({ status: "depositado", deposited_on: VIERNES });
    expect(await eventKinds(deposited)).toEqual(["creado", "depositado"]);
    expect(await rowOf(disputed)).toMatchObject({ status: "registrado", dispute_state: "abierta", deposited_on: null });
    expect(await rowOf(pending)).toMatchObject({ status: "depositado", deposited_on: MARTES });
  });

  it("depositTxWithSkips dice cuántos se saltaron y por qué", async () => {
    const deposited = await register(user, b);
    await depositTx(user.client, [deposited], VIERNES);
    const refunded = await register(user, b);
    await refundTx(user.client, refunded, { amount: "100.00", on: "2026-11-16" });
    const failed = await register(user, b);
    await failTx(user.client, failed);
    const pending = await register(user, b);
    const chosen = [deposited, refunded, failed, randomUUID(), pending, pending];

    expect(await depositTxWithSkips(user.client, chosen, MARTES, { onlyPending: true })).toEqual({
      count: 1,
      skipped: { deposited: 1, notPending: 1, other: 2 },
    });
    // Sin la marca (el detalle de un cobro) el ya depositado cambia de fecha.
    expect(await depositTxWithSkips(user.client, [deposited], "2026-11-19", { onlyPending: false })).toEqual({
      count: 1,
      skipped: { deposited: 0, notPending: 0, other: 0 },
    });
    expect(await rowOf(deposited)).toMatchObject({ deposited_on: "2026-11-19" });
  });

  it("transitTx pasa a «en tránsito» solo los registrados", async () => {
    const fresh = await register(user, b);
    const deposited = await register(user, b);
    await depositTx(user.client, [deposited], MARTES);

    expect(await transitTx(user.client, [fresh, deposited])).toBe(1);
    expect(await rowOf(fresh)).toMatchObject({ status: "en_transito" });
    expect(await rowOf(deposited)).toMatchObject({ status: "depositado" });
    // Ya está en tránsito: no hay nada que hacer.
    expect(await transitTx(user.client, [fresh])).toBe(0);
    expect(await eventKinds(fresh)).toEqual(["creado", "en_transito"]);
  });

  it("revertDepositTx devuelve el cobro a «en tránsito»; si no está depositado, lo dice", async () => {
    const id = await register(user, b);
    await depositTx(user.client, [id], MARTES);

    await revertDepositTx(user.client, id);

    expect(await rowOf(id)).toMatchObject({ status: "en_transito", deposited_on: null });
    expect(await eventKinds(id)).toEqual(["creado", "depositado", "deposito_revertido"]);
    await expectStateError(revertDepositTx(user.client, id), "no_depositado");
  });

  it("una lista vacía o de más de 500 cobros no se acepta", async () => {
    const tooMany = Array.from({ length: 501 }, () => randomUUID());
    await expectUserError(depositTx(user.client, [], MARTES), "Elige al menos un cobro.");
    await expectUserError(transitTx(user.client, tooMany), "Elige como máximo 500 cobros a la vez.");
    await expectUserError(trashTx(user.client, []), "Elige al menos un cobro.");
    await expectUserError(restoreTx(user.client, tooMany), "Elige como máximo 500 cobros a la vez.");
    await expectUserError(purgeTx(user.client, user.id, []), "Elige al menos un cobro.");
    await expectUserError(applyRecalcTx(user.client, tooMany, "hoy", TODAY), "Elige como máximo 500 cobros a la vez.");
    await expectUserError(previewRecalcTx(user.client, [], "hoy", TODAY), "Elige al menos un cobro.");
  });

  it("un lote de 500 cobros se guarda de una vez", async () => {
    const many = await createUser();
    const theirs = await seedBasics(many.client);
    const all = Array.from({ length: 500 }, () => randomUUID());
    // Altas con el motor y en un solo lote, para no hacer 500 viajes.
    const cfg = await loadPayConfig(many.client);
    await saveTx(
      many.client,
      all.map((id) => planCreate(cfg, e1(theirs, { id, grossOriginal: "1.00" }))),
    );

    expect(await depositTx(many.client, all, MARTES)).toBe(500);

    const { count } = await admin
      .from("pay_transactions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", many.id)
      .eq("status", "depositado");
    expect(count).toBe(500);
  });
});

// ─── Control optimista ──────────────────────────────────────────────────────────────────────────────────────

describe("conflicto optimista", () => {
  it("guardar sobre una lectura vieja se rechaza, con un mensaje en español, y no cambia nada", async () => {
    const user = await createUser();
    const b = await seedBasics(user.client);
    const id = await register(user, b);
    const [stale] = await getSnapshots(user.client, [id]);
    if (stale === undefined) throw new Error("No se leyó el cobro");
    // Mientras la pantalla seguía abierta, el cobro cambió.
    expect(await transitTx(user.client, [id])).toBe(1);
    const current = await rowOf(id);

    const error = await caught(saveTx(user.client, [planDeposit(stale, MARTES)]));

    expect(error).toMatchObject({ code: "40001" });
    expect(errorMessage(error)).toBe("Este cobro cambió mientras lo editabas: vuelve a abrirlo");
    expect(await rowOf(id)).toEqual(current);
    expect(await eventKinds(id)).toEqual(["creado", "en_transito"]);
  });
});

describe("lo que vio la persona (expectedUpdatedAt)", () => {
  let user: TestUser;
  let b: Basics;
  const CONFLICT = "Este cobro cambió mientras lo editabas: vuelve a abrirlo";

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
  });

  /** La versión del cobro que tiene la pantalla. */
  const seenOf = async (id: string): Promise<string> => (await rowOf(id)).updated_at;

  it("un reembolso reintentado tras un corte (con la versión que vio el diálogo) da conflicto y no se suma dos veces", async () => {
    const id = await register(user, b);
    const seen = await seenOf(id);
    const refund = { amount: "30.00", on: "2026-11-16" };

    // El primer envío llegó y se guardó, aunque la respuesta se perdiera.
    await refundTx(user.client, id, refund, seen);
    const afterFirst = await rowOf(id);
    const error = await caught(refundTx(user.client, id, refund, seen));

    expect(errorMessage(error)).toBe(CONFLICT);
    expect(await rowOf(id)).toEqual(afterFirst);
    expect(afterFirst).toMatchObject({ refunded_amount: "30.00", gross_amount: "70.00" });
    expect(await eventKinds(id)).toEqual(["creado", "reembolso"]);
  });

  it("una pestaña vieja no pisa la edición de otra: el monto que corrigió la otra se queda", async () => {
    const id = await register(user, b);
    const tabA = await seenOf(id);
    await editTx(user.client, id, { grossOriginal: "120.00" }, await seenOf(id));

    const error = await caught(editTx(user.client, id, { grossOriginal: "110.00" }, tabA));

    expect(errorMessage(error)).toBe(CONFLICT);
    expect(await rowOf(id)).toMatchObject({ gross_original: "120.00" });
  });

  it("cada acción de un solo cobro compara con lo que vio la persona; con la versión al día, guarda", async () => {
    const id = await register(user, b);
    const stale = await seenOf(id);
    await transitTx(user.client, [id]);
    const on = "2026-11-16";

    for (const attempt of [
      () => setRefundTotalTx(user.client, id, "10.00", stale),
      () => disputeTx(user.client, id, { action: "abrir", on }, stale),
      () => failTx(user.client, id, stale),
      () => setEstimatedTx(user.client, id, "2026-11-25", stale),
    ]) {
      expect(errorMessage(await caught(attempt()))).toBe(CONFLICT);
    }
    expect(await eventKinds(id)).toEqual(["creado", "en_transito"]);

    await setEstimatedTx(user.client, id, "2026-11-25", await seenOf(id));
    await failTx(user.client, id, await seenOf(id));
    const failedAt = await seenOf(id);
    await reopenTx(user.client, id, failedAt);
    expect(errorMessage(await caught(reopenTx(user.client, id, failedAt)))).toBe(PAY_STATE_TEXT.no_fallido);
    await depositTx(user.client, [id], MARTES);
    const depositedAt = await seenOf(id);
    await revertDepositTx(user.client, id, depositedAt);
    await depositTx(user.client, [id], MARTES);
    expect(errorMessage(await caught(revertDepositTx(user.client, id, depositedAt)))).toBe(CONFLICT);
    expect(await rowOf(id)).toMatchObject({ status: "depositado", estimated_deposit_on: "2026-11-25" });
  });

  it("depositar desde una pestaña vieja, tras abrir una disputa en otra, da conflicto: no se deposita", async () => {
    const id = await register(user, b);
    const tabA = await seenOf(id);
    await disputeTx(user.client, id, { action: "abrir", on: "2026-11-14" }, await seenOf(id));

    expect(errorMessage(await caught(depositOneTx(user.client, id, "2026-11-16", tabA)))).toBe(CONFLICT);
    expect(await rowOf(id)).toMatchObject({ status: "registrado", deposited_on: null, dispute_state: "abierta" });
    expect(await eventKinds(id)).toEqual(["creado", "disputa_abierta"]);
  });

  it("cambiar la fecha del depósito desde una pestaña vieja no pisa la fecha real que puso la otra", async () => {
    const id = await register(user, b);
    const tabA = await seenOf(id);
    expect(await depositOneTx(user.client, id, "2026-11-14", await seenOf(id))).toEqual({
      count: 1,
      skipped: { deposited: 0, notPending: 0, other: 0 },
    });

    expect(errorMessage(await caught(depositOneTx(user.client, id, "2026-11-18", tabA)))).toBe(CONFLICT);
    expect(await rowOf(id)).toMatchObject({ status: "depositado", deposited_on: "2026-11-14" });
    // Con la versión al día, sí cambia la fecha.
    await depositOneTx(user.client, id, "2026-11-18", await seenOf(id));
    expect(await rowOf(id)).toMatchObject({ deposited_on: "2026-11-18" });
    // La misma fecha otra vez no escribe: no cuenta como marcado.
    expect(await depositOneTx(user.client, id, "2026-11-18", await seenOf(id))).toEqual({
      count: 0,
      skipped: { deposited: 0, notPending: 0, other: 1 },
    });
  });

  it("depositar un solo cobro que no lo admite lo dice (no lo salta como el lote)", async () => {
    const id = await register(user, b);
    await failTx(user.client, id);
    await expectStateError(depositOneTx(user.client, id, "2026-11-16", await seenOf(id)), "fallido");
  });

  it("los lotes siguen sin versión: solo lo que está por caer, aunque la lista se haya visto antes de un cambio", async () => {
    const pending = await register(user, b);
    const disputed = await register(user, b);
    await disputeTx(user.client, disputed, { action: "abrir", on: "2026-11-14" });

    expect(await depositTxWithSkips(user.client, [pending, disputed], "2026-11-16", { onlyPending: true })).toEqual({
      count: 1,
      skipped: { deposited: 0, notPending: 1, other: 0 },
    });
  });

  it("recalcular desde una pestaña vieja da conflicto; con la versión al día, recalcula", async () => {
    const id = await register(user, b);
    const tabA = await seenOf(id);
    unwrap(
      await user.client
        .from("pay_gateway_fee_versions")
        .insert({ gateway_id: b.gatewayId, pct: "3.5", fixed: "0.30", effective_from: "2026-11-14" })
        .select("id")
        .single(),
      "tarifa nueva",
    );
    await editTx(user.client, id, { note: "Cambiada en otra pestaña" }, await seenOf(id));

    expect(errorMessage(await caught(applyRecalcOneTx(user.client, id, "hoy", TODAY, tabA)))).toBe(CONFLICT);
    expect(await rowOf(id)).toMatchObject({ fees_total: "9.70" });

    expect(await applyRecalcOneTx(user.client, id, "hoy", TODAY, await seenOf(id))).toBe(1);
    expect(await rowOf(id)).toMatchObject({ fees_total: "10.30" });
    expect(await applyRecalcOneTx(user.client, id, "hoy", TODAY, await seenOf(id))).toBe(0);
    expect(await eventKinds(id)).toEqual(["creado", "editado", "recalculado"]);
  });
});

// ─── Fechas estimadas con la configuración de ahora ─────────────────────────────────────────────────────────

describe("refreshEstimatesTx", () => {
  it("tras agregar un feriado mueve la fecha automática de lo que está por caer, sin tocar comisiones ni lo puesto a mano", async () => {
    const user = await createUser();
    const b = await seedBasics(user.client);
    // Stripe sin «Pago rápido»: 2 días hábiles desde el viernes 13 → martes 17.
    const automatic = await register(user, b, { extraIds: [] });
    const manual = await register(user, b, { extraIds: [] });
    await setEstimatedTx(user.client, manual, "2026-11-25");
    const deposited = await register(user, b, { extraIds: [] });
    await depositTx(user.client, [deposited], MARTES);
    const disputed = await register(user, b, { extraIds: [] });
    await disputeTx(user.client, disputed, { action: "abrir", on: "2026-11-16" });
    const before = await rowOf(automatic);
    expect(before).toMatchObject({ estimated_deposit_on: MARTES });

    await addHoliday(user.client, { day: "2026-11-16", name: "Feriado de prueba" });
    // Solo los de otra pasarela: ninguno.
    expect(await refreshEstimatesTx(user.client, { gatewayId: randomUUID() })).toBe(0);
    expect(await refreshEstimatesTx(user.client)).toBe(1);

    expect(await rowOf(automatic)).toMatchObject({
      estimated_deposit_on: "2026-11-18",
      estimated_is_manual: false,
      fees_total: before.fees_total,
      net_amount: before.net_amount,
    });
    expect(await eventKinds(automatic)).toEqual(["creado", "fecha_estimada"]);
    // El historial dice que la cambió la app, no la persona.
    const [refreshed] = unwrap(
      await admin
        .from("pay_transaction_events")
        .select("summary")
        .eq("transaction_id", automatic)
        .eq("kind", "fecha_estimada"),
      "evento de la fecha estimada",
    );
    expect(refreshed?.summary).toBe(ESTIMATE_REFRESH_SUMMARY);
    expect(await rowOf(manual)).toMatchObject({ estimated_deposit_on: "2026-11-25", estimated_is_manual: true });
    expect(await rowOf(deposited)).toMatchObject({ estimated_deposit_on: MARTES });
    expect(await rowOf(disputed)).toMatchObject({ estimated_deposit_on: MARTES });
    // Ya al día: nada que escribir.
    expect(await refreshEstimatesTx(user.client, { gatewayId: b.gatewayId })).toBe(0);
    expect(await refreshEstimatesAfterTx(user.client)).toBe(0);
  });

  it("con la empresa, solo los cobros de esa pasarela en esa empresa (los días de su cuenta en la empresa)", async () => {
    const user = await createUser();
    const b = await seedBasics(user.client);
    const otherCompany = unwrap(
      await user.client.from("pay_companies").insert({ name: "Tienda Demo" }).select("id").single(),
      "otra empresa",
    );
    const here = await register(user, b, { extraIds: [] });
    const there = await register(user, b, { extraIds: [], companyId: otherCompany.id, channelId: null });
    // La cuenta de Stripe en «Escuela Demo» pasa a tardar 1 día hábil: viernes 13 → lunes 16.
    unwrap(
      await user.client
        .from("pay_company_gateways")
        .update({ payout_days_override: 1 })
        .eq("id", b.companyGatewayId)
        .select("id")
        .single(),
      "días de la cuenta",
    );

    expect(await refreshEstimatesTx(user.client, { gatewayId: b.gatewayId, companyId: otherCompany.id })).toBe(0);
    expect(await refreshEstimatesTx(user.client, { gatewayId: b.gatewayId, companyId: b.companyId })).toBe(1);
    expect(await rowOf(here)).toMatchObject({ estimated_deposit_on: "2026-11-16" });
    expect(await rowOf(there)).toMatchObject({ estimated_deposit_on: MARTES });
  });

  it("los cobros que dejan las pruebas con e1Item se leen y se recalculan como cualquier otro", async () => {
    const user = await createUser();
    const b = await seedBasics(user.client);
    const [saved] = await saveTransactions(user.client, [e1Item(b, { estimated_deposit_on: "2026-11-20" })]);
    expect(await refreshEstimatesAfterTx(user.client)).toBe(1);
    expect(await rowOf(saved?.id ?? "")).toMatchObject({ estimated_deposit_on: VIERNES });
  });

  it("refreshEstimatesAfterTx: si no se puede recalcular, devuelve null y lo deja en el registro, sin lanzar", async () => {
    const user = await createUser();
    const b = await seedBasics(user.client);
    // Un cobro guardado a mano con un desglose a medias: no se puede leer como cobro.
    await saveTransactions(user.client, [e1Item(b, { breakdown: { v: 1, currency: "USD" } })]);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await refreshEstimatesAfterTx(user.client)).toBeNull();
      expect(logged).toHaveBeenCalledWith("[refreshEstimatesTx]", expect.anything());
    } finally {
      logged.mockRestore();
    }
  });
});

// ─── Guardar por lotes ──────────────────────────────────────────────────────────────────────────────────────

describe("saveTx", () => {
  let user: TestUser;
  let b: Basics;
  /** Un cobro ya guardado con la referencia «ch_demo_ya_estaba». */
  let existing: string;

  const countRows = async (): Promise<number | null> =>
    (await admin.from("pay_transactions").select("id", { count: "exact", head: true }).eq("user_id", user.id)).count;

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
    existing = await register(user, b, { reference: "ch_demo_ya_estaba" });
  });

  it("sin escrituras no hay nada que guardar", async () => {
    expect(await saveTx(user.client, [])).toEqual([]);
  });

  it("una referencia repetida tumba el lote entero: no entra ninguno de sus cobros", async () => {
    const cfg = await loadPayConfig(user.client);
    const writes = [
      planCreate(cfg, e1(b, { reference: "ch_demo_nueva_1" })),
      planCreate(cfg, e1(b, { reference: "ch_demo_ya_estaba" })),
    ];

    const error = await caught(saveTx(user.client, writes));

    expect(errorMessage(error)).toBe("Ya hay un cobro de esa pasarela con esa referencia.");
    expect(await countRows()).toBe(1);
  });

  it("con skipDuplicates (importación) la repetida se salta y dice cuál es el cobro que ya estaba; el resto entra, en orden", async () => {
    const cfg = await loadPayConfig(user.client);
    const writes = [
      planCreate(cfg, e1(b, { reference: "ch_demo_nueva_1" })),
      planCreate(cfg, e1(b, { reference: "ch_demo_ya_estaba" })),
      planCreate(cfg, e1(b, { reference: "ch_demo_nueva_2" })),
    ];

    const results = await saveTx(user.client, writes, { skipDuplicates: true });

    expect(results).toEqual([
      { id: writes[0]?.id, inserted: true, skipped: false },
      { id: existing, inserted: false, skipped: true },
      { id: writes[2]?.id, inserted: true, skipped: false },
    ]);
    expect(await countRows()).toBe(3);
    // El que ya estaba no se tocó.
    expect(await eventKinds(existing)).toEqual(["creado"]);
  });

  it("más de 500 escrituras van en lotes de 500: si falla el segundo, el primero ya quedó escrito", async () => {
    const cfg = await loadPayConfig(user.client);
    const before = (await countRows()) ?? 0;
    const writes = Array.from({ length: 501 }, (_, i) =>
      planCreate(
        cfg,
        // La última, la única del segundo lote, repite una referencia.
        e1(b, { grossOriginal: "1.00", reference: i === 500 ? "ch_demo_ya_estaba" : `ch_demo_lote_${i}` }),
      ),
    );

    const error = await caught(saveTx(user.client, writes));

    expect(error).toMatchObject({ code: "23505" });
    expect(await countRows()).toBe(before + 500);
    expect(
      unwrap(
        await admin
          .from("pay_transactions")
          .select("id")
          .eq("id", writes[500]?.id ?? ""),
        "último",
      ),
    ).toEqual([]);
  });
});

// ─── Papelera ───────────────────────────────────────────────────────────────────────────────────────────────

describe("trashTx, restoreTx y purgeTx", () => {
  let user: TestUser;
  let b: Basics;

  const companyTotals = async () =>
    unwrap(
      await user.client
        .from("pay_company_totals")
        .select("tx_count, gross::text, net::text")
        .eq("company_id", b.companyId),
      "totales de la empresa",
    );
  const balanceOfA = async () =>
    unwrap(
      await user.client
        .from("pay_beneficiary_balances")
        .select("assigned::text")
        .eq("beneficiary_id", b.beneficiaryIds.a),
      "saldo",
    );

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
  });

  it("la papelera saca el cobro de listas, totales y saldos; restaurar lo devuelve", async () => {
    const kept = await register(user, b);
    const gone = await register(user, b);
    expect(await companyTotals()).toEqual([{ tx_count: 2, gross: "200.00", net: "180.60" }]);
    expect(await balanceOfA()).toEqual([{ assigned: "90.30" }]);

    expect(await trashTx(user.client, [gone])).toBe(1);

    expect((await rowOf(gone)).deleted_at).not.toBeNull();
    expect(ids((await listTx(user.client, ALL, "fecha_desc", 1, TODAY)).rows)).toEqual([kept]);
    expect(ids(await leanTx(user.client, ALL, TODAY))).toEqual([kept]);
    expect(await companyTotals()).toEqual([{ tx_count: 1, gross: "100.00", net: "90.30" }]);
    expect(await balanceOfA()).toEqual([{ assigned: "45.15" }]);
    // En la papelera sí aparece, y solo él.
    const trash = await listTx(user.client, { trashed: true }, "fecha_desc", 1, TODAY);
    expect(ids(trash.rows)).toEqual([gone]);
    expect(trash.total).toBe(1);
    expect(trash.rows[0]?.deletedAt).not.toBeNull();
    // Un cobro en la papelera no admite cambios, y no se manda dos veces.
    await expectStateError(refundTx(user.client, gone, { amount: "1.00", on: VIERNES }), "en_papelera");
    expect(await trashTx(user.client, [gone, kept])).toBe(1);
    expect(await restoreTx(user.client, [kept])).toBe(1);

    expect(await restoreTx(user.client, [gone, kept])).toBe(1);

    expect((await rowOf(gone)).deleted_at).toBeNull();
    expect(ids(await leanTx(user.client, ALL, TODAY)).sort()).toEqual([kept, gone].sort());
    expect(await companyTotals()).toEqual([{ tx_count: 2, gross: "200.00", net: "180.60" }]);
    expect(await balanceOfA()).toEqual([{ assigned: "90.30" }]);
    expect(await eventKinds(gone)).toEqual(["creado", "a_papelera", "restaurado"]);
  });

  it("purgeTx borra del todo un cobro de la papelera: la fila, su reparto, su historial y sus archivos", async () => {
    const id = await register(user, b);
    const folder = `${user.id}/${id}`;
    await upload(user.client, `${folder}/recibo.png`);
    await upload(user.client, `${folder}/factura.pdf`, "application/pdf");
    // Un archivo que se subió pero no llegó a registrarse también se va.
    await upload(user.client, `${folder}/suelto.png`);
    await registerReceipt(user.client, user.id, {
      transactionId: id,
      path: `${folder}/recibo.png`,
      mime: "image/png",
      sizeBytes: PNG.length,
    });
    await registerReceipt(user.client, user.id, {
      transactionId: id,
      path: `${folder}/factura.pdf`,
      mime: "application/pdf",
      sizeBytes: PNG.length,
    });
    await trashTx(user.client, [id]);

    expect(await purgeTx(user.client, user.id, [id])).toBe(1);

    expect(await filesIn(folder)).toEqual([]);
    for (const table of ["pay_allocations", "pay_transaction_receipts", "pay_transaction_events"] as const) {
      expect(unwrap(await admin.from(table).select("id").eq("transaction_id", id), table)).toEqual([]);
    }
    expect(unwrap(await admin.from("pay_transactions").select("id").eq("id", id), "cobro")).toEqual([]);
    // Ya no existe: volver a pedirlo no hace nada.
    expect(await purgeTx(user.client, user.id, [id])).toBe(0);
  });

  it("purgeTx solo borra lo que está en la papelera: los demás se saltan, con sus archivos", async () => {
    const live = await register(user, b);
    const trashed = await register(user, b);
    await upload(user.client, `${user.id}/${live}/recibo.png`);
    await trashTx(user.client, [trashed]);

    expect(await purgeTx(user.client, user.id, [live, trashed, randomUUID()])).toBe(1);

    expect(await rowOf(live)).toMatchObject({ status: "registrado", deleted_at: null });
    expect(await filesIn(`${user.id}/${live}`)).toEqual(["recibo.png"]);
    expect(unwrap(await admin.from("pay_transactions").select("id").eq("id", trashed), "cobro")).toEqual([]);
  });

  it("si Storage no borra todos los archivos, la fila no se borra", async () => {
    const id = await register(user, b);
    const folder = `${user.id}/${id}`;
    await upload(user.client, `${folder}/recibo.png`);
    await trashTx(user.client, [id]);
    // El cliente real, salvo `remove`, que responde como responde Storage cuando no borra nada: lista vacía y sin error.
    const stuck = new Proxy(user.client, {
      get(target, property, receiver) {
        if (property !== "storage") return Reflect.get(target, property, receiver) as unknown;
        return {
          from: (bucket: string) => {
            const real = target.storage.from(bucket);
            return { list: real.list.bind(real), remove: () => Promise.resolve({ data: [], error: null }) };
          },
        };
      },
    });

    await expectUserError(
      purgeTx(stuck, user.id, [id]),
      "No se pudieron borrar los comprobantes de un cobro. Ese cobro sigue en la papelera: inténtalo de nuevo.",
    );

    expect((await rowOf(id)).deleted_at).not.toBeNull();
    expect(await filesIn(folder)).toEqual(["recibo.png"]);
    // Con Storage respondiendo bien, se termina de borrar.
    expect(await purgeTx(user.client, user.id, [id])).toBe(1);
    expect(await filesIn(folder)).toEqual([]);
  });

  it("purgeTx no deja archivos huérfanos si le pasan el id de otro usuario: no borra nada", async () => {
    const other = await createUser();
    const id = await register(user, b);
    await upload(user.client, `${user.id}/${id}/recibo.png`);
    await trashTx(user.client, [id]);

    const error = await caught(purgeTx(user.client, other.id, [id]));

    expect(error).toBeInstanceOf(Error);
    expect((await rowOf(id)).deleted_at).not.toBeNull();
    expect(await filesIn(`${user.id}/${id}`)).toEqual(["recibo.png"]);
  });
});

// ─── Comprobantes ───────────────────────────────────────────────────────────────────────────────────────────

describe("registerReceipt, removeReceipt y receiptSignedUrl", () => {
  let user: TestUser;
  let b: Basics;
  let txId: string;
  let folder: string;

  const receiptRows = async () =>
    unwrap(
      await admin
        .from("pay_transaction_receipts")
        .select("id, path, mime, size_bytes")
        .eq("transaction_id", txId)
        .order("created_at"),
      "comprobantes",
    );

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
    txId = await register(user, b);
    folder = `${user.id}/${txId}`;
    await upload(user.client, `${folder}/recibo.png`);
  });

  it("registra un archivo que ya está subido, y el cobro lo cuenta", async () => {
    const receipt = {
      transactionId: txId,
      path: `${folder}/recibo.png`,
      mime: "image/png",
      sizeBytes: PNG.length,
    };

    const id = await registerReceipt(user.client, user.id, receipt);

    expect(await receiptRows()).toEqual([
      { id, path: `${folder}/recibo.png`, mime: "image/png", size_bytes: PNG.length },
    ]);
    expect(await rowOf(txId)).toMatchObject({ receipts_count: 1 });
    expect(ids((await listTx(user.client, { receipt: "con" }, "fecha_desc", 1, TODAY)).rows)).toEqual([txId]);
    expect((await listTx(user.client, { receipt: "sin" }, "fecha_desc", 1, TODAY)).rows).toEqual([]);
    // El mismo archivo no se registra dos veces.
    expect(errorMessage(await caught(registerReceipt(user.client, user.id, receipt)))).toBe(
      "Ya existe un registro con esos datos.",
    );
  });

  it("no registra una ruta que no sea de ese usuario y de ese cobro", async () => {
    const other = await createUser();
    const base = { transactionId: txId, mime: "image/png", sizeBytes: PNG.length };
    const text = "El comprobante no corresponde a ese cobro.";

    await expectUserError(
      registerReceipt(user.client, user.id, { ...base, path: `${other.id}/${txId}/recibo.png` }),
      text,
    );
    await expectUserError(
      registerReceipt(user.client, user.id, { ...base, path: `${user.id}/${randomUUID()}/recibo.png` }),
      text,
    );
    await expectUserError(registerReceipt(user.client, user.id, { ...base, path: `${folder}/` }), text);
    await expectUserError(registerReceipt(user.client, user.id, { ...base, path: `${folder}/sub/recibo.png` }), text);
    await expectUserError(
      registerReceipt(user.client, user.id, { ...base, path: `${folder}/../${txId}/recibo.png` }),
      text,
    );
    await expectUserError(registerReceipt(user.client, user.id, { ...base, path: `/${folder}/recibo.png` }), text);
  });

  it("no registra un tipo que no se admite ni un tamaño fuera de 1 byte a 10 MB", async () => {
    const base = { transactionId: txId, path: `${folder}/recibo.png` };

    await expectUserError(
      registerReceipt(user.client, user.id, { ...base, mime: "image/gif", sizeBytes: 100 }),
      "Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.",
    );
    await expectUserError(
      registerReceipt(user.client, user.id, { ...base, mime: "image/png", sizeBytes: 10 * 1024 * 1024 + 1 }),
      "El archivo pesa más de 10 MB.",
    );
    for (const sizeBytes of [0, -1, 1.5, Number.NaN]) {
      await expectUserError(
        registerReceipt(user.client, user.id, { ...base, mime: "image/png", sizeBytes }),
        "El tamaño del archivo no es válido.",
      );
    }
  });

  it("no registra un archivo que no está en Storage", async () => {
    const missing = {
      transactionId: txId,
      path: `${folder}/no-subido.png`,
      mime: "image/png",
      sizeBytes: 100,
    };

    await expectUserError(
      registerReceipt(user.client, user.id, missing),
      "El archivo no llegó a subirse. Vuelve a intentarlo.",
    );
    // Tampoco vale un nombre que solo se parece al de un archivo que sí está.
    await expectUserError(
      registerReceipt(user.client, user.id, { ...missing, path: `${folder}/recibo` }),
      "El archivo no llegó a subirse. Vuelve a intentarlo.",
    );
    expect(await receiptRows()).toHaveLength(1);
  });

  it("firma una URL de 60 segundos que descarga el archivo sin sesión", async () => {
    const [receipt] = await receiptRows();
    if (receipt === undefined) throw new Error("No hay comprobante registrado");

    const url = await receiptSignedUrl(user.client, receipt.id);

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
    const token = new URL(url).searchParams.get("token") ?? "";
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
      iat: number;
      exp: number;
    };
    expect(claims.exp - claims.iat).toBe(60);
    await expectUserError(receiptSignedUrl(user.client, randomUUID()), "Ese comprobante ya no existe.");
  });

  it("el comprobante de otro usuario no se firma ni se quita", async () => {
    const other = await createUser();
    const [receipt] = await receiptRows();
    if (receipt === undefined) throw new Error("No hay comprobante registrado");

    await expectUserError(receiptSignedUrl(other.client, receipt.id), "Ese comprobante ya no existe.");
    await expectUserError(removeReceipt(other.client, receipt.id), "Ese comprobante ya no existe.");
    expect(await filesIn(folder)).toEqual(["recibo.png"]);
    expect(await receiptRows()).toHaveLength(1);
  });

  it("quitar un comprobante borra el archivo y la fila, y el cobro deja de contarlo", async () => {
    const [receipt] = await receiptRows();
    if (receipt === undefined) throw new Error("No hay comprobante registrado");

    await removeReceipt(user.client, receipt.id);

    expect(await filesIn(folder)).toEqual([]);
    expect(await receiptRows()).toEqual([]);
    expect(await rowOf(txId)).toMatchObject({ receipts_count: 0 });
    await expectUserError(removeReceipt(user.client, receipt.id), "Ese comprobante ya no existe.");
  });

  it("si el archivo ya no estaba (un borrado que quedó a medias), quita la fila igual", async () => {
    await upload(user.client, `${folder}/a-medias.png`);
    const id = await registerReceipt(user.client, user.id, {
      transactionId: txId,
      path: `${folder}/a-medias.png`,
      mime: "image/png",
      sizeBytes: PNG.length,
    });
    const removed = await user.client.storage.from(BUCKET).remove([`${folder}/a-medias.png`]);
    expect(removed.data).toHaveLength(1);

    await removeReceipt(user.client, id);

    expect(await receiptRows()).toEqual([]);
  });
});

// ─── Recalcular ─────────────────────────────────────────────────────────────────────────────────────────────

describe("previewRecalcTx y applyRecalcTx", () => {
  let user: TestUser;
  let b: Basics;

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
  });

  it("con la tarifa de hoy: enseña el antes y el después, y al aplicar guarda los números nuevos", async () => {
    const id = await register(user, b);
    // Stripe sube a 3,5 % + 0,30 desde el sábado 14: el cobro del viernes 13 se registró con 2,9 %.
    unwrap(
      await user.client
        .from("pay_gateway_fee_versions")
        .insert({ gateway_id: b.gatewayId, pct: "3.5", fixed: "0.30", effective_from: "2026-11-14" })
        .select("id")
        .single(),
      "tarifa nueva",
    );

    // Con la tarifa que correspondía a la fecha del cobro no cambia nada.
    expect(await previewRecalcTx(user.client, [id], "fecha_del_cobro", TODAY)).toEqual({ items: [], unchanged: 1 });
    expect(await applyRecalcTx(user.client, [id], "fecha_del_cobro", TODAY)).toBe(0);
    expect(await eventKinds(id)).toEqual(["creado"]);

    const preview = await previewRecalcTx(user.client, [id], "hoy", TODAY);

    expect(preview).toEqual({
      items: [
        {
          id,
          label: "vie 13 nov 2026 · $100,00 · Stripe",
          changes: [
            { key: `line:pasarela:${b.gatewayId}`, label: "Stripe", before: "3.20", after: "3.80" },
            { key: "feesTotal", label: "Comisiones", before: "9.70", after: "10.30" },
            { key: "net", label: "Neto", before: "90.30", after: "89.70" },
            { key: `alloc:${b.beneficiaryIds.a}`, label: "Grupo A", before: "45.15", after: "44.85" },
            { key: `alloc:${b.beneficiaryIds.b}`, label: "Grupo B", before: "27.09", after: "26.91" },
            { key: `alloc:${b.beneficiaryIds.c}`, label: "Grupo C", before: "18.06", after: "17.94" },
          ],
        },
      ],
      unchanged: 0,
    });
    // La vista previa no escribe.
    expect(await rowOf(id)).toMatchObject({ fees_total: "9.70", net_amount: "90.30" });

    expect(await applyRecalcTx(user.client, [id], "hoy", TODAY)).toBe(1);

    expect(await rowOf(id)).toMatchObject({ fees_total: "10.30", net_amount: "89.70", alloc_base_amount: "89.70" });
    expect(await sharesOf(id, b)).toEqual(["44.85", "26.91", "17.94"]);
    expect(await eventKinds(id)).toEqual(["creado", "recalculado"]);
    // Ya está al día: recalcular otra vez no escribe.
    expect(await previewRecalcTx(user.client, [id], "hoy", TODAY)).toEqual({ items: [], unchanged: 1 });
    expect(await applyRecalcTx(user.client, [id], "hoy", TODAY)).toBe(0);
    expect(await eventKinds(id)).toEqual(["creado", "recalculado"]);
  });

  it("si solo cambia la fecha estimada, se enseña en una fila «Fecha estimada» y se guarda", async () => {
    const other = await createUser();
    const theirs = await seedBasics(other.client);
    const id = await register(other, theirs, { extraIds: [] });
    const manual = await register(other, theirs, { extraIds: [], estimatedDepositOn: "2026-11-30" });
    expect(await rowOf(id)).toMatchObject({ estimated_deposit_on: MARTES });
    // Stripe pasa a tardar 3 días hábiles: los números no cambian, la fecha sí.
    unwrap(
      await other.client
        .from("pay_gateways")
        .update({ payout_days: 3 })
        .eq("id", theirs.gatewayId)
        .select("id")
        .single(),
      "días de depósito",
    );

    const preview = await previewRecalcTx(other.client, [id, manual], "fecha_del_cobro", TODAY);

    expect(preview).toEqual({
      items: [
        {
          id,
          label: "vie 13 nov 2026 · $100,00 · Stripe",
          changes: [{ key: "estimatedDepositOn", label: "Fecha estimada", before: MARTES, after: "2026-11-18" }],
        },
      ],
      // La fecha puesta a mano no se pisa: ese cobro queda igual.
      unchanged: 1,
    });

    expect(await applyRecalcTx(other.client, [id, manual], "fecha_del_cobro", TODAY)).toBe(1);

    expect(await rowOf(id)).toMatchObject({ estimated_deposit_on: "2026-11-18", net_amount: "91.80" });
    expect(await rowOf(manual)).toMatchObject({ estimated_deposit_on: "2026-11-30", estimated_is_manual: true });
    expect(await eventKinds(id)).toEqual(["creado", "recalculado"]);
    expect(await eventKinds(manual)).toEqual(["creado"]);
  });

  it("los cobros que no se pueden recalcular (fallidos, en la papelera) se saltan en la vista previa y al aplicar", async () => {
    const other = await createUser();
    const theirs = await seedBasics(other.client);
    const ok = await register(other, theirs);
    const failed = await register(other, theirs);
    const trashed = await register(other, theirs);
    await failTx(other.client, failed);
    await trashTx(other.client, [trashed]);
    unwrap(
      await other.client
        .from("pay_gateway_fee_versions")
        .insert({ gateway_id: theirs.gatewayId, pct: "3.5", fixed: "0.30", effective_from: "2026-11-14" })
        .select("id")
        .single(),
      "tarifa nueva",
    );

    const preview = await previewRecalcTx(other.client, [ok, failed, trashed], "hoy", TODAY);

    expect(preview.items.map((item) => item.id)).toEqual([ok]);
    expect(preview.unchanged).toBe(0);
    expect(await applyRecalcTx(other.client, [ok, failed, trashed], "hoy", TODAY)).toBe(1);
    expect(await eventKinds(failed)).toEqual(["creado", "fallido"]);
    expect(await eventKinds(trashed)).toEqual(["creado", "a_papelera"]);
  });
});

// ─── Lecturas ───────────────────────────────────────────────────────────────────────────────────────────────

describe("getTx, getSnapshots y lastTx", () => {
  let user: TestUser;
  let b: Basics;

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
  });

  it("lastTx: sin cobros no hay último", async () => {
    expect(await lastTx(user.client)).toBeNull();
  });

  it("getTx trae el cobro con su reparto en orden, sus comprobantes y su historial del más reciente al más antiguo", async () => {
    const id = await register(user, b, { reference: "ch_demo_detalle" });
    await upload(user.client, `${user.id}/${id}/recibo.png`);
    const receiptId = await registerReceipt(user.client, user.id, {
      transactionId: id,
      path: `${user.id}/${id}/recibo.png`,
      mime: "image/png",
      sizeBytes: PNG.length,
    });
    await transitTx(user.client, [id]);
    await depositTx(user.client, [id], MARTES);

    const detail = await getTx(user.client, id);

    expect(detail).toMatchObject({
      id,
      occurredOn: VIERNES,
      companyId: b.companyId,
      channelId: b.channelId,
      gatewayId: b.gatewayId,
      bankAccountId: b.bankAccountId,
      schemeId: b.schemeId,
      currency: "USD",
      grossOriginal: "100.00",
      refunded: "0.00",
      gross: "100.00",
      fees: "9.70",
      net: "90.30",
      status: "depositado",
      disputeState: null,
      estimatedDepositOn: VIERNES,
      estimatedIsManual: false,
      depositedOn: MARTES,
      receiptsCount: 1,
      reference: "ch_demo_detalle",
      note: null,
      deletedAt: null,
    });
    expect(Date.parse(detail?.occurredAt ?? "")).toBe(Date.parse(VIERNES_10_30));
    expect(detail?.breakdown).toMatchObject({
      v: 1,
      currency: "USD",
      feesTotal: "9.70",
      net: "90.30",
      rules: { gateway: { name: "Stripe", pct: "2.9", fixed: "0.30" }, platform: { pct: "5" } },
    });
    expect(detail?.breakdown.lines.map((line) => [line.kind, line.amount])).toEqual([
      ["pasarela", "3.20"],
      ["opcion", "1.50"],
      ["plataforma", "5.00"],
    ]);
    expect(detail?.allocations).toEqual([
      { beneficiaryId: b.beneficiaryIds.a, amount: "45.15", pct: "50", isRemainder: false },
      { beneficiaryId: b.beneficiaryIds.b, amount: "27.09", pct: "30", isRemainder: false },
      { beneficiaryId: b.beneficiaryIds.c, amount: "18.06", pct: "20", isRemainder: false },
    ]);
    expect(detail?.receipts).toEqual([
      {
        id: receiptId,
        path: `${user.id}/${id}/recibo.png`,
        mime: "image/png",
        sizeBytes: PNG.length,
        createdAt: expect.any(String) as string,
      },
    ]);
    expect(detail?.events.map((event) => event.kind)).toEqual([
      "depositado",
      "en_transito",
      "comprobante_agregado",
      "creado",
    ]);
    expect(detail?.events[0]).toMatchObject({
      summary: "Depositado el mar 17 nov 2026",
      data: { antes: { estado: "en_transito" }, despues: { estado: "depositado", depositadoEl: MARTES } },
    });
  });

  it("getTx: un id que no existe, que no es un uuid o que es de otro usuario da null", async () => {
    const other = await createUser();
    const id = await register(user, b);

    expect(await getTx(user.client, randomUUID())).toBeNull();
    expect(await getTx(user.client, "no-es-un-uuid")).toBeNull();
    expect(await getTx(other.client, id)).toBeNull();
    // También trae un cobro que está en la papelera: su pantalla tiene que poder abrirlo.
    await trashTx(user.client, [id]);
    expect((await getTx(user.client, id))?.deletedAt).not.toBeNull();
  });

  it("getSnapshots devuelve los cobros pedidos en el orden pedido, sin los que no existen", async () => {
    const first = await register(user, b, { grossOriginal: "10.00" });
    const second = await register(user, b, { grossOriginal: "20.00" });
    const third = await register(user, b, { grossOriginal: "30.00" });

    const snapshots = await getSnapshots(user.client, [third, randomUUID(), first, second, third]);

    expect(snapshots.map((tx) => [tx.id, tx.grossOriginal])).toEqual([
      [third, "30.00"],
      [first, "10.00"],
      [second, "20.00"],
    ]);
    expect(snapshots[0]?.breakdown.state).toEqual({
      grossOriginal: "30.00",
      refunded: "0.00",
      dispute: null,
      failed: false,
      feesPaidBy: "nosotros",
    });
    expect(await getSnapshots(user.client, [])).toEqual([]);
  });

  it("getSnapshots con 500 ids no se queda corto ni se pasa del largo de una URL", async () => {
    const real = await register(user, b);
    const many = [...Array.from({ length: 499 }, () => randomUUID()), real];

    expect(ids(await getSnapshots(user.client, many))).toEqual([real]);
  });

  it("lastTx es el último cobro registrado que no está en la papelera", async () => {
    const older = await register(user, b, {
      occurredAt: "2026-11-19T15:30:00Z",
      occurredOn: "2026-11-19",
      note: "El de fecha más nueva",
    });
    const newest = await register(user, b, {
      occurredAt: "2026-10-01T15:30:00Z",
      occurredOn: "2026-10-01",
      note: "El último que se registró",
    });

    const last = await lastTx(user.client);
    expect(last?.id).toBe(newest);
    expect(last?.breakdown.rules.gateway.name).toBe("Stripe");

    await trashTx(user.client, [newest]);
    expect((await lastTx(user.client))?.id).toBe(older);
  });
});

describe("listTx: órdenes, páginas y búsqueda", () => {
  let user: TestUser;
  let b: Basics;
  let small: string;
  let medium: string;
  let large: string;

  const order = async (sort: Parameters<typeof listTx>[2], filters: TxFilters = ALL) =>
    ids((await listTx(user.client, filters, sort, 1, TODAY)).rows);
  const search = async (q: string) => ids((await listTx(user.client, { q }, "fecha_asc", 1, TODAY)).rows);

  beforeAll(async () => {
    user = await createUser();
    b = await seedBasics(user.client);
    // Tres cobros con fechas, montos y fechas estimadas que ordenan distinto.
    small = await register(user, b, {
      grossOriginal: "5.00",
      occurredAt: "2026-11-10T15:00:00Z",
      occurredOn: "2026-11-10",
      estimatedDepositOn: "2026-11-30",
      reference: "ch_demo.1:2/3#4@5-6 x",
      note: "Pagó en efectivo (raro), con coma",
    });
    medium = await register(user, b, {
      grossOriginal: "1234.56",
      occurredAt: "2026-11-12T15:00:00Z",
      occurredOn: "2026-11-12",
      estimatedDepositOn: "2026-11-14",
      reference: "chXdemoY",
      channelId: null,
    });
    large = await register(user, b, {
      grossOriginal: "20000.00",
      occurredAt: "2026-11-11T15:00:00Z",
      occurredOn: "2026-11-11",
      reference: null,
      note: "Matrícula Ñandú",
    });
    // Sin fecha estimada (un cobro viejo, importado sin ella): va al final al ordenar por fecha estimada.
    unwrap(
      await admin.from("pay_transactions").update({ estimated_deposit_on: null }).eq("id", large).select("id").single(),
      "sin fecha estimada",
    );
  });

  it("ordena por fecha, por monto (como número, no como texto) y por fecha estimada con los vacíos al final", async () => {
    expect(await order("fecha_desc")).toEqual([medium, large, small]);
    expect(await order("fecha_asc")).toEqual([small, large, medium]);
    expect(await order("monto_desc")).toEqual([large, medium, small]);
    expect(await order("monto_asc")).toEqual([small, medium, large]);
    expect(await order("estimada_asc")).toEqual([medium, small, large]);
  });

  it("a igualdad, desempata por id: el orden es estable entre páginas", async () => {
    const other = await createUser();
    const theirs = await seedBasics(other.client);
    const same: string[] = [];
    for (let i = 0; i < 5; i += 1) same.push(await register(other, theirs));
    const sorted = [...same].sort();

    const pages = async (sort: Parameters<typeof listTx>[2]) => {
      const collected: string[] = [];
      for (let page = 1; page <= 3; page += 1) {
        const result = await listTx(other.client, ALL, sort, page, TODAY, 2);
        expect(result.total).toBe(5);
        collected.push(...ids(result.rows));
      }
      return collected;
    };

    expect(await pages("fecha_asc")).toEqual(sorted);
    expect(await pages("monto_asc")).toEqual(sorted);
    expect(await pages("estimada_asc")).toEqual(sorted);
    expect(await pages("fecha_desc")).toEqual([...sorted].reverse());
    expect(await pages("monto_desc")).toEqual([...sorted].reverse());
  });

  it("una página más allá del final viene vacía, con el total", async () => {
    expect(await listTx(user.client, ALL, "fecha_desc", 9, TODAY)).toEqual({ rows: [], total: 3 });
    expect(await listTx(user.client, { q: "no hay nada así" }, "fecha_desc", 1, TODAY)).toEqual({ rows: [], total: 0 });
    expect(await listTx(user.client, { q: "no hay nada así" }, "fecha_desc", 4, TODAY)).toEqual({ rows: [], total: 0 });
  });

  it("los filtros de fecha, empresa, canal, pasarela, cuenta, moneda y fecha estimada", async () => {
    expect(await order("fecha_asc", { from: "2026-11-11" })).toEqual([large, medium]);
    expect(await order("fecha_asc", { to: "2026-11-11" })).toEqual([small, large]);
    expect(await order("fecha_asc", { from: "2026-11-11", to: "2026-11-11" })).toEqual([large]);
    expect(
      await order("fecha_asc", {
        companyId: b.companyId,
        gatewayId: b.gatewayId,
        bankAccountId: b.bankAccountId,
        currency: "USD",
      }),
    ).toEqual([small, large, medium]);
    expect(await order("fecha_asc", { channelId: b.channelId })).toEqual([small, large]);
    expect(await order("fecha_asc", { currency: "EUR" })).toEqual([]);
    expect(await order("fecha_asc", { companyId: randomUUID() })).toEqual([]);
    expect(await order("fecha_asc", { estimatedOn: "2026-11-14" })).toEqual([medium]);
  });

  it("busca en la referencia y en la nota, sin distinguir mayúsculas", async () => {
    expect(await search("CHXDEMO")).toEqual([medium]);
    expect(await search("efectivo")).toEqual([small]);
    expect(await search("ñandú")).toEqual([large]);
  });

  it("los signos que admite la búsqueda se buscan tal cual, y el guion bajo no hace de comodín", async () => {
    for (const q of ["demo.1", "1:2", "2/3", "3#4", "4@5", "5-6 x"]) expect(await search(q)).toEqual([small]);
    // «ch_demo» está en una referencia; «chXdemoY» no lleva guion bajo.
    expect(await search("ch_demo")).toEqual([small]);
    expect(await search("h_d")).toEqual([small]);
  });

  it("lo que rompería el filtro se limpia antes de buscar", async () => {
    expect(await search('(efectivo), "*%')).toEqual([small]);
    expect(await search("%")).toEqual([small, large, medium]);
    expect(await search("*")).toEqual([small, large, medium]);
    expect(await search("x,gross_original.gt.0")).toEqual([]);
  });

  it("busca por el nombre de la empresa, del canal y de la pasarela", async () => {
    expect(await search("escuela")).toEqual([small, large, medium]);
    expect(await search("stripe")).toEqual([small, large, medium]);
    // El cobro mediano no tiene canal.
    expect(await search("inscripciones")).toEqual([small, large]);
  });

  it("si lo escrito es un monto, busca también ese bruto original", async () => {
    expect(await search("5")).toContain(small);
    expect(await search("1.234,56")).toEqual([medium]);
    expect(await search("$1,234.56")).toEqual([medium]);
    expect(await search("20000")).toEqual([large]);
    expect(await search("20.000,00")).toEqual([large]);
  });

  it("leanTx aplica la misma búsqueda, con o sin la configuración ya cargada", async () => {
    const cfg = await loadPayConfig(user.client);

    expect(ids(await leanTx(user.client, { q: "inscripciones" }, TODAY)).sort()).toEqual([small, large].sort());
    expect(ids(await leanTx(user.client, { q: "inscripciones" }, TODAY, cfg)).sort()).toEqual([small, large].sort());
    expect(ids((await listTx(user.client, { q: "inscripciones" }, "fecha_asc", 1, TODAY, 50, cfg)).rows)).toEqual([
      small,
      large,
    ]);
  });

  it("cada fila de la lista trae lo que pinta la pantalla, con el dinero como texto", async () => {
    const { rows, total } = await listTx(user.client, { q: "chXdemoY" }, "fecha_desc", 1, TODAY);

    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({
      id: medium,
      occurredOn: "2026-11-12",
      companyId: b.companyId,
      channelId: null,
      gatewayId: b.gatewayId,
      bankAccountId: b.bankAccountId,
      schemeId: b.schemeId,
      currency: "USD",
      grossOriginal: "1234.56",
      refunded: "0.00",
      gross: "1234.56",
      // Stripe 36,10 + «Pago rápido» 18,52; sin canal no hay plataforma.
      fees: "54.62",
      net: "1179.94",
      status: "registrado",
      disputeState: null,
      estimatedDepositOn: "2026-11-14",
      estimatedIsManual: true,
      depositedOn: null,
      receiptsCount: 0,
      reference: "chXdemoY",
      note: null,
      disputeOpenedOn: null,
      disputeClosedOn: null,
      deletedAt: null,
    });
    expect(rows[0] && "breakdown" in rows[0]).toBe(false);
    // `updatedAt` llega tal cual lo guarda la base, con sus microsegundos: es el control optimista.
    expect(rows[0]?.updatedAt).toBe((await rowOf(medium)).updated_at);
  });
});
