import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ZERO,
  add,
  addDays,
  displayStatus,
  isOverdue,
  isPending,
  cmp,
  planCreate,
  totalsOf,
  type LeanTx,
  type NewTxInput,
} from "@/lib/pasarelas";
import { registerReceipt } from "@/server/pasarelas/ops/receipts";
import { disputeTx, failTx, refundTx, trashTx } from "@/server/pasarelas/ops/transactions";
import { loadPayConfig } from "@/server/pasarelas/queries/config";
import { leanTx, listTx, type TxFilters, type TxSort } from "@/server/pasarelas/queries/transactions";
import { saveTx } from "@/server/pasarelas/tx-save";
import { createUser, seedBasics, unwrap, type Basics, type TestUser } from "./helpers";

/**
 * Los totales de un filtro salen de TODAS sus filas (traídas por páginas de 1000), y la lista pinta las mismas
 * filas de 50 en 50: aquí se comprueba, con 1 250 cobros, que las dos lecturas ven exactamente lo mismo.
 */

const COUNT = 1250;
const FIRST_DAY = "2026-08-01";
/** Los cobros van del 1 de agosto al 28 de noviembre: con «hoy» el 13 de noviembre hay atrasados y por venir. */
const TODAY = "2026-11-13";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

let user: TestUser;
let b: Basics;
/** Segunda empresa (sin canales) y segunda pasarela (PayPal, con su cuenta en la primera empresa). */
let shopId: string;
let paypalId: string;
let secondAccountId: string;
/** Los ids de los 1 250 cobros, en el orden en que se crearon. */
let txIds: string[];

