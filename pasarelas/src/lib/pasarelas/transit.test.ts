import { describe, expect, test } from "vitest";
import { addDays } from "./dates";
import { add } from "./money";
import {
  moneyInTransit,
  transitCurrencies,
  transitLabel,
  transitPhase,
  type RetainedRow,
  type TransitRows,
} from "./transit";
import type { LeanTx } from "./types";

/** Hoy: lunes 16 de noviembre de 2026. */
const HOY = "2026-11-16";

/**
 * Un cobro E1 de Escuela Demo por Stripe Demo (100,00 → neto 90,30), registrado el vie 13 nov, sin depositar y a la
 * Cuenta principal. Cada caso cambia solo lo que le importa.
 */
const tx = (id: string, patch: Partial<LeanTx> = {}): LeanTx => ({
  id,
  occurredOn: "2026-11-13",
  companyId: "emp-escuela",
  channelId: null,
  gatewayId: "pas-stripe",
  bankAccountId: "cta-principal",
  currency: "USD",
  grossOriginal: "100.00",
  refunded: "0.00",
  gross: "100.00",
  fees: "9.70",
  net: "90.30",
  status: "registrado",
  disputeState: null,
  estimatedDepositOn: null,
  estimatedDepositFrom: null,
  depositedOn: null,
  receiptsCount: 0,
  feesPaidBy: "nosotros",
  buyerFees: "0.00",
  retention: "0.00",
  ...patch,
});

// ─── Los casos del encargo (hoy = lun 16 nov 2026) ──────────────────────────────────────────────────────────

/** T1: del vie 6 nov, con su ventana el jue 12: atrasado. */
const t1 = tx("t1", { occurredOn: "2026-11-06", estimatedDepositOn: "2026-11-12" });
/** T2: ventana del lun 16 al mié 18: hoy. */
const t2 = tx("t2", { estimatedDepositFrom: "2026-11-16", estimatedDepositOn: "2026-11-18" });
/** T3: un solo día, el mar 17: mañana. */
const t3 = tx("t3", { estimatedDepositOn: "2026-11-17" });
/** T4: ventana del jue 19 al lun 23, registrado hoy. */
const t4 = tx("t4", { occurredOn: HOY, estimatedDepositFrom: "2026-11-19", estimatedDepositOn: "2026-11-23" });
/** T5: dentro de 20 días (dom 6 dic). */
const t5 = tx("t5", { occurredOn: HOY, estimatedDepositOn: "2026-12-06" });
/**
 * T6: E10 de Tienda Demo por OTF Demo, del mar 10 nov: 1000,00 → neto 970,80; OTF retiene 50,00 durante 30 días.
 * Llega al banco 920,80, del mié 18 al vie 20.
 */
const t6 = tx("t6", {
  occurredOn: "2026-11-10",
  companyId: "emp-tienda",
  gatewayId: "pas-otf",
  grossOriginal: "1000.00",
  gross: "1000.00",
  fees: "29.20",
  net: "970.80",
  retention: "50.00",
  estimatedDepositFrom: "2026-11-18",
  estimatedDepositOn: "2026-11-20",
});
/** T7: la disputa abierta: la pasarela lo detiene. */
const t7 = tx("t7", { disputeState: "abierta", estimatedDepositOn: "2026-11-17" });
/** T8: sin cuenta destino. */
const t8 = tx("t8", { bankAccountId: null, estimatedDepositOn: "2026-11-17" });

/** Lo retenido de T6: se libera el 10 nov + 30 días = jue 10 dic. */
const t6Retained: RetainedRow = { id: "t6", occurredOn: "2026-11-10", currency: "USD", retention: "50.00", days: 30 };

const CASOS: TransitRows<LeanTx> = { open: [t1, t2, t3, t4, t5, t6, t7, t8], deposited: [], retained: [t6Retained] };

/** El resultado en USD. */
const usd = (rows: TransitRows<LeanTx>, today = HOY) => moneyInTransit(rows, "USD", today);

