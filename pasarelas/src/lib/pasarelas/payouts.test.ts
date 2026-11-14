import { describe, expect, test } from "vitest";
import { compute, recompute, retentionOf } from "./breakdown";
import { D, toMoney } from "./decimal";
import { add, sub } from "./money";
import { fitsOwed, owedByPart, payoutStatus, type PayoutFacts, type PayoutStatus } from "./payouts";
import type { Breakdown, Money, Rules } from "./types";

// ─── E10 (el de la retención, tarea 49) ─────────────────────────────────────────────────────────────────────

/**
 * E10: OTF Demo (2,9 % + 0,20; no devuelve la comisión) retiene el 5 % para Titular A y Titular B, mitad y mitad;
 * el esquema «Sobre el neto» da Grupo A 60 %, Grupo B 30 % y 5 % a cada titular, los dos sin comisión.
 * 1000,00 USD → reparto Grupo A 580,53 · Grupo B 290,27 · Titular A 50,00 · Titular B 50,00; 25,00 retenidos a cada
 * titular.
 */
const RULES_E10: Rules = {
  gateway: {
    id: "gw-otf",
    name: "OTF Demo",
    feeVersionId: "fv-otf",
    pct: "2.9",
    fixed: "0.20",
    refundsReturnFee: false,
    disputeFee: "0.00",
    retention: {
      pct: "5",
      days: 30,
      recipients: [
        { beneficiaryId: "ta", name: "Titular A", pct: "50" },
        { beneficiaryId: "tb", name: "Titular B", pct: "50" },
      ],
    },
  },
  extras: [],
  platform: null,
  scheme: {
    schemeId: "sch-otf",
    versionId: "sv-otf",
    name: "Sobre el neto",
    base: "neto",
    lines: [
      { beneficiaryId: "ga", name: "Grupo A", pct: "60", feeExempt: false },
      { beneficiaryId: "gb", name: "Grupo B", pct: "30", feeExempt: false },
      { beneficiaryId: "ta", name: "Titular A", pct: "5", feeExempt: true },
      { beneficiaryId: "tb", name: "Titular B", pct: "5", feeExempt: true },
    ],
    remainder: null,
  },
};

const E10 = compute(
  RULES_E10,
  { grossOriginal: "1000.00", refunded: "0.00", dispute: null, failed: false, feesPaidBy: "nosotros" },
  "USD",
);

/** Lo que dice un cobro calculado por el motor, con lo ya pagado: los mismos hechos que guarda la base. */
function factsOf(b: Breakdown, paid: PayoutFacts["paid"] = [], counts = true): PayoutFacts {
  return {
    counts,
    allocations: b.alloc.lines.map((line) => ({ beneficiaryId: line.beneficiaryId, amount: line.amount })),
    retained: (retentionOf(b)?.shares ?? []).map(({ beneficiaryId, amount }) => ({ beneficiaryId, amount })),
    paid,
  };
}

/** Cada parte como [beneficiario, estado, lo que debe]. */
const rows = (status: PayoutStatus | null) => status?.parts.map((part) => [part.beneficiaryId, part.state, part.owed]);

/** «Marcar todo el reparto pagado» de P2: a cada parte, lo que le faltaba. */
const P2_PAID = [
  { beneficiaryId: "ga", amount: "580.53" },
  { beneficiaryId: "gb", amount: "290.27" },
  { beneficiaryId: "ta", amount: "25.00" },
  { beneficiaryId: "tb", amount: "25.00" },
];