/** PRNG determinista (mulberry32): misma semilla → misma secuencia en cualquier máquina. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** El cobro número `i`: siempre de 1,00, pero de empresas, pasarelas, fechas y estados distintos. */
function input(i: number, patch: Partial<NewTxInput> = {}): NewTxInput {
  const occurredOn = addDays(FIRST_DAY, i % 120);
  const inShop = i % 3 === 0;
  const byPayPal = i % 5 === 0;
  const lifecycle = (["depositado", "en_transito", "registrado", "registrado", "registrado", "registrado"] as const)[
    i % 6
  ];
  return {
    id: randomUUID(),
    companyId: inShop ? shopId : b.companyId,
    channelId: !inShop && i % 2 === 1 ? b.channelId : null,
    gatewayId: byPayPal ? paypalId : b.gatewayId,
    extraIds: !byPayPal && i % 4 === 0 ? [b.extraId] : [],
    schemeId: i % 7 === 0 ? null : b.schemeId,
    occurredOn,
    // A mediodía de Nueva York, cada cobro un minuto distinto: la fecha en Nueva York es la misma que en UTC.
    occurredAt: `${occurredOn}T${String(15 + (i % 5)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
    currency: "USD",
    grossOriginal: "1.00",
    reference: `ref-${String(i).padStart(4, "0")}`,
    note: i % 10 === 0 ? "Nota demo" : null,
    status: lifecycle,
    depositedOn: lifecycle === "depositado" ? addDays(occurredOn, 2 + (i % 3)) : null,
    ...patch,
  };
}

/** Todas las filas que la lista pinta para ese filtro, recorriéndola página a página. */
async function walk(filters: TxFilters, sort: TxSort): Promise<{ rows: LeanTx[]; total: number; pages: number }> {
  const rows: LeanTx[] = [];
  let total = 0;
  let page = 1;
  for (;;) {
    const result = await listTx(user.client, filters, sort, page, TODAY);
    total = result.total;
    rows.push(...result.rows);
    if (rows.length >= total || result.rows.length === 0) return { rows, total, pages: page };
    expect(result.rows, `la página ${page} no es la última y no viene llena`).toHaveLength(50);
    page += 1;
  }
}

/** La suma, a mano y por moneda, de las filas que cuentan (las fallidas no cuentan en nada). */
function sumByHand(
  rows: readonly LeanTx[],
): Record<string, { count: number; gross: string; fees: string; net: string }> {
  const totals: Record<string, { count: number; gross: string; fees: string; net: string }> = {};
  for (const row of rows) {
    if (row.status === "fallido") continue;
    const sum = (totals[row.currency] ??= { count: 0, gross: ZERO, fees: ZERO, net: ZERO });
    sum.count += 1;
    sum.gross = add(sum.gross, row.gross);
    sum.fees = add(sum.fees, row.fees);
    sum.net = add(sum.net, row.net);
  }
  return totals;
}

const idsOf = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id).sort();

beforeAll(async () => {
  user = await createUser();
  b = await seedBasics(user.client);
  const c = user.client;
  shopId = unwrap(await c.from("pay_companies").insert({ name: "Tienda Demo" }).select("id").single(), "tienda").id;
  secondAccountId = unwrap(
    await c.from("pay_bank_accounts").insert({ alias: "Cuenta de PayPal", last4: "1111" }).select("id").single(),
    "segunda cuenta",
  ).id;
  paypalId = unwrap(
    await c.rpc("pay_create_gateway", {
      p: { name: "PayPal", payout_days: 1, payout_day_type: "corridos", fee: { pct: "3.49", fixed: "0.49" } },
    }),
    "PayPal",
  );
  unwrap(
    await c
      .from("pay_company_gateways")
      .insert({ company_id: b.companyId, gateway_id: paypalId, bank_account_id: secondAccountId })
      .select("id")
      .single(),
    "cuenta de PayPal de la escuela",
  );

  // Los 1 250 cobros, calculados por el motor y guardados por lotes (500 + 500 + 250).
  const cfg = await loadPayConfig(c);
  const writes = Array.from({ length: COUNT }, (_, i) => planCreate(cfg, input(i)));
  const saved = await saveTx(c, writes);
  expect(saved.map((result) => result.id)).toEqual(writes.map((write) => write.id));
  expect(saved.every((result) => result.inserted && !result.skipped)).toBe(true);
  txIds = saved.map((result) => result.id);
});

describe("1 250 cobros de 1,00", () => {
  it("leanTx los trae todos (más de una página de 1000) y totalsOf da un bruto de 1250,00", async () => {
    const rows = await leanTx(user.client, {}, TODAY);

    expect(rows).toHaveLength(COUNT);
    expect(new Set(rows.map((row) => row.id)).size).toBe(COUNT);
    expect(idsOf(rows)).toEqual([...txIds].sort());
    const totals = totalsOf(rows);
    expect(Object.keys(totals)).toEqual(["USD"]);
    expect(totals.USD).toMatchObject({ count: COUNT, gross: "1250.00" });
    expect(totals.USD?.net).toBe(add(...rows.map((row) => row.net)));
  });

  it("listTx, página 1: 50 filas y el total del filtro, 1250", async () => {
    const { rows, total } = await listTx(user.client, {}, "fecha_desc", 1, TODAY);

    expect(rows).toHaveLength(50);
    expect(total).toBe(COUNT);
    // Del más reciente al más antiguo.
    const instants = rows.map((row) => Date.parse(row.occurredAt));
    expect(instants).toEqual([...instants].sort((x, y) => y - x));
    expect(rows[0]?.occurredOn).toBe("2026-11-28");
  });

  it("la página 25 es la última y viene llena; la 26 viene vacía, con el total", async () => {
    const { rows, total } = await listTx(user.client, {}, "fecha_desc", 25, TODAY);

    expect(rows).toHaveLength(50);
    expect(total).toBe(COUNT);
    expect(await listTx(user.client, {}, "fecha_desc", 26, TODAY)).toEqual({ rows: [], total: COUNT });
  });
});

describe("con cobros de todos los estados", () => {
  /** Lo que se mueve después de crear: reembolsos, fallidos, disputas, papelera, otra moneda y comprobantes. */
  let trashed: string[];

  beforeAll(async () => {
    const c = user.client;
    const at = (i: number): string => {
      const id = txIds[i];
      if (id === undefined) throw new Error(`No hay cobro ${i}`);
      return id;
    };
    // Reembolso total de 30 (de todos los ciclos: depositados, en tránsito y registrados) y parcial de 10.
    for (let i = 10; i < 40; i += 1) await refundTx(c, at(i), { amount: "1.00", on: "2026-11-01" });
    for (let i = 40; i < 50; i += 1) await refundTx(c, at(i), { amount: "0.40", on: "2026-11-01" });
    // Disputas abiertas: sobre cobros sin tocar y sobre algunos ya reembolsados del todo.
    for (let i = 30; i < 36; i += 1) await disputeTx(c, at(i), { action: "abrir", on: "2026-11-02" });
    for (let i = 80; i < 95; i += 1) await disputeTx(c, at(i), { action: "abrir", on: "2026-11-02" });
    // Fallidos: solo se puede con los que no están depositados (los depositados se saltan aquí).
    for (let i = 50; i < 70; i += 1) if (i % 6 !== 0) await failTx(c, at(i));
    // A la papelera, de un solo lote.
    trashed = Array.from({ length: 40 }, (_, k) => at(100 + k));
    expect(await trashTx(c, trashed)).toBe(40);
    // 60 cobros más, en euros.
    const cfg = await loadPayConfig(c);
    const euros = Array.from({ length: 60 }, (_, k) =>
      planCreate(cfg, input(k, { currency: "EUR", reference: `eur-${k}` })),
    );
    txIds.push(...(await saveTx(c, euros)).map((result) => result.id));
    // Dos cobros con comprobante.
    for (const i of [200, 201]) {
      const path = `${user.id}/${at(i)}/recibo.png`;
      const { error } = await c.storage.from("comprobantes").upload(path, PNG, { contentType: "image/png" });
      if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`);
      await registerReceipt(c, user.id, {
        transactionId: at(i),
        path,
        mime: "image/png",
        sizeBytes: PNG.length,
        originalName: null,
      });
    }
  });

  it("cada estado del filtro trae exactamente los cobros que el motor muestra con ese estado", async () => {
    const all = await leanTx(user.client, {}, TODAY);
    expect(all).toHaveLength(COUNT + 60 - 40);

    for (const status of ["fallido", "en_disputa", "reembolsado", "depositado", "en_transito", "registrado"] as const) {
      const expected = all.filter((row) => displayStatus(row) === status);
      expect(expected.length, `no hay ningún cobro «${status}» en los datos`).toBeGreaterThan(0);
      expect(idsOf(await leanTx(user.client, { status }, TODAY)), status).toEqual(idsOf(expected));
    }
    // Lo que distingue a cada regla está en los datos: depositados y disputados que además están reembolsados
    // del todo, y reembolsos parciales (que no cambian de estado).
    expect(all.some((row) => row.status === "depositado" && displayStatus(row) === "reembolsado")).toBe(true);
    expect(all.some((row) => row.disputeState === "abierta" && cmp(row.gross, ZERO) === 0)).toBe(true);
    expect(all.some((row) => cmp(row.refunded, ZERO) > 0 && cmp(row.gross, ZERO) > 0)).toBe(true);
  });

  it("«por caer» y «atrasado» coinciden con las reglas del motor", async () => {
    const all = await leanTx(user.client, {}, TODAY);

    const pending = all.filter((row) => isPending(row) && cmp(row.gross, ZERO) > 0);
    const overdue = all.filter((row) => isOverdue(row, TODAY));
    expect(pending.length).toBeGreaterThan(overdue.length);
    expect(overdue.length).toBeGreaterThan(0);
    // Hay por caer con el bruto en cero (reembolsados del todo): no entran.
    expect(all.some((row) => isPending(row) && cmp(row.gross, ZERO) === 0)).toBe(true);
    expect(idsOf(await leanTx(user.client, { status: "por_caer" }, TODAY))).toEqual(idsOf(pending));
    expect(idsOf(await leanTx(user.client, { status: "atrasado" }, TODAY))).toEqual(idsOf(overdue));
    // «Atrasado» depende de qué día es hoy.
    expect(await leanTx(user.client, { status: "atrasado" }, FIRST_DAY)).toEqual([]);
  });

  it("la papelera va aparte: por defecto no aparece, y con trashed solo aparece ella", async () => {
    expect(idsOf(await leanTx(user.client, { trashed: true }, TODAY))).toEqual([...trashed].sort());
    const visible = new Set((await leanTx(user.client, {}, TODAY)).map((row) => row.id));
    expect(trashed.some((id) => visible.has(id))).toBe(false);
  });

  it("con y sin comprobante", async () => {
    const withReceipt = await leanTx(user.client, { receipt: "con" }, TODAY);
    expect(idsOf(withReceipt)).toEqual([txIds[200], txIds[201]].sort());
    expect(withReceipt.every((row) => row.receiptsCount === 1)).toBe(true);
    expect(await leanTx(user.client, { receipt: "sin" }, TODAY)).toHaveLength(COUNT + 60 - 40 - 2);
  });

  it("nunca se suman monedas distintas: cada una lleva su total", async () => {
    const totals = totalsOf(await leanTx(user.client, {}, TODAY));
    expect(Object.keys(totals).sort()).toEqual(["EUR", "USD"]);
    expect(totalsOf(await leanTx(user.client, { currency: "EUR" }, TODAY))).toEqual({ EUR: totals.EUR });
    expect(totals.EUR).toMatchObject({ count: 60, gross: "60.00" });
  });

  it("para 20 filtros generados, los totales de leanTx coinciden con sumar a mano lo que listTx recorre página a página", async () => {
    const rnd = prng(20261109);
    const pick = <T>(options: readonly T[]): T => options[Math.floor(rnd() * options.length)] as T;
    const maybe = <T>(chance: number, value: () => T): T | undefined => (rnd() < chance ? value() : undefined);
    const day = (): string => addDays(FIRST_DAY, Math.floor(rnd() * 125) - 2);

    const sorts: TxSort[] = ["fecha_desc", "fecha_asc", "monto_desc", "monto_asc", "estimada_asc"];
    const statuses = [
      "fallido",
      "en_disputa",
      "reembolsado",
      "depositado",
      "en_transito",
      "registrado",
      "por_caer",
      "atrasado",
    ] as const;
    const generated = (): TxFilters => {
      const from = maybe(0.4, day);
      const to = maybe(0.4, day);
      return {
        from: from !== undefined && to !== undefined && from > to ? to : from,
        to: from !== undefined && to !== undefined && from > to ? from : to,
        companyId: maybe(0.3, () => pick([b.companyId, shopId])),
        channelId: maybe(0.1, () => b.channelId),
        gatewayId: maybe(0.3, () => pick([b.gatewayId, paypalId])),
        bankAccountId: maybe(0.15, () => pick([b.bankAccountId, secondAccountId])),
        currency: maybe(0.3, () => pick(["USD", "EUR"])),
        status: maybe(0.4, () => pick(statuses)),
        receipt: maybe(0.1, () => pick(["con", "sin"] as const)),
        estimatedOn: maybe(0.05, day),
        q: maybe(0.25, () => pick(["ref-00", "Nota", "Tienda", "paypal", "1,00", "inscripciones", "eur-1"])),
        trashed: maybe(0.1, () => true),
      };
    };
    // Los cuatro primeros, a propósito: todo (26 páginas), lo por caer, la papelera y una búsqueda con muchas filas.
    const filters: TxFilters[] = [{}, { status: "por_caer" }, { trashed: true }, { q: "Tienda" }];
    while (filters.length < 20) filters.push(generated());

    let withRows = 0;
    let severalPages = 0;
    for (const [index, filter] of filters.entries()) {
      const label = `filtro ${index}: ${JSON.stringify(filter)}`;
      const lean = await leanTx(user.client, filter, TODAY);
      const listed = await walk(filter, pick(sorts));

      expect(listed.total, label).toBe(lean.length);
      expect(listed.rows.length, label).toBe(lean.length);
      expect(new Set(listed.rows.map((row) => row.id)).size, `${label}: una fila salió en dos páginas`).toBe(
        lean.length,
      );
      expect(idsOf(listed.rows), label).toEqual(idsOf(lean));
      expect(totalsOf(lean), label).toEqual(sumByHand(listed.rows));
      if (lean.length > 0) withRows += 1;
      if (listed.pages > 1) severalPages += 1;
    }
    // Que la prueba no pase por vacía: la mayoría de los filtros trae filas, y varios, más de una página.
    expect(withRows).toBeGreaterThanOrEqual(12);
    expect(severalPages).toBeGreaterThanOrEqual(6);
  });
});