/** Un cobro por caer con esa ventana (`from` nulo: un solo día), solo, en su resultado. */
function itemOf(window: { from?: string; to: string; occurredOn?: string }, today = HOY) {
  const row = tx("x", {
    occurredOn: window.occurredOn ?? "2026-11-13",
    estimatedDepositFrom: window.from ?? null,
    estimatedDepositOn: window.to,
  });
  const [item] = usd({ open: [row], deposited: [], retained: [] }, today).items;
  if (item === undefined) throw new Error("El cobro no salió en camino.");
  return item;
}

describe("moneyInTransit: los casos T1 a T8", () => {
  const view = usd(CASOS);
  const item = (id: string) => view.items.find((each) => each.tx.id === id);

  test("T1: atrasado, «Debió llegar hace 4 días», con la barra llena", () => {
    expect(item("t1")).toMatchObject({
      phase: "atrasado",
      bucket: "atrasado",
      label: "Debió llegar hace 4 días",
      window: { from: "2026-11-12", to: "2026-11-12" },
      payout: "90.30",
      progress: 100,
    });
  });

  test("T2: hoy, «Hoy o hasta el mié 18»", () => {
    expect(item("t2")).toMatchObject({
      phase: "hoy",
      bucket: "hoy",
      label: "Hoy o hasta el mié 18",
      window: { from: HOY, to: "2026-11-18" },
      // Del vie 13 al mié 18 son 5 días; ya pasaron 3.
      progress: 60,
    });
  });

  test("T3: próximo, «Llega mañana», en los próximos 7 días", () => {
    expect(item("t3")).toMatchObject({
      phase: "proximo",
      bucket: "semana",
      label: "Llega mañana",
      window: { from: "2026-11-17", to: "2026-11-17" },
      progress: 75,
    });
  });

  test("T4: «Llega en 3–7 días»: el lun 23 es justo el día 7, todavía en los próximos 7 días", () => {
    expect(item("t4")).toMatchObject({ phase: "proximo", bucket: "semana", label: "Llega en 3–7 días", progress: 0 });
  });

  test("T5: dentro de 20 días, en «Más adelante», y en la lista va plegado", () => {
    expect(item("t5")).toMatchObject({ phase: "proximo", bucket: "despues", label: "Llega en 20 días" });
    expect(view.later.map((group) => group.ids)).toEqual([["t5"]]);
    expect(view.soon.flatMap((group) => group.ids)).not.toContain("t5");
  });

  test("T6: con retención, llega neto − retenido; lo retenido va aparte, con el día en que se libera", () => {
    expect(item("t6")).toMatchObject({ payout: "920.80", label: "Llega en 2–4 días", bucket: "semana", progress: 60 });
    expect(view.retained).toEqual({ amount: "50.00", count: 1, from: "2026-12-10", to: "2026-12-10" });
  });

  test("T7: con la disputa abierta no está en camino: sale en lo detenido", () => {
    expect(item("t7")).toBeUndefined();
    expect(view.held).toEqual({ payout: "90.30", count: 1 });
  });

  test("T8: sin cuenta, va a «Sin cuenta», aparte de las cuentas", () => {
    expect(item("t8")).toMatchObject({ label: "Llega mañana", bucket: "semana" });
    expect(view.unassigned).toEqual({
      bankAccountId: null,
      total: { payout: "90.30", count: 1 },
      overdue: { payout: "0.00", count: 0 },
    });
    expect(view.accounts.map((account) => account.bankAccountId)).toEqual(["cta-principal"]);
  });

  test("las tarjetas: cada fase, y el total en camino es la suma de las cuatro", () => {
    expect(view.buckets).toEqual({
      atrasado: { payout: "90.30", count: 1 },
      hoy: { payout: "90.30", count: 1 },
      // T3, T4, T6 y T8: 90,30 × 3 + 920,80.
      semana: { payout: "1191.70", count: 4 },
      despues: { payout: "90.30", count: 1 },
    });
    expect(view.total).toEqual({ payout: "1462.60", count: 7 });
  });

  test("por cuenta destino: cuánto va a cada una y cuánto de eso ya debió llegar", () => {
    expect(view.accounts).toEqual([
      {
        bankAccountId: "cta-principal",
        // T1 a T6 menos la disputa: 90,30 × 5 + 920,80.
        total: { payout: "1372.30", count: 6 },
        overdue: { payout: "90.30", count: 1 },
      },
    ]);
  });

  test("la lista: por la fecha más tardía de la ventana, lo atrasado primero", () => {
    expect(view.items.map((each) => each.tx.id)).toEqual(["t1", "t3", "t8", "t2", "t6", "t4", "t5"]);
    expect(view.soon.map((group) => [group.date, group.bankAccountId, group.ids, group.overdue])).toEqual([
      ["2026-11-12", "cta-principal", ["t1"], true],
      ["2026-11-17", "cta-principal", ["t3"], false],
      ["2026-11-17", null, ["t8"], false],
      ["2026-11-18", "cta-principal", ["t2"], false],
      ["2026-11-20", "cta-principal", ["t6"], false],
      ["2026-11-23", "cta-principal", ["t4"], false],
    ]);
    // El grupo dice lo que llega al banco, no el neto.
    expect(view.soon[4]).toMatchObject({ net: "970.80", payout: "920.80", from: "2026-11-18" });
  });
});