describe("payoutStatus: lo que falta pagarle a cada parte del reparto de un cobro", () => {
  test("P1: recién registrado, a cada parte le falta su reparto menos lo que ya le retuvo la pasarela", () => {
    const status = payoutStatus(factsOf(E10));
    expect(rows(status)).toEqual([
      ["ga", "falta", "580.53"],
      ["gb", "falta", "290.27"],
      ["ta", "falta", "25.00"],
      ["tb", "falta", "25.00"],
    ]);
    expect(status?.parts[2]).toEqual({
      beneficiaryId: "ta",
      allocated: "50.00",
      retained: "25.00",
      paid: "0.00",
      owed: "25.00",
      state: "falta",
    });
    // «Reparto: 0 de 4 pagados».
    expect([status?.paidCount, status?.parts.length, status?.pending]).toEqual([0, 4, true]);
  });

  test("P2: pagado lo que faltaba a cada parte, todo el reparto queda pagado", () => {
    const status = payoutStatus(factsOf(E10, P2_PAID));
    expect(rows(status)).toEqual([
      ["ga", "pagado", "0.00"],
      ["gb", "pagado", "0.00"],
      ["ta", "pagado", "0.00"],
      ["tb", "pagado", "0.00"],
    ]);
    expect([status?.paidCount, status?.pending]).toEqual([4, false]);
  });

  test("un pago parcial deja lo que falta, y dos pagos a la misma parte se suman", () => {
    const status = payoutStatus(
      factsOf(E10, [
        { beneficiaryId: "ga", amount: "500.00" },
        { beneficiaryId: "gb", amount: "290.27" },
        { beneficiaryId: "ga", amount: "30.53" },
      ]),
    );
    expect(rows(status)).toEqual([
      ["ga", "falta", "50.00"],
      ["gb", "pagado", "0.00"],
      ["ta", "falta", "25.00"],
      ["tb", "falta", "25.00"],
    ]);
    expect(status?.parts[0]?.paid).toBe("530.53");
    // «Reparto: 1 de 4 pagados».
    expect(status?.paidCount).toBe(1);
  });

  test("P4: después de P2, un reembolso total: a cada parte se le pagó de más", () => {
    // E10b del motor: el reparto pasa a −19,47 · −9,73 · 0,00 · 0,00 y la pasarela ya no retiene nada.
    const refunded = recompute(E10, { refunded: "1000.00" });
    expect(refunded.alloc.lines.map((line) => line.amount)).toEqual(["-19.47", "-9.73", "0.00", "0.00"]);
    const status = payoutStatus(factsOf(refunded, P2_PAID));
    expect(rows(status)).toEqual([
      // −19,47 − 580,53: Grupo A tiene que devolver 600,00.
      ["ga", "de_mas", "-600.00"],
      ["gb", "de_mas", "-300.00"],
      ["ta", "de_mas", "-25.00"],
      ["tb", "de_mas", "-25.00"],
    ]);
    expect([status?.paidCount, status?.pending]).toEqual([0, true]);
  });

  test("un cobro sin reparto no tiene estado de pago", () => {
    expect(payoutStatus({ counts: true, allocations: [], retained: [], paid: [] })).toBeNull();
  });

  test("un cobro fallido o en la papelera no tiene nada pendiente, aunque tenga pagos", () => {
    expect(payoutStatus(factsOf(E10, [], false))).toBeNull();
    expect(payoutStatus(factsOf(E10, P2_PAID, false))).toBeNull();
  });

  test("quien recibe lo retenido sin estar en el reparto no es una parte: su adelanto no queda pendiente", () => {
    const status = payoutStatus({
      counts: true,
      allocations: [{ beneficiaryId: "ga", amount: "90.00" }],
      retained: [{ beneficiaryId: "gc", amount: "5.00" }],
      paid: [{ beneficiaryId: "ga", amount: "90.00" }],
    });
    expect(rows(status)).toEqual([["ga", "pagado", "0.00"]]);
    expect(status?.pending).toBe(false);
  });

  test("a quien se le pagó en un cobro donde ya no está en el reparto (otro esquema) se le pagó de más", () => {
    const status = payoutStatus({
      counts: true,
      allocations: [{ beneficiaryId: "ga", amount: "90.00" }],
      retained: [{ beneficiaryId: "gc", amount: "5.00" }],
      paid: [
        { beneficiaryId: "gc", amount: "10.00" },
        { beneficiaryId: "ga", amount: "90.00" },
      ],
    });
    // Las partes van en el orden del reparto; las que solo tienen pagos, detrás. A Grupo C sí le cuenta lo retenido.
    expect(rows(status)).toEqual([
      ["ga", "pagado", "0.00"],
      ["gc", "de_mas", "-15.00"],
    ]);
    expect(status?.parts[1]).toMatchObject({ allocated: "0.00", retained: "5.00", paid: "10.00" });
  });

  test("una pérdida repartida sin pagos: la parte la debe (se le pagó de más lo que le toca de la pérdida)", () => {
    const status = payoutStatus({
      counts: true,
      allocations: [{ beneficiaryId: "ga", amount: "-1.60" }],
      retained: [],
      paid: [],
    });
    expect(rows(status)).toEqual([["ga", "de_mas", "-1.60"]]);
  });

  test("propiedad: en cada parte, lo pagado más lo pendiente más lo retenido es exactamente su reparto", () => {
    const rnd = mulberry32(20261116);
    const cents = (max: number): Money => toMoney(new D(Math.floor(rnd() * max) - max / 4).div(100));
    const people = ["ga", "gb", "gc", "ta", "tb"];
    for (let i = 0; i < 500; i++) {
      const some = () => people.filter(() => rnd() < 0.6);
      const facts: PayoutFacts = {
        counts: true,
        allocations: some().map((beneficiaryId) => ({ beneficiaryId, amount: cents(200_000) })),
        retained: some().map((beneficiaryId) => ({ beneficiaryId, amount: cents(10_000) })),
        paid: [...some(), ...some()].map((beneficiaryId) => ({ beneficiaryId, amount: cents(150_000) })),
      };
      const status = payoutStatus(facts);
      // Las partes son quienes están en el reparto o tienen pagos; sin ninguno, no hay estado.
      const expected = new Set([...facts.allocations, ...facts.paid].map((line) => line.beneficiaryId));
      expect(status === null ? new Set() : new Set(status.parts.map((part) => part.beneficiaryId))).toEqual(expected);
      for (const part of status?.parts ?? []) {
        expect(add(part.paid, part.owed, part.retained)).toBe(part.allocated);
        const allocated = facts.allocations.filter((line) => line.beneficiaryId === part.beneficiaryId);
        expect(part.allocated).toBe(add("0.00", ...allocated.map((line) => line.amount)));
        const paid = facts.paid.filter((line) => line.beneficiaryId === part.beneficiaryId);
        expect(part.paid).toBe(add("0.00", ...paid.map((line) => line.amount)));
        expect(part.state).toBe(part.owed === "0.00" ? "pagado" : part.owed.startsWith("-") ? "de_mas" : "falta");
      }
      if (status !== null) {
        expect(status.paidCount).toBe(status.parts.filter((part) => part.state === "pagado").length);
        expect(status.pending).toBe(status.paidCount < status.parts.length);
      }
    }
  });
});