describe("moneyInTransit: los límites de la fase", () => {
  test("hoy es la primera fecha de la ventana: hoy", () => {
    expect(itemOf({ from: HOY, to: "2026-11-17" })).toMatchObject({ phase: "hoy", label: "Hoy o hasta el mar 17" });
  });

  test("hoy es la última fecha de la ventana: «Puede llegar hoy», todavía no atrasado", () => {
    expect(itemOf({ from: "2026-11-14", to: HOY })).toMatchObject({
      phase: "hoy",
      bucket: "hoy",
      label: "Puede llegar hoy",
      progress: 100,
    });
  });

  test("un solo día, sin `from`, que es hoy: «Puede llegar hoy»", () => {
    expect(itemOf({ to: HOY })).toMatchObject({
      phase: "hoy",
      label: "Puede llegar hoy",
      window: { from: HOY, to: HOY },
    });
  });

  test("una ventana de un día con `from` igual a `to` es un solo día", () => {
    expect(itemOf({ from: "2026-11-19", to: "2026-11-19" })).toMatchObject({
      phase: "proximo",
      label: "Llega en 3 días",
    });
  });

  test("ayer: «Debió llegar hace 1 día»", () => {
    expect(itemOf({ to: "2026-11-15" })).toMatchObject({ phase: "atrasado", label: "Debió llegar hace 1 día" });
  });

  test("una ventana que empieza mañana: «Llega en 1–3 días»", () => {
    expect(itemOf({ from: "2026-11-17", to: "2026-11-19" })).toMatchObject({ label: "Llega en 1–3 días" });
  });

  test("los próximos 7 días terminan en el día 7: el 8 ya es «Más adelante»", () => {
    expect(itemOf({ to: addDays(HOY, 7) }).bucket).toBe("semana");
    expect(itemOf({ to: addDays(HOY, 8) }).bucket).toBe("despues");
  });

  test("«Hoy o hasta el …» dice el mes si cambia, y el año si cambia", () => {
    expect(itemOf({ from: "2026-11-29", to: "2026-12-02" }, "2026-11-30").label).toBe("Hoy o hasta el mié 2 dic");
    expect(itemOf({ from: "2026-12-29", to: "2027-01-01" }, "2026-12-30").label).toBe("Hoy o hasta el vie 1 ene 2027");
  });

  test("la barra: lo que pasó del camino, sin salirse de 0 a 100", () => {
    // Registrado mañana (fecha a mano): todavía no empezó.
    expect(itemOf({ to: "2026-11-20", occurredOn: "2026-11-17" }).progress).toBe(0);
    // Del sáb 14 al lun 16, hoy: el camino entero.
    expect(itemOf({ to: HOY, occurredOn: "2026-11-14" }).progress).toBe(100);
    // Cae el mismo día del cobro (0 días): no hay camino que recorrer.
    expect(itemOf({ to: HOY, occurredOn: HOY }).progress).toBe(100);
    // Del vie 13 al jue 19: 3 de 6 días.
    expect(itemOf({ to: "2026-11-19" }).progress).toBe(50);
  });

  test("transitLabel y transitPhase dicen lo mismo que la fase de cada cobro (también de un grupo)", () => {
    expect(transitLabel({ from: "2026-11-12", to: "2026-11-12" }, HOY)).toBe("Debió llegar hace 4 días");
    expect(transitLabel({ from: HOY, to: "2026-11-18" }, HOY)).toBe("Hoy o hasta el mié 18");
    expect(transitLabel({ from: "2026-11-19", to: "2026-11-23" }, HOY)).toBe("Llega en 3–7 días");
    expect(transitPhase({ from: "2026-11-12", to: "2026-11-12" }, HOY)).toBe("atrasado");
    expect(transitPhase({ from: "2026-11-12", to: HOY }, HOY)).toBe("hoy");
    expect(transitPhase({ from: "2026-11-17", to: "2026-11-17" }, HOY)).toBe("proximo");
  });
});