describe("owedByPart: lo que se le debe a cada parte en varios cobros, por moneda", () => {
  const p1 = payoutStatus(factsOf(E10));

  test("P3: dos cobros como E10 dan una cuenta por parte, con lo de cada cobro", () => {
    const groups = owedByPart([
      { transactionId: "t1", currency: "USD", status: p1 },
      { transactionId: "t2", currency: "USD", status: p1 },
    ]);
    expect(groups.map((group) => [group.beneficiaryId, group.currency, group.owed])).toEqual([
      ["ga", "USD", "1161.06"],
      ["gb", "USD", "580.54"],
      ["ta", "USD", "50.00"],
      ["tb", "USD", "50.00"],
    ]);
    expect(groups[1]?.items).toEqual([
      { transactionId: "t1", amount: "290.27" },
      { transactionId: "t2", amount: "290.27" },
    ]);
  });

  test("las monedas no se mezclan, y lo que ya está pagado (o sin estado) no sale", () => {
    const paid = payoutStatus(factsOf(E10, P2_PAID));
    const eur = payoutStatus({
      counts: true,
      allocations: [{ beneficiaryId: "ga", amount: "10.00" }],
      retained: [],
      paid: [],
    });
    const groups = owedByPart([
      { transactionId: "t1", currency: "EUR", status: eur },
      { transactionId: "t2", currency: "USD", status: paid },
      { transactionId: "t3", currency: "USD", status: null },
      { transactionId: "t4", currency: "USD", status: eur },
    ]);
    expect(groups).toEqual([
      { beneficiaryId: "ga", currency: "EUR", owed: "10.00", items: [{ transactionId: "t1", amount: "10.00" }] },
      { beneficiaryId: "ga", currency: "USD", owed: "10.00", items: [{ transactionId: "t4", amount: "10.00" }] },
    ]);
  });

  test("lo pagado de más resta (y si da negativo, la cuenta es negativa); si se compensa a cero, no sale", () => {
    const over = payoutStatus({
      counts: true,
      allocations: [
        { beneficiaryId: "ga", amount: "10.00" },
        { beneficiaryId: "gb", amount: "10.00" },
      ],
      retained: [],
      paid: [
        { beneficiaryId: "ga", amount: "40.00" },
        { beneficiaryId: "gb", amount: "20.00" },
      ],
    });
    const groups = owedByPart([
      { transactionId: "t1", currency: "USD", status: p1 },
      { transactionId: "t2", currency: "USD", status: over },
    ]);
    expect(groups.map((group) => [group.beneficiaryId, group.owed])).toEqual([
      ["ga", "550.53"],
      ["gb", "280.27"],
      ["ta", "25.00"],
      ["tb", "25.00"],
    ]);
    expect(groups[0]?.items).toEqual([
      { transactionId: "t1", amount: "580.53" },
      { transactionId: "t2", amount: "-30.00" },
    ]);
    // Solo el cobro pagado de más: la cuenta es negativa. Uno que falta 10 y otro con 10 de más: cero, no sale.
    expect(owedByPart([{ transactionId: "t2", currency: "USD", status: over }]).map((g) => g.owed)).toEqual([
      "-30.00",
      "-10.00",
    ]);
    const owes = payoutStatus({
      counts: true,
      allocations: [{ beneficiaryId: "gb", amount: "10.00" }],
      retained: [],
      paid: [],
    });
    expect(
      owedByPart([
        { transactionId: "t1", currency: "USD", status: owes },
        { transactionId: "t2", currency: "USD", status: over },
      ]).map((g) => [g.beneficiaryId, g.owed]),
    ).toEqual([["ga", "-30.00"]]);
  });

  test("propiedad: cada cuenta es exactamente la suma de sus cobros, y ninguno trae 0", () => {
    const rnd = mulberry32(20261117);
    const cents = (): Money => toMoney(new D(Math.floor(rnd() * 20_000) - 5_000).div(100));
    for (let i = 0; i < 200; i++) {
      const txs = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, n) => ({
        transactionId: `t${n}`,
        currency: rnd() < 0.7 ? "USD" : "EUR",
        status: payoutStatus({
          counts: rnd() < 0.9,
          allocations: ["ga", "gb"].map((beneficiaryId) => ({ beneficiaryId, amount: cents() })),
          retained: [],
          paid: ["ga", "gb"].filter(() => rnd() < 0.5).map((beneficiaryId) => ({ beneficiaryId, amount: cents() })),
        }),
      }));
      for (const group of owedByPart(txs)) {
        expect(group.owed).not.toBe("0.00");
        expect(add("0.00", ...group.items.map((item) => item.amount))).toBe(group.owed);
        expect(group.items.every((item) => item.amount !== "0.00")).toBe(true);
      }
    }
  });
});

describe("fitsOwed: lo que se puede pagar de lo que falta", () => {
  test("hasta lo que falta, con su mismo signo; nunca cero ni a una parte que no debe nada", () => {
    expect(fitsOwed("25.00", "25.00")).toBe(true);
    expect(fitsOwed("10.00", "25.00")).toBe(true);
    expect(fitsOwed("25.01", "25.00")).toBe(false);
    expect(fitsOwed("0.00", "25.00")).toBe(false);
    expect(fitsOwed("-5.00", "25.00")).toBe(false);
    expect(fitsOwed("5.00", "0.00")).toBe(false);
    // Una parte a la que se le pagó de más devuelve: hasta lo que tiene de más.
    expect(fitsOwed("-600.00", "-600.00")).toBe(true);
    expect(fitsOwed("-100.00", "-600.00")).toBe(true);
    expect(fitsOwed("-600.01", "-600.00")).toBe(false);
    expect(fitsOwed("5.00", "-600.00")).toBe(false);
    expect(fitsOwed(sub("0.00", "0.01"), "-0.01")).toBe(true);
  });
});

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