describe("moneyInTransit: qué entra y qué no", () => {
  /** Mañana. */
  const T = "2026-11-17";

  test("solo lo por caer con fecha estimada: ni depositado, ni fallido, ni reembolsado del todo, ni sin fecha", () => {
    const view = usd({
      open: [
        tx("deposito", { status: "depositado", depositedOn: "2026-11-10", estimatedDepositOn: "2026-11-12" }),
        tx("fallido", { status: "fallido", gross: "0.00", fees: "0.00", net: "0.00", estimatedDepositOn: T }),
        tx("reembolsado", { refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20", estimatedDepositOn: T }),
        tx("sin-fecha"),
        tx("en-transito", { status: "en_transito", estimatedDepositOn: T }),
        tx("ganada", { disputeState: "ganada", estimatedDepositOn: T }),
      ],
      deposited: [],
      retained: [],
    });
    expect(view.items.map((item) => item.tx.id)).toEqual(["en-transito", "ganada"]);
    expect(view.held).toEqual({ payout: "0.00", count: 0 });
  });

  test("detenido por disputa: solo lo que estaría por caer; uno ya depositado o reembolsado del todo, no", () => {
    const view = usd({
      open: [
        tx("abierta", { status: "en_transito", disputeState: "abierta", retention: "5.00" }),
        tx("abierta-depositada", { status: "depositado", disputeState: "abierta", depositedOn: "2026-11-10" }),
        tx("abierta-reembolsada", { disputeState: "abierta", refunded: "100.00", gross: "0.00", net: "-3.20" }),
      ],
      deposited: [],
      retained: [],
    });
    // Lo que llegaría al banco: 90,30 − 5,00.
    expect(view.held).toEqual({ payout: "85.30", count: 1 });
    expect(view.items).toEqual([]);
  });

  test("nunca se mezclan monedas: cada una con lo suyo", () => {
    const rows: TransitRows<LeanTx> = {
      open: [
        t1,
        tx("eur", { currency: "EUR", estimatedDepositOn: "2026-11-17" }),
        // Lo que no cuenta no hace aparecer su moneda.
        tx("cad-depositado", { currency: "CAD", status: "depositado", depositedOn: "2026-01-02" }),
      ],
      deposited: [tx("eur-dep", { currency: "EUR", status: "depositado", depositedOn: HOY })],
      retained: [{ ...t6Retained, currency: "MXN" }],
    };
    expect(transitCurrencies(rows, HOY)).toEqual(["EUR", "MXN", "USD"]);
    const eur = moneyInTransit(rows, "EUR", HOY);
    expect(eur.total).toEqual({ payout: "90.30", count: 1 });
    expect(eur.deposited.total).toEqual({ payout: "90.30", count: 1 });
    expect(moneyInTransit(rows, "MXN", HOY)).toMatchObject({
      total: { payout: "0.00", count: 0 },
      retained: { amount: "50.00" },
    });
    expect(usd(rows).items.map((item) => item.tx.id)).toEqual(["t1"]);
    expect(usd(rows).retained).toBeNull();
  });

  test("sin nada: ninguna moneda, y en cualquiera, todo en cero", () => {
    const none = { open: [], deposited: [], retained: [] };
    expect(transitCurrencies(none, HOY)).toEqual([]);
    expect(usd(none)).toEqual({
      items: [],
      buckets: {
        atrasado: { payout: "0.00", count: 0 },
        hoy: { payout: "0.00", count: 0 },
        semana: { payout: "0.00", count: 0 },
        despues: { payout: "0.00", count: 0 },
      },
      total: { payout: "0.00", count: 0 },
      accounts: [],
      unassigned: null,
      soon: [],
      later: [],
      held: { payout: "0.00", count: 0 },
      retained: null,
      deposited: { total: { payout: "0.00", count: 0 }, accounts: [] },
    });
  });
});

describe("moneyInTransit: la lista sin tope", () => {
  test("lo de más de 14 días va aparte; el día 14 todavía no", () => {
    const view = usd({
      open: [tx("d14", { estimatedDepositOn: addDays(HOY, 14) }), tx("d15", { estimatedDepositOn: addDays(HOY, 15) })],
      deposited: [],
      retained: [],
    });
    expect(view.soon.map((group) => group.ids)).toEqual([["d14"]]);
    expect(view.later.map((group) => group.ids)).toEqual([["d15"]]);
  });

  test("lo atrasado de hace mucho también entra", () => {
    const view = usd({ open: [tx("viejo", { estimatedDepositOn: "2025-01-10" })], deposited: [], retained: [] });
    expect(view.soon).toMatchObject([{ date: "2025-01-10", overdue: true, ids: ["viejo"] }]);
    expect(view.items[0]?.label).toBe("Debió llegar hace 675 días");
  });

  test("las cuentas, de más a menos en camino; a igual monto, por id", () => {
    const view = usd({
      open: [
        tx("z1", { bankAccountId: "cta-z", estimatedDepositOn: "2026-11-17" }),
        tx("a1", { bankAccountId: "cta-a", estimatedDepositOn: "2026-11-17" }),
        tx("b1", { bankAccountId: "cta-b", estimatedDepositOn: "2026-11-17", net: "500.00" }),
      ],
      deposited: [],
      retained: [],
    });
    expect(view.accounts.map((account) => account.bankAccountId)).toEqual(["cta-b", "cta-a", "cta-z"]);
    expect(view.unassigned).toBeNull();
  });
});

describe("moneyInTransit: lo retenido que todavía no se libera", () => {
  test("se libera hoy: todavía cuenta; ayer: ya no; sin monto: no", () => {
    const view = usd({
      open: [],
      deposited: [],
      retained: [
        { id: "hoy", occurredOn: "2026-10-17", currency: "USD", retention: "10.00", days: 30 },
        { id: "ayer", occurredOn: "2026-10-16", currency: "USD", retention: "20.00", days: 30 },
        { id: "cero", occurredOn: HOY, currency: "USD", retention: "0.00", days: 30 },
        { id: "luego", occurredOn: "2026-11-10", currency: "USD", retention: "50.00", days: 7 },
      ],
    });
    expect(view.retained).toEqual({ amount: "60.00", count: 2, from: HOY, to: "2026-11-17" });
  });
});

describe("moneyInTransit: lo marcado depositado en los últimos 30 días", () => {
  const dep = (id: string, depositedOn: string | null, patch: Partial<LeanTx> = {}) =>
    tx(id, { status: "depositado", depositedOn, estimatedDepositOn: "2026-11-01", ...patch });

  test("de hoy a hace 29 días, por cuenta, con lo que llega al banco", () => {
    const view = usd({
      open: [],
      deposited: [
        dep("hoy", HOY),
        dep("hace-29", "2026-10-18"),
        dep("hace-30", "2026-10-17"),
        dep("sin-cuenta", "2026-11-02", { bankAccountId: null }),
        dep("retenido", "2026-11-11", { net: "970.80", retention: "50.00" }),
        dep("manana", "2026-11-17"),
        dep("sin-fecha", null),
        tx("no-depositado", { depositedOn: HOY, estimatedDepositOn: "2026-11-01" }),
      ],
      retained: [],
    });
    expect(view.deposited).toEqual({
      total: { payout: "1191.70", count: 4 },
      accounts: [
        { bankAccountId: "cta-principal", payout: "1101.40", count: 3 },
        { bankAccountId: null, payout: "90.30", count: 1 },
      ],
    });
    // Lo depositado no está en camino.
    expect(view.total).toEqual({ payout: "0.00", count: 0 });
  });

  test("a igual monto, «sin cuenta» al final", () => {
    const view = usd({
      open: [],
      deposited: [dep("sin", HOY, { bankAccountId: null }), dep("con", HOY, { bankAccountId: "cta-z" })],
      retained: [],
    });
    expect(view.deposited.accounts.map((account) => account.bankAccountId)).toEqual(["cta-z", null]);
  });
});

// ─── Propiedades con datos generados ────────────────────────────────────────────────────────────────────────

/** Generador determinista (mulberry32): la misma semilla da siempre los mismos casos. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("moneyInTransit: propiedades con 2 000 cobros generados", () => {
  const random = mulberry32(54);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
  const cents = (value: number): string => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;

  const rows: LeanTx[] = Array.from({ length: 2000 }, (_, index) => {
    const to = addDays(HOY, int(-40, 40));
    const net = int(1, 500_000);
    return tx(`g${index}`, {
      occurredOn: addDays(to, -int(0, 10)),
      bankAccountId: pick(["cta-a", "cta-b", null]),
      currency: pick(["USD", "EUR"]),
      status: pick(["registrado", "en_transito", "depositado", "fallido"]),
      disputeState: pick([null, null, null, "abierta", "ganada"]),
      net: cents(net),
      retention: cents(int(0, net)),
      estimatedDepositFrom: pick([null, addDays(to, -int(0, 4))]),
      estimatedDepositOn: random() < 0.05 ? null : to,
    });
  });
  const generated = { open: rows, deposited: [], retained: [] };
  const views = transitCurrencies(generated, HOY).map((currency) => moneyInTransit(generated, currency, HOY));

  test("la suma de las cuatro fases es el total en camino, en monto y en cobros", () => {
    for (const view of views) {
      const { atrasado, hoy, semana, despues } = view.buckets;
      expect(add(atrasado.payout, hoy.payout, semana.payout, despues.payout)).toBe(view.total.payout);
      expect(atrasado.count + hoy.count + semana.count + despues.count).toBe(view.total.count);
      expect(view.items).toHaveLength(view.total.count);
    }
  });

  test("ningún cobro sale dos veces: ni en la lista, ni en los grupos, ni en las cuentas", () => {
    for (const view of views) {
      const ids = view.items.map((item) => item.tx.id);
      expect(new Set(ids).size).toBe(ids.length);
      const grouped = [...view.soon, ...view.later].flatMap((group) => group.ids);
      expect(grouped.toSorted()).toEqual(ids.toSorted());
      const accounts = [...view.accounts, ...(view.unassigned === null ? [] : [view.unassigned])];
      expect(add("0.00", ...accounts.map((account) => account.total.payout))).toBe(view.total.payout);
      expect(accounts.reduce((sum, account) => sum + account.total.count, 0)).toBe(view.total.count);
    }
  });

  test("lo detenido por disputa nunca está en camino", () => {
    for (const view of views) {
      expect(view.items.every((item) => item.tx.disputeState !== "abierta")).toBe(true);
    }
  });
});
