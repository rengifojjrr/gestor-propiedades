import { describe, expect, test } from "vitest";
import { allocate } from "./allocate";
import {
  buyerFeesOf,
  compute,
  diff,
  parseBreakdown,
  payoutOf,
  recalc,
  recompute,
  retentionOf,
  retentionReleaseOn,
} from "./breakdown";
import { D, isMoney } from "./decimal";
import { sub } from "./money";
import { PayRuleError } from "./rules";
import { businessFigures } from "./stats";
import type { Breakdown, ExtraRule, RetentionRule, Rules, SchemeRule, State } from "./types";

// ─── Datos de ejemplo (inventados) ──────────────────────────────────────────────────────────────────────────

/** E1: Stripe 2,9 % + 0,30 (no devuelve la comisión; disputa 15,00) · pago rápido 1,5 % · plataforma 5 % · 50/30/20. */
function rulesE1(): Rules {
  return {
    gateway: {
      id: "gw-stripe",
      name: "Stripe",
      feeVersionId: "fv-1",
      pct: "2.9",
      fixed: "0.30",
      refundsReturnFee: false,
      disputeFee: "15.00",
    },
    extras: [
      { id: "ex-rapido", name: "Pago rápido", pct: "1.5", fixed: "0.00", base: "bruto", payoutDaysOverride: 0 },
    ],
    platform: { channelId: "ch-web", name: "Tienda en línea", pct: "5", fixed: "0.00" },
    scheme: {
      schemeId: "sch-1",
      versionId: "sv-1",
      name: "Socios",
      base: "neto",
      lines: [
        { beneficiaryId: "ben-a", name: "Grupo A", pct: "50", feeExempt: false },
        { beneficiaryId: "ben-b", name: "Grupo B", pct: "30", feeExempt: false },
        { beneficiaryId: "ben-c", name: "Grupo C", pct: "20", feeExempt: false },
      ],
      remainder: null,
    },
  };
}

const paid = (grossOriginal: string): State => ({
  grossOriginal,
  refunded: "0.00",
  dispute: null,
  failed: false,
  feesPaidBy: "nosotros",
});

/** Lo cobrado cuando la comisión la pagó el comprador: el monto es lo que pagó él, con la comisión incluida. */
const paidByBuyer = (grossOriginal: string): State => ({ ...paid(grossOriginal), feesPaidBy: "comprador" });

const schemeOf = (rules: Rules): SchemeRule => rules.scheme as SchemeRule;
const extraOf = (rules: Rules): ExtraRule => rules.extras[0] as ExtraRule;

/** E1 con cambios puntuales en la pasarela. */
function rulesWithGateway(patch: Partial<Rules["gateway"]>): Rules {
  const rules = rulesE1();
  return { ...rules, gateway: { ...rules.gateway, ...patch } };
}

/**
 * E7: solo Stripe (2,9 % + 0,30), sin opciones ni plataforma, y el esquema 50/30/20 «Sobre el bruto»: lo que pasa
 * cuando la comisión la paga el comprador.
 */
function rulesE7(): Rules {
  const rules = rulesE1();
  return { ...rules, extras: [], platform: null, scheme: { ...schemeOf(rules), base: "bruto" } };
}

/**
 * E9: solo Stripe (2,9 % + 0,30), sin opciones ni plataforma, y el esquema 50/30/20 «Sobre el neto» con las partes
 * de `exempt` marcadas «No paga comisión» (por defecto, el Grupo C).
 */
function rulesE9(exempt: readonly string[] = ["ben-c"], base: SchemeRule["base"] = "neto"): Rules {
  const rules = rulesE1();
  const scheme = schemeOf(rules);
  const lines = scheme.lines.map((line) => ({ ...line, feeExempt: exempt.includes(line.beneficiaryId) }));
  return { ...rules, extras: [], platform: null, scheme: { ...scheme, base, lines } };
}

/** E3: solo Stripe y el pago rápido calculado sobre el bruto menos la comisión; sin plataforma. */
function rulesE3(): Rules {
  const rules = rulesE1();
  return { ...rules, extras: [{ ...extraOf(rules), base: "despues_de_comision" }], platform: null };
}

const e1 = compute(rulesE1(), paid("100.00"), "USD");

const amounts = (b: Breakdown) => b.lines.map((l) => l.amount);
const kindsAndAmounts = (b: Breakdown) => b.lines.map((l) => [l.kind, l.amount]);
const shares = (b: Breakdown) => b.alloc.lines.map((l) => l.amount);

// ─── Los casos del spec ─────────────────────────────────────────────────────────────────────────────────────

describe("compute: casos que deben salir exactos", () => {
  test("E1", () => {
    const b = compute(
      rulesE1(),
      { grossOriginal: "100.00", refunded: "0.00", dispute: null, failed: false, feesPaidBy: "nosotros" },
      "USD",
    );
    expect(b.lines.map((l) => [l.kind, l.amount])).toEqual([
      ["pasarela", "3.20"],
      ["opcion", "1.50"],
      ["plataforma", "5.00"],
    ]);
    expect([b.feesTotal, b.net]).toEqual(["9.70", "90.30"]);
    expect(b.alloc.lines.map((l) => l.amount)).toEqual(["45.15", "27.09", "18.06"]);
  });

  test("E1: el desglose completo, campo por campo", () => {
    const rules = rulesE1();
    const state = paid("100.00");
    expect(compute(rules, state, "USD")).toEqual({
      v: 1,
      currency: "USD",
      rules,
      state,
      gross: "100.00",
      lines: [
        {
          kind: "pasarela",
          refId: "gw-stripe",
          name: "Stripe",
          baseKind: "bruto",
          baseAmount: "100.00",
          pct: "2.9",
          fixed: "0.30",
          amount: "3.20",
        },
        {
          kind: "opcion",
          refId: "ex-rapido",
          name: "Pago rápido",
          baseKind: "bruto",
          baseAmount: "100.00",
          pct: "1.5",
          fixed: "0.00",
          amount: "1.50",
        },
        {
          kind: "plataforma",
          refId: "ch-web",
          name: "Tienda en línea",
          baseKind: "bruto",
          baseAmount: "100.00",
          pct: "5",
          fixed: "0.00",
          amount: "5.00",
        },
      ],
      feesTotal: "9.70",
      net: "90.30",
      alloc: {
        baseKind: "neto",
        baseAmount: "90.30",
        lines: [
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "50", amount: "45.15", isRemainder: false, feeExempt: false },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "30", amount: "27.09", isRemainder: false, feeExempt: false },
          { beneficiaryId: "ben-c", name: "Grupo C", pct: "20", amount: "18.06", isRemainder: false, feeExempt: false },
        ],
      },
    });
  });

  test("E2", () => {
    const base = rulesE1();
    const rules: Rules = {
      ...base,
      extras: [],
      platform: null,
      scheme: {
        ...schemeOf(base),
        lines: [
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "33.3333", feeExempt: false },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "33.3333", feeExempt: false },
          { beneficiaryId: "ben-c", name: "Grupo C", pct: "33.3334", feeExempt: false },
        ],
      },
    };
    const b = compute(rules, paid("33.33"), "USD");
    expect(kindsAndAmounts(b)).toEqual([["pasarela", "1.27"]]);
    expect(b.feesTotal).toBe("1.27");
    expect(b.net).toBe("32.06");
    expect(b.alloc.lines.map((l) => l.amount)).toEqual(["10.69", "10.68", "10.69"]);
    expect(b.alloc.lines.map((l) => l.pct)).toEqual(["33.3333", "33.3333", "33.3334"]);
  });

  test("E3", () => {
    const b = compute(rulesE3(), paid("100.00"), "USD");
    expect(b.lines[1]).toMatchObject({ baseAmount: "96.80", amount: "1.45" });
    expect(b.lines[1]).toMatchObject({ kind: "opcion", baseKind: "despues_de_comision" });
    expect(b.net).toBe("95.35");
  });

  test("E4", () => {
    const r = recompute(e1, { refunded: "100.00" });
    expect(r.gross).toBe("0.00");
    expect(r.lines.map((l) => [l.kind, l.amount])).toEqual([
      ["pasarela", "0.00"],
      ["reembolso", "3.20"],
      ["opcion", "0.00"],
      ["plataforma", "0.00"],
    ]);
    expect(r.net).toBe("-3.20");
    expect(r.alloc.lines.map((l) => l.amount)).toEqual(["-1.60", "-0.96", "-0.64"]);
  });

  test("E4: las líneas en cero conservan su regla y la del reembolso dice cuánto se devolvió", () => {
    const r = recompute(e1, { refunded: "100.00" });
    expect(r.lines[0]).toEqual({
      kind: "pasarela",
      refId: "gw-stripe",
      name: "Stripe",
      baseKind: "bruto",
      baseAmount: "0.00",
      pct: "2.9",
      fixed: "0.30",
      amount: "0.00",
    });
    expect(r.lines[1]).toEqual({
      kind: "reembolso",
      refId: null,
      name: "Costo del reembolso",
      baseKind: "fijo",
      baseAmount: "100.00",
      pct: "0",
      fixed: "3.20",
      amount: "3.20",
    });
    expect(r.feesTotal).toBe("3.20");
    expect(r.alloc.baseAmount).toBe("-3.20");
  });

  test("E5", () => {
    const r = recompute(e1, { refunded: "40.00" });
    expect(r.lines.map((l) => l.amount)).toEqual(["2.04", "1.16", "0.90", "3.00"]);
    expect([r.feesTotal, r.net]).toEqual(["7.10", "52.90"]);
    expect(r.alloc.lines.map((l) => l.amount)).toEqual(["26.45", "15.87", "10.58"]);
    expect(r.gross).toBe("60.00");
    expect(r.lines.map((l) => [l.kind, l.baseAmount])).toEqual([
      ["pasarela", "60.00"],
      ["reembolso", "40.00"],
      ["opcion", "60.00"],
      ["plataforma", "60.00"],
    ]);
  });

  test("E6", () => {
    const d = recompute(e1, { dispute: "abierta" });
    expect([d.feesTotal, d.net]).toEqual(["24.70", "75.30"]);
    expect(d.alloc.lines.map((l) => l.amount)).toEqual(["37.65", "22.59", "15.06"]);
    expect(recompute(d, { dispute: "ganada" }).net).toBe("90.30");
  });

  test("E6: la disputa es la última línea; al ganarse, el desglose vuelve a ser el de E1", () => {
    const d = recompute(e1, { dispute: "abierta" });
    expect(d.lines).toHaveLength(4);
    expect(d.lines[3]).toEqual({
      kind: "disputa",
      refId: null,
      name: "Costo de disputa",
      baseKind: "fijo",
      baseAmount: "0.00",
      pct: "0",
      fixed: "15.00",
      amount: "15.00",
    });
    const won = recompute(d, { dispute: "ganada" });
    expect({ ...won, state: e1.state }).toEqual(e1);
  });

  test("E7: 1040 que pagó el comprador; la comisión es la real y el reparto va sobre lo que queda", () => {
    const b = compute(rulesE7(), paidByBuyer("1040.00"), "USD");
    // 1040 × 2,9 % + 0,30 = 30,46 (no 40): lo que la pasarela de verdad se lleva.
    expect(kindsAndAmounts(b)).toEqual([["pasarela", "30.46"]]);
    expect([b.gross, b.feesTotal, b.net]).toEqual(["1040.00", "30.46", "1009.54"]);
    // Aunque el esquema diga «Sobre el bruto»: lo que el comprador pagó de más no es venta del negocio.
    expect(b.alloc).toMatchObject({ baseKind: "neto", baseAmount: "1009.54" });
    // 504,77 · 302,862 · 201,908: truncados suman 1009,53 y el centavo va al de mayor resto (201,908 → 201,91).
    expect(shares(b)).toEqual(["504.77", "302.86", "201.91"]);
    expect(b.state.feesPaidBy).toBe("comprador");
  });

  test("E7b: el mismo cobro pagando nosotros: misma comisión y neto, el reparto sobre el bruto", () => {
    const b = compute(rulesE7(), paid("1040.00"), "USD");
    expect([b.gross, b.feesTotal, b.net]).toEqual(["1040.00", "30.46", "1009.54"]);
    expect(b.alloc).toMatchObject({ baseKind: "bruto", baseAmount: "1040.00" });
    expect(shares(b)).toEqual(["520.00", "312.00", "208.00"]);
    expect(b.state.feesPaidBy).toBe("nosotros");
  });
});

// ─── E8: reembolsos y disputas de un cobro del comprador ─────────────────────────────────────────────────────

/**
 * Lo que es del negocio en un cobro: lo que pagaron los compradores (`buyerFeesOf`), sus comisiones (las demás) y su
 * venta (el bruto menos lo de los compradores). Siempre `net = sale − businessFees`.
 */
function e8Figures(b: Breakdown) {
  const buyerFees = buyerFeesOf(b);
  return { net: b.net, buyerFees, businessFees: sub(b.feesTotal, buyerFees), sale: sub(b.gross, buyerFees) };
}

/**
 * E8: Stripe 2,9 % + 0,30 (no devuelve la comisión; disputa 15,00), cobro de 1040 que pagó el comprador y esquema
 * 50/30/20 «Sobre el bruto» (el reparto va sobre el neto). Lo que pagaron los compradores son las líneas que se
 * cobran sobre lo que el comprador sigue pagando; el costo del reembolso y el de la disputa son del negocio.
 */
describe("E8: reembolsos y disputas de un cobro cuya comisión pagó el comprador", () => {
  const e7 = compute(rulesE7(), paidByBuyer("1040.00"), "USD");

  test("E8a: reembolso total; el comprador recuperó todo y los 30,46 que se queda la pasarela los pierde el negocio", () => {
    const b = recompute(e7, { refunded: "1040.00" });
    expect(kindsAndAmounts(b)).toEqual([
      ["pasarela", "0.00"],
      ["reembolso", "30.46"],
    ]);
    expect(e8Figures(b)).toEqual({ net: "-30.46", buyerFees: "0.00", businessFees: "30.46", sale: "0.00" });
    // El reparto de siempre sobre un neto negativo (como E4, «nosotros» con reembolso total): se reparten 30,46 por
    // mayor resto (15,23 · 9,138 · 6,092 → el centavo al 9,138) y se cambia el signo.
    expect(b.alloc).toMatchObject({ baseKind: "neto", baseAmount: "-30.46" });
    expect(shares(b)).toEqual(["-15.23", "-9.14", "-6.09"]);
  });

  test("E8b: reembolso parcial de 520; el comprador pagó 15,38 y el negocio el costo del reembolso, 15,08", () => {
    const b = recompute(e7, { refunded: "520.00" });
    expect(kindsAndAmounts(b)).toEqual([
      ["pasarela", "15.38"], // 520 × 2,9 % + 0,30
      ["reembolso", "15.08"], // 30,46 − 15,38
    ]);
    expect(e8Figures(b)).toEqual({ net: "489.54", buyerFees: "15.38", businessFees: "15.08", sale: "504.62" });
    // 244,77 · 146,862 · 97,908: truncados suman 489,53 y el centavo va al de mayor resto (97,908 → 97,91).
    expect(b.alloc).toMatchObject({ baseKind: "neto", baseAmount: "489.54" });
    expect(shares(b)).toEqual(["244.77", "146.86", "97.91"]);
  });

  test("E8c: sin reembolso y con la disputa perdida; su costo (15) lo paga el negocio, nunca el comprador", () => {
    const b = compute(rulesE7(), { ...paidByBuyer("1040.00"), dispute: "perdida" }, "USD");
    expect(kindsAndAmounts(b)).toEqual([
      ["pasarela", "30.46"],
      ["disputa", "15.00"],
    ]);
    const e8c = { net: "994.54", buyerFees: "30.46", businessFees: "15.00", sale: "1009.54" };
    expect(e8Figures(b)).toEqual(e8c);
    // Con la disputa abierta, lo mismo.
    expect(e8Figures(recompute(e7, { dispute: "abierta" }))).toEqual(e8c);
  });
});

describe("buyerFeesOf", () => {
  test("con «comprador»: la pasarela, las opciones y la plataforma (E1: 3,20 + 1,50 + 5,00)", () => {
    expect(buyerFeesOf(compute(rulesE1(), paidByBuyer("100.00"), "USD"))).toBe("9.70");
  });

  test("con «nosotros» es 0, también con reembolso y disputa", () => {
    expect(buyerFeesOf(e1)).toBe("0.00");
    expect(buyerFeesOf(recompute(e1, { refunded: "40.00", dispute: "abierta" }))).toBe("0.00");
  });

  test("un desglose guardado antes de saber quién pagó la comisión: 0, la pagó el negocio", () => {
    const { feesPaidBy: _payer, ...oldState } = e1.state;
    const old = { ...(JSON.parse(JSON.stringify(e1)) as Record<string, unknown>), state: oldState };
    expect(buyerFeesOf(parseBreakdown(old))).toBe("0.00");
    // Aun sin pasar por `parseBreakdown` (la clave no está): 0.
    expect(buyerFeesOf(old as unknown as Breakdown)).toBe("0.00");
  });

  test("un cobro fallido no tiene comisiones: 0", () => {
    expect(buyerFeesOf(compute(rulesE1(), { ...paidByBuyer("100.00"), failed: true }, "USD"))).toBe("0.00");
  });
});

// ─── Quién paga la comisión ─────────────────────────────────────────────────────────────────────────────────

describe("compute: quién paga la comisión", () => {
  const e7 = compute(rulesE7(), paidByBuyer("1040.00"), "USD");

  test("las comisiones son las mismas: con opciones, plataforma e internacional, se calculan igual", () => {
    const byBuyer = compute(rulesE1(), paidByBuyer("100.00"), "USD");
    expect(byBuyer.lines).toEqual(e1.lines);
    expect([byBuyer.feesTotal, byBuyer.net]).toEqual([e1.feesTotal, e1.net]);
    // Con un esquema que ya era sobre el neto, el reparto no cambia.
    expect(byBuyer.alloc).toEqual(e1.alloc);
  });

  test("sin esquema no hay reparto, pague quien pague", () => {
    const b = compute({ ...rulesE7(), scheme: null }, paidByBuyer("1040.00"), "USD");
    expect(b.alloc).toEqual({ baseKind: null, baseAmount: "0.00", lines: [] });
  });

  test("un reembolso es sobre lo cobrado, como siempre, y el reparto sigue sobre lo que queda", () => {
    // Se devuelven 40,00 de los 1040,00 que pagó el comprador: no se separa ningún «recargo».
    const r = recompute(e7, { refunded: "40.00" });
    expect(kindsAndAmounts(r)).toEqual([
      ["pasarela", "29.30"], // 1000 × 2,9 % + 0,30
      ["reembolso", "1.16"], // 30,46 − 29,30: lo que la pasarela se queda de lo reembolsado
    ]);
    expect([r.gross, r.feesTotal, r.net]).toEqual(["1000.00", "30.46", "969.54"]);
    expect(r.alloc).toMatchObject({ baseKind: "neto", baseAmount: "969.54" });
    expect(shares(r)).toEqual(["484.77", "290.86", "193.91"]);
    expect(r.state.feesPaidBy).toBe("comprador");
  });

  test("el reembolso total deja el neto negativo y el reparto sobre él, como con E4", () => {
    const r = recompute(e7, { refunded: "1040.00" });
    expect([r.gross, r.feesTotal, r.net]).toEqual(["0.00", "30.46", "-30.46"]);
    expect(r.alloc).toMatchObject({ baseKind: "neto", baseAmount: "-30.46" });
  });

  test("fallido: todo en cero, también la base del reparto (que sigue siendo el neto)", () => {
    const b = recompute(e7, { failed: true });
    expect(b.alloc).toMatchObject({ baseKind: "neto", baseAmount: "0.00" });
    expect(shares(b)).toEqual(["0.00", "0.00", "0.00"]);
  });

  test("recalcular con otras reglas conserva quién pagó", () => {
    const rules = rulesE7();
    const r = recalc(e7, { ...rules, gateway: { ...rules.gateway, pct: "3.5" } });
    expect(r.state.feesPaidBy).toBe("comprador");
    expect(r.alloc.baseKind).toBe("neto");
    expect([r.feesTotal, r.net]).toEqual(["36.70", "1003.30"]);
  });

  test("cambiar quién pagó vuelve a calcular el reparto: de «nosotros» a «comprador» y de vuelta", () => {
    const ours = recompute(e7, { feesPaidBy: "nosotros" });
    expect(ours.alloc).toMatchObject({ baseKind: "bruto", baseAmount: "1040.00" });
    expect(recompute(ours, { feesPaidBy: "comprador" })).toEqual(e7);
  });
});

// ─── Partes que no pagan comisión ───────────────────────────────────────────────────────────────────────────

describe("compute: partes que no pagan comisión", () => {
  const e9 = compute(rulesE9(), paid("1000.00"), "USD");
  const allocRows = (b: Breakdown) => b.alloc.lines.map((l) => [l.name, l.pct, l.amount, l.feeExempt]);
  const NO_PAYER = "Alguien tiene que pagar la comisión: deja al menos una parte sin marcar.";

  test("E9: C no paga comisión: recibe el 20 % del bruto y A y B se reparten lo que queda del neto, 50:30", () => {
    expect([e9.gross, e9.feesTotal, e9.net]).toEqual(["1000.00", "29.30", "970.70"]);
    // La base del reparto sigue siendo el neto, y la suma, exactamente el neto.
    expect(e9.alloc).toMatchObject({ baseKind: "neto", baseAmount: "970.70" });
    // 770,70 × 50/80 = 481,6875 y × 30/80 = 289,0125: truncados suman 770,69 y el centavo va al de mayor resto.
    expect(allocRows(e9)).toEqual([
      ["Grupo A", "50", "481.69", false],
      ["Grupo B", "30", "289.01", false],
      ["Grupo C", "20", "200.00", true],
    ]);
  });

  test("E9b: reembolso total (la pasarela no devuelve la comisión): C recibe 0 y A y B cargan la pérdida", () => {
    const r = recompute(e9, { refunded: "1000.00" });
    expect([r.gross, r.feesTotal, r.net]).toEqual(["0.00", "29.30", "-29.30"]);
    expect(r.alloc).toMatchObject({ baseKind: "neto", baseAmount: "-29.30" });
    // Como E4: se reparte el valor absoluto (2930 × 5/8 = 1831,25 y × 3/8 = 1098,75) y se cambia el signo.
    expect(allocRows(r)).toEqual([
      ["Grupo A", "50", "-18.31", false],
      ["Grupo B", "30", "-10.99", false],
      ["Grupo C", "20", "0.00", true],
    ]);
  });

  test("E9c: si las tres partes están marcadas nadie paga la comisión: se rechaza", () => {
    const all = rulesE9(["ben-a", "ben-b", "ben-c"]);
    expect(() => compute(all, paid("1000.00"), "USD")).toThrow(NO_PAYER);
    expect(() => compute(all, paid("1000.00"), "USD")).toThrow(PayRuleError);
    // Igual al recalcular un cobro (cambiar quién pagó la comisión, por ejemplo).
    const byBuyer = compute(all, paidByBuyer("1000.00"), "USD");
    expect(() => recompute(byBuyer, { feesPaidBy: "nosotros" })).toThrow(NO_PAYER);
  });

  test("con «Resto», el «Resto» paga la comisión aunque todas las líneas estén marcadas; él no se marca", () => {
    const rules = rulesE9(["ben-a", "ben-b"]);
    const scheme = schemeOf(rules);
    const withRest = {
      ...rules,
      scheme: { ...scheme, lines: scheme.lines.slice(0, 2), remainder: { beneficiaryId: "ben-c", name: "Grupo C" } },
    };
    const b = compute(withRest, paid("1000.00"), "USD");
    expect(allocRows(b)).toEqual([
      ["Grupo A", "50", "500.00", true],
      ["Grupo B", "30", "300.00", true],
      ["Grupo C", "20", "170.70", false],
    ]);
    expect(b.alloc.lines.at(-1)?.isRemainder).toBe(true);
  });

  test("quién paga se mira en el reparto completo («Resto» incluido): si no cubre el 100 %, es RangeError", () => {
    // 50 + 30, las dos marcadas y sin «Resto» que complete el 20 %: no es que nadie pague, el esquema no vale.
    const rules = rulesE9(["ben-a", "ben-b", "ben-c"]);
    const scheme = schemeOf(rules);
    const short = { ...rules, scheme: { ...scheme, lines: scheme.lines.slice(0, 2) } };
    expect(() => compute(short, paid("1000.00"), "USD")).toThrow(RangeError);
    // Lo mismo si se pasa del 100 %, aunque tenga «Resto».
    const extra = { beneficiaryId: "ben-d", name: "Grupo D", pct: "0.0001", feeExempt: true };
    const over = {
      ...rules,
      scheme: { ...scheme, lines: [...scheme.lines, extra], remainder: { beneficiaryId: "ben-e", name: "Grupo E" } },
    };
    expect(() => compute(over, paid("1000.00"), "USD")).toThrow(RangeError);
  });

  test("una línea sin marcar de 0 % no paga nada: no cuenta como quien paga", () => {
    const rules = rulesE9(["ben-a", "ben-b", "ben-c"]);
    const scheme = schemeOf(rules);
    const zero = { beneficiaryId: "ben-d", name: "Grupo D", pct: "0", feeExempt: false };
    expect(() => compute({ ...rules, scheme: { ...scheme, lines: [...scheme.lines, zero] } }, paid("1000.00"), "USD")).toThrow(
      NO_PAYER,
    );
  });

  test("dos partes sin comisión: cada una su parte de la venta, como si no hubiera comisión (mayor resto)", () => {
    // 33,33 en 33,3333/33,3333/33,3334 sin comisión daría 11,11 · 11,11 · 11,11 (E2 con otro monto).
    const rules = rulesE9(["ben-a", "ben-b"]);
    const scheme = schemeOf(rules);
    const pcts = ["33.3333", "33.3333", "33.3334"];
    const lines = scheme.lines.map((line, i) => ({ ...line, pct: pcts[i] as string }));
    const b = compute({ ...rules, scheme: { ...scheme, lines } }, paid("33.33"), "USD");
    expect([b.feesTotal, b.net]).toEqual(["1.27", "32.06"]);
    expect(shares(b)).toEqual(["11.11", "11.11", "9.84"]);
    expect(b.alloc.lines.map((l) => l.feeExempt)).toEqual([true, true, false]);
  });

  test("con el comprador la marca no cambia nada: ni se aplica ni se rechaza", () => {
    const marked = compute(rulesE9(), paidByBuyer("1000.00"), "USD");
    const unmarked = compute(rulesE9([]), paidByBuyer("1000.00"), "USD");
    expect(marked.alloc).toEqual(unmarked.alloc);
    expect(shares(marked)).toEqual(["485.35", "291.21", "194.14"]);
    expect(marked.alloc.lines.every((l) => !l.feeExempt)).toBe(true);
    expect(() => compute(rulesE9(["ben-a", "ben-b", "ben-c"]), paidByBuyer("1000.00"), "USD")).not.toThrow();
  });

  test("sobre el bruto la marca no cambia nada: ni se aplica ni se rechaza", () => {
    const marked = compute(rulesE9(["ben-c"], "bruto"), paid("1000.00"), "USD");
    const unmarked = compute(rulesE9([], "bruto"), paid("1000.00"), "USD");
    expect(marked.alloc).toEqual(unmarked.alloc);
    expect(marked.alloc).toMatchObject({ baseKind: "bruto", baseAmount: "1000.00" });
    expect(shares(marked)).toEqual(["500.00", "300.00", "200.00"]);
    expect(() => compute(rulesE9(["ben-a", "ben-b", "ben-c"], "bruto"), paid("1000.00"), "USD")).not.toThrow();
  });

  test("lo que ya existe (todo sin marcar) da exactamente lo de hoy: E1 y su reembolso total (E4)", () => {
    expect(allocRows(e1)).toEqual([
      ["Grupo A", "50", "45.15", false],
      ["Grupo B", "30", "27.09", false],
      ["Grupo C", "20", "18.06", false],
    ]);
    expect(shares(recompute(e1, { refunded: "100.00" }))).toEqual(["-1.60", "-0.96", "-0.64"]);
    expect(shares(compute(rulesE9([]), paid("1000.00"), "USD"))).toEqual(allocate("970.70", ["50", "30", "20"]));
  });

  test("la marca congelada viaja en las reglas del desglose y se conserva al recalcular", () => {
    expect(schemeOf(e9.rules).lines.map((l) => l.feeExempt)).toEqual([false, false, true]);
    expect(recompute(e9, { dispute: "abierta" }).alloc.lines.map((l) => l.feeExempt)).toEqual([false, false, true]);
  });
});

// ─── La retención de la pasarela ────────────────────────────────────────────────────────────────────────────

/** OTF Demo retiene el 5 % durante 30 días para Titular A y Titular B, mitad y mitad. */
const OTF_RETENTION: RetentionRule = {
  pct: "5",
  days: 30,
  recipients: [
    { beneficiaryId: "ben-ta", name: "Titular A", pct: "50" },
    { beneficiaryId: "ben-tb", name: "Titular B", pct: "50" },
  ],
};

/**
 * E10: OTF Demo (2,9 % + 0,20; no devuelve la comisión) con su retención, sin opciones ni plataforma, y el esquema
 * «Sobre el neto»: Grupo A 60 %, Grupo B 30 %, Titular A 5 % y Titular B 5 %, los dos titulares sin comisión.
 */
function rulesE10(retention: RetentionRule | null = OTF_RETENTION): Rules {
  return {
    gateway: {
      id: "gw-otf",
      name: "OTF Demo",
      feeVersionId: "fv-otf",
      pct: "2.9",
      fixed: "0.20",
      refundsReturnFee: false,
      disputeFee: "0.00",
      ...(retention === null ? {} : { retention }),
    },
    extras: [],
    platform: null,
    scheme: {
      schemeId: "sch-otf",
      versionId: "sv-otf",
      name: "Sobre el neto",
      base: "neto",
      lines: [
        { beneficiaryId: "ben-ga", name: "Grupo A", pct: "60", feeExempt: false },
        { beneficiaryId: "ben-gb", name: "Grupo B", pct: "30", feeExempt: false },
        { beneficiaryId: "ben-ta", name: "Titular A", pct: "5", feeExempt: true },
        { beneficiaryId: "ben-tb", name: "Titular B", pct: "5", feeExempt: true },
      ],
      remainder: null,
    },
  };
}

describe("retentionOf: lo que retiene la pasarela", () => {
  const e10 = compute(rulesE10(), paid("1000.00"), "USD");
  const allocRows = (b: Breakdown) => b.alloc.lines.map((l) => [l.name, l.amount]);
  const sharesOf = (b: Breakdown) => retentionOf(b)?.shares.map((s) => [s.name, s.pct, s.amount]);

  test("E10: retiene 50,00 (25,00 a cada titular), se libera el 10 dic 2026 y llega al banco 920,80", () => {
    expect([e10.gross, e10.feesTotal, e10.net]).toEqual(["1000.00", "29.20", "970.80"]);
    expect(retentionOf(e10)).toEqual({
      pct: "5",
      days: 30,
      amount: "50.00",
      shares: [
        { beneficiaryId: "ben-ta", name: "Titular A", pct: "50", amount: "25.00" },
        { beneficiaryId: "ben-tb", name: "Titular B", pct: "50", amount: "25.00" },
      ],
    });
    expect(retentionReleaseOn("2026-11-10", OTF_RETENTION.days)).toBe("2026-12-10");
    expect(payoutOf(e10)).toBe("920.80");
    // El reparto es el de E9 con los titulares: 870,80 en proporción 60:30 da 580,5333 y 290,2666; truncados suman
    // 870,79 y el centavo va al de mayor resto, el Grupo B.
    expect(allocRows(e10)).toEqual([
      ["Grupo A", "580.53"],
      ["Grupo B", "290.27"],
      ["Titular A", "50.00"],
      ["Titular B", "50.00"],
    ]);
  });

  test("E10b: reembolso total: no retiene nada y llega al banco lo mismo que el neto (−29,20)", () => {
    const r = recompute(e10, { refunded: "1000.00" });
    expect([r.gross, r.feesTotal, r.net]).toEqual(["0.00", "29.20", "-29.20"]);
    expect(retentionOf(r)?.amount).toBe("0.00");
    expect(sharesOf(r)).toEqual([
      ["Titular A", "50", "0.00"],
      ["Titular B", "50", "0.00"],
    ]);
    expect(payoutOf(r)).toBe("-29.20");
    // Como E9b: los titulares en 0 y los grupos se reparten −29,20 con el mayor resto de siempre (19,466 y 9,733).
    expect(allocRows(r)).toEqual([
      ["Grupo A", "-19.47"],
      ["Grupo B", "-9.73"],
      ["Titular A", "0.00"],
      ["Titular B", "0.00"],
    ]);
  });

  test("E10c: reembolso parcial de 400: retiene 30,00 (15,00 · 15,00) sobre el bruto vigente de 600", () => {
    const r = recompute(e10, { refunded: "400.00" });
    // Pasarela r(600 × 2,9 % + 0,20) = 17,60 y costo del reembolso 29,20 − 17,60 = 11,60: el neto es 570,80.
    expect([r.gross, r.feesTotal, r.net]).toEqual(["600.00", "29.20", "570.80"]);
    expect(sharesOf(r)).toEqual([
      ["Titular A", "50", "15.00"],
      ["Titular B", "50", "15.00"],
    ]);
    expect(retentionOf(r)?.amount).toBe("30.00");
    expect(payoutOf(r)).toBe("540.80");
    expect(allocRows(r)).toEqual([
      ["Grupo A", "340.53"],
      ["Grupo B", "170.27"],
      ["Titular A", "30.00"],
      ["Titular B", "30.00"],
    ]);
  });

  test("E10d: fallido: no retiene nada y no llega nada", () => {
    const r = recompute(e10, { failed: true });
    expect(retentionOf(r)?.amount).toBe("0.00");
    expect(payoutOf(r)).toBe("0.00");
  });

  test("un desglose sin retención (o de antes de existir) no retiene nada: llega al banco el neto", () => {
    const plain = compute(rulesE10(null), paid("1000.00"), "USD");
    expect(retentionOf(plain)).toBeNull();
    expect(payoutOf(plain)).toBe("970.80");
    expect(retentionOf(e1)).toBeNull();
    expect(payoutOf(e1)).toBe("90.30");
  });

  test("la retención no es una comisión: neto, comisiones, venta, reparto y lo de los compradores no cambian", () => {
    for (const state of [paid("1000.00"), paidByBuyer("1000.00"), { ...paid("1000.00"), refunded: "400.00" }]) {
      const withIt = compute(rulesE10(), state, "USD");
      const without = compute(rulesE10(null), state, "USD");
      const { rules: _withRules, ...numbers } = withIt;
      const { rules: _withoutRules, ...same } = without;
      expect(numbers).toEqual(same);
      expect(buyerFeesOf(withIt)).toBe(buyerFeesOf(without));
    }
  });

  test("al centavo, mitad hacia arriba, y las partes por mayor resto: suman exactamente lo retenido", () => {
    const thirds: RetentionRule = {
      pct: "2.5",
      days: 7,
      recipients: [
        { beneficiaryId: "x", name: "Titular A", pct: "33.3333" },
        { beneficiaryId: "y", name: "Titular B", pct: "33.3333" },
        { beneficiaryId: "z", name: "Grupo A", pct: "33.3334" },
      ],
    };
    // 33,33 × 2,5 % = 0,83325 → 0,83; 83 centavos en tercios: 27 cada uno y los 2 que sobran a los de mayor resto.
    const r = compute(rulesE10(thirds), paid("33.33"), "USD");
    expect(retentionOf(r)?.amount).toBe("0.83");
    expect(retentionOf(r)?.shares.map((s) => s.amount)).toEqual(["0.28", "0.27", "0.28"]);
    // 10,10 × 5 % = 0,505 → 0,51: el mismo redondeo que las líneas de comisión.
    expect(retentionOf(compute(rulesE10(), paid("10.10"), "USD"))?.amount).toBe("0.51");
  });

  test("viaja congelada en las reglas: recompute la conserva y recalc toma la nueva (o ninguna)", () => {
    expect(recompute(e10, { refunded: "400.00" }).rules.gateway.retention).toEqual(OTF_RETENTION);
    const before = compute(rulesE10(null), paid("1000.00"), "USD");
    const after = recalc(before, rulesE10());
    expect(retentionOf(after)?.amount).toBe("50.00");
    expect(retentionOf(recalc(e10, rulesE10(null)))).toBeNull();
  });

  test("la fecha en que se libera es la del cobro más los días corridos, aunque caiga en fin de semana", () => {
    expect(retentionReleaseOn("2026-11-10", 0)).toBe("2026-11-10");
    expect(retentionReleaseOn("2026-11-13", 1)).toBe("2026-11-14");
    expect(retentionReleaseOn("2026-12-15", 30)).toBe("2027-01-14");
  });
});

// ─── Reembolsos ─────────────────────────────────────────────────────────────────────────────────────────────

describe("compute: reembolsos", () => {
  test("pasarela que sí devuelve la comisión: reembolso de 40 sin línea de reembolso", () => {
    const b = compute(rulesWithGateway({ refundsReturnFee: true }), { ...paid("100.00"), refunded: "40.00" }, "USD");
    expect(kindsAndAmounts(b)).toEqual([
      ["pasarela", "2.04"],
      ["opcion", "0.90"],
      ["plataforma", "3.00"],
    ]);
    expect([b.gross, b.feesTotal, b.net]).toEqual(["60.00", "5.94", "54.06"]);
    expect(shares(b)).toEqual(["27.03", "16.22", "10.81"]);
  });

  test("pasarela que sí devuelve la comisión: reembolso total deja todo en 0,00", () => {
    const b = compute(rulesWithGateway({ refundsReturnFee: true }), { ...paid("100.00"), refunded: "100.00" }, "USD");
    expect(kindsAndAmounts(b)).toEqual([
      ["pasarela", "0.00"],
      ["opcion", "0.00"],
      ["plataforma", "0.00"],
    ]);
    expect([b.gross, b.feesTotal, b.net]).toEqual(["0.00", "0.00", "0.00"]);
    expect(shares(b)).toEqual(["0.00", "0.00", "0.00"]);
  });

  test("la opción «después de la comisión» descuenta también el costo del reembolso", () => {
    // 60,00 − 2,04 − 1,16 = 56,80 → 1,5 % = 0,852 → 0,85
    const b = compute(rulesE3(), { ...paid("100.00"), refunded: "40.00" }, "USD");
    expect(b.lines.map((l) => [l.kind, l.baseAmount, l.amount])).toEqual([
      ["pasarela", "60.00", "2.04"],
      ["reembolso", "40.00", "1.16"],
      ["opcion", "56.80", "0.85"],
    ]);
    expect(b.net).toBe("55.95");
  });

  test("la base «después de la comisión» nunca baja de cero", () => {
    // Queda 1,00: pasarela 0,33, costo del reembolso 2,87 → 1,00 − 0,33 − 2,87 < 0
    const b = compute(rulesE3(), { ...paid("100.00"), refunded: "99.00" }, "USD");
    expect(b.lines.map((l) => [l.kind, l.baseAmount, l.amount])).toEqual([
      ["pasarela", "1.00", "0.33"],
      ["reembolso", "99.00", "2.87"],
      ["opcion", "0.00", "0.00"],
    ]);
    expect([b.feesTotal, b.net]).toEqual(["3.20", "-2.20"]);
  });

  test("con reembolso total las cuotas fijas de opciones y plataforma no se cobran", () => {
    const base = rulesE1();
    const rules: Rules = {
      ...base,
      extras: [{ ...extraOf(base), pct: "1", fixed: "0.25" }],
      platform: { channelId: "ch-web", name: "Tienda en línea", pct: "5", fixed: "0.10" },
    };
    expect(amounts(compute(rules, paid("100.00"), "USD"))).toEqual(["3.20", "1.25", "5.10"]);
    const refunded = compute(rules, { ...paid("100.00"), refunded: "100.00" }, "USD");
    expect(amounts(refunded)).toEqual(["0.00", "3.20", "0.00", "0.00"]);
    expect(refunded.lines.map((l) => l.fixed)).toEqual(["0.30", "3.20", "0.25", "0.10"]);
  });

  test("la línea de reembolso se emite aunque valga 0,00 (pasarela sin porcentaje)", () => {
    const b = compute(rulesWithGateway({ pct: "0" }), { ...paid("100.00"), refunded: "40.00" }, "USD");
    expect(kindsAndAmounts(b).slice(0, 2)).toEqual([
      ["pasarela", "0.30"],
      ["reembolso", "0.00"],
    ]);
  });
});

// ─── Comisión informada por la pasarela ─────────────────────────────────────────────────────────────────────

describe("compute: feeOverride (comisión real informada)", () => {
  const informed = () => rulesWithGateway({ feeOverride: "4.70" });

  test("la línea de pasarela es «informado» y vale lo informado", () => {
    const b = compute(informed(), paid("100.00"), "USD");
    expect(b.lines[0]).toEqual({
      kind: "pasarela",
      refId: "gw-stripe",
      name: "Stripe",
      baseKind: "informado",
      baseAmount: "100.00",
      pct: "0",
      fixed: "4.70",
      amount: "4.70",
    });
    expect([b.feesTotal, b.net]).toEqual(["11.20", "88.80"]);
  });

  test("reembolso de 40 sin devolución: 2,82 de pasarela + 1,88 de costo del reembolso", () => {
    const b = compute(informed(), { ...paid("100.00"), refunded: "40.00" }, "USD");
    expect(kindsAndAmounts(b)).toEqual([
      ["pasarela", "2.82"],
      ["reembolso", "1.88"],
      ["opcion", "0.90"],
      ["plataforma", "3.00"],
    ]);
    expect(b.lines[0]).toMatchObject({ baseKind: "informado", baseAmount: "60.00", pct: "0", fixed: "2.82" });
    expect([b.feesTotal, b.net]).toEqual(["8.60", "51.40"]);
  });

  test("reembolso total sin devolución: la pasarela se queda con todo lo informado", () => {
    const b = compute(informed(), { ...paid("100.00"), refunded: "100.00" }, "USD");
    expect(kindsAndAmounts(b).slice(0, 2)).toEqual([
      ["pasarela", "0.00"],
      ["reembolso", "4.70"],
    ]);
    expect(b.lines[0]).toMatchObject({ baseKind: "informado", pct: "0", fixed: "0.00" });
    expect(b.net).toBe("-4.70");
  });

  test("reembolso de 40 con devolución: proporcional y sin línea de reembolso", () => {
    const rules = rulesWithGateway({ feeOverride: "4.70", refundsReturnFee: true });
    const b = compute(rules, { ...paid("100.00"), refunded: "40.00" }, "USD");
    expect(kindsAndAmounts(b)).toEqual([
      ["pasarela", "2.82"],
      ["opcion", "0.90"],
      ["plataforma", "3.00"],
    ]);
  });

  test("la opción «después de la comisión» usa la comisión informada", () => {
    // 100,00 − 4,70 = 95,30 → 1,5 % = 1,4295 → 1,43
    const rules: Rules = { ...rulesE3(), gateway: { ...rulesE1().gateway, feeOverride: "4.70" } };
    const b = compute(rules, paid("100.00"), "USD");
    expect(b.lines[1]).toMatchObject({ baseAmount: "95.30", amount: "1.43" });
  });

  test("una comisión informada de 0,00 también manda sobre la tarifa", () => {
    const b = compute(rulesWithGateway({ feeOverride: "0.00" }), paid("100.00"), "USD");
    expect(b.lines[0]).toMatchObject({ baseKind: "informado", amount: "0.00" });
    expect(b.net).toBe("93.50");
  });
});

// ─── Disputas ───────────────────────────────────────────────────────────────────────────────────────────────

describe("compute: disputas", () => {
  test("perdida, con reembolso total: costo del reembolso más costo de disputa", () => {
    const b = recompute(e1, { dispute: "perdida", refunded: "100.00" });
    expect(kindsAndAmounts(b)).toEqual([
      ["pasarela", "0.00"],
      ["reembolso", "3.20"],
      ["opcion", "0.00"],
      ["plataforma", "0.00"],
      ["disputa", "15.00"],
    ]);
    expect([b.feesTotal, b.net]).toEqual(["18.20", "-18.20"]);
    expect(shares(b)).toEqual(["-9.10", "-5.46", "-3.64"]);
  });

  test("ganada o sin disputa: no hay línea de disputa", () => {
    expect(recompute(e1, { dispute: "ganada" }).lines.map((l) => l.kind)).not.toContain("disputa");
    expect(recompute(e1, { dispute: null }).lines.map((l) => l.kind)).not.toContain("disputa");
  });
});

// ─── Reparto ────────────────────────────────────────────────────────────────────────────────────────────────

describe("compute: reparto", () => {
  test("esquema sobre el bruto", () => {
    const base = rulesE1();
    const rules: Rules = { ...base, scheme: { ...schemeOf(base), base: "bruto" } };
    const b = compute(rules, paid("100.00"), "USD");
    expect(b.alloc.baseKind).toBe("bruto");
    expect(b.alloc.baseAmount).toBe("100.00");
    expect(shares(b)).toEqual(["50.00", "30.00", "20.00"]);
    expect(b.net).toBe("90.30");

    const refunded = recompute(b, { refunded: "40.00" });
    expect(refunded.alloc.baseAmount).toBe("60.00");
    expect(shares(refunded)).toEqual(["30.00", "18.00", "12.00"]);
  });

  test("esquema con «Resto»: lo que falta para 100 % va al final", () => {
    const base = rulesE1();
    const rules: Rules = {
      ...base,
      scheme: {
        ...schemeOf(base),
        lines: schemeOf(base).lines.slice(0, 2),
        remainder: { beneficiaryId: "ben-c", name: "Grupo C" },
      },
    };
    const b = compute(rules, paid("100.00"), "USD");
    expect(b.alloc.lines).toEqual([
      { beneficiaryId: "ben-a", name: "Grupo A", pct: "50", amount: "45.15", isRemainder: false, feeExempt: false },
      { beneficiaryId: "ben-b", name: "Grupo B", pct: "30", amount: "27.09", isRemainder: false, feeExempt: false },
      { beneficiaryId: "ben-c", name: "Grupo C", pct: "20", amount: "18.06", isRemainder: true, feeExempt: false },
    ]);
  });

  test("el porcentaje del «Resto» es exacto también con cuatro decimales", () => {
    const base = rulesE1();
    const rules: Rules = {
      ...base,
      scheme: {
        ...schemeOf(base),
        lines: [
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "33.3333", feeExempt: false },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "33.3333", feeExempt: false },
        ],
        remainder: { beneficiaryId: "ben-c", name: "Grupo C" },
      },
    };
    const b = compute(rules, paid("100.00"), "USD");
    expect(b.alloc.lines.map((l) => [l.pct, l.isRemainder])).toEqual([
      ["33.3333", false],
      ["33.3333", false],
      ["33.3334", true],
    ]);
  });

  test("si las líneas ya suman 100 % no se añade el «Resto» aunque exista", () => {
    const base = rulesE1();
    const rules: Rules = {
      ...base,
      scheme: { ...schemeOf(base), remainder: { beneficiaryId: "ben-d", name: "Grupo D" } },
    };
    const b = compute(rules, paid("100.00"), "USD");
    expect(b.alloc.lines.map((l) => l.beneficiaryId)).toEqual(["ben-a", "ben-b", "ben-c"]);
    expect(b.alloc.lines.every((l) => !l.isRemainder)).toBe(true);
  });

  test("esquema que suma menos de 100 % y no tiene «Resto»: RangeError", () => {
    const base = rulesE1();
    const rules: Rules = { ...base, scheme: { ...schemeOf(base), lines: schemeOf(base).lines.slice(0, 2) } };
    expect(() => compute(rules, paid("100.00"), "USD")).toThrow(RangeError);
    expect(() => compute(rules, { ...paid("100.00"), failed: true }, "USD")).toThrow(RangeError);
  });

  test("esquema que suma más de 100 %: RangeError, con o sin «Resto»", () => {
    const base = rulesE1();
    const lines = [...schemeOf(base).lines, { beneficiaryId: "ben-d", name: "Grupo D", pct: "0.0001", feeExempt: false }];
    const rules: Rules = { ...base, scheme: { ...schemeOf(base), lines } };
    expect(() => compute(rules, paid("100.00"), "USD")).toThrow(RangeError);
    const withRemainder: Rules = {
      ...base,
      scheme: { ...schemeOf(base), lines, remainder: { beneficiaryId: "ben-e", name: "Grupo E" } },
    };
    expect(() => compute(withRemainder, paid("100.00"), "USD")).toThrow(RangeError);
  });

  test("sin esquema no hay reparto", () => {
    const b = compute({ ...rulesE1(), scheme: null }, paid("100.00"), "USD");
    expect(b.alloc).toEqual({ baseKind: null, baseAmount: "0.00", lines: [] });
    expect(b.net).toBe("90.30");
  });
});

// ─── Fallido, normalización y entradas inválidas ────────────────────────────────────────────────────────────

describe("compute: cobro fallido", () => {
  test("todo en 0,00, sin líneas de comisión; el reparto conserva las líneas del esquema", () => {
    const rules = rulesE1();
    const state: State = { ...paid("100.00"), failed: true };
    expect(compute(rules, state, "USD")).toEqual({
      v: 1,
      currency: "USD",
      rules,
      state,
      gross: "0.00",
      lines: [],
      feesTotal: "0.00",
      net: "0.00",
      alloc: {
        baseKind: "neto",
        baseAmount: "0.00",
        lines: [
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "50", amount: "0.00", isRemainder: false, feeExempt: false },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "30", amount: "0.00", isRemainder: false, feeExempt: false },
          { beneficiaryId: "ben-c", name: "Grupo C", pct: "20", amount: "0.00", isRemainder: false, feeExempt: false },
        ],
      },
    });
  });

  test("ni el reembolso ni la disputa le suman costos a un fallido", () => {
    const b = recompute(e1, { failed: true, refunded: "40.00", dispute: "abierta" });
    expect([b.gross, b.feesTotal, b.net, b.lines.length]).toEqual(["0.00", "0.00", "0.00", 0]);
  });

  test("fallido sin esquema", () => {
    const b = compute({ ...rulesE1(), scheme: null }, { ...paid("100.00"), failed: true }, "USD");
    expect(b.alloc).toEqual({ baseKind: null, baseAmount: "0.00", lines: [] });
  });

  test("si deja de estar fallido vuelve el cálculo normal", () => {
    const failed = recompute(e1, { failed: true });
    expect(recompute(failed, { failed: false })).toEqual(e1);
  });
});

describe("compute: porcentajes normalizados y entradas inválidas", () => {
  test("los porcentajes de las líneas se guardan sin ceros de relleno; las reglas quedan como llegaron", () => {
    const base = rulesE1();
    const rules: Rules = {
      gateway: { ...base.gateway, pct: "2.9000" },
      extras: [{ ...extraOf(base), pct: "1.5000" }],
      platform: { channelId: "ch-web", name: "Tienda en línea", pct: "5.0000", fixed: "0.00" },
      scheme: {
        ...schemeOf(base),
        lines: [
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "50.0000", feeExempt: false },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "30.0000", feeExempt: false },
        ],
        remainder: { beneficiaryId: "ben-c", name: "Grupo C" },
      },
    };
    const b = compute(rules, paid("100.00"), "USD");
    expect(b.lines.map((l) => l.pct)).toEqual(["2.9", "1.5", "5"]);
    expect(b.alloc.lines.map((l) => l.pct)).toEqual(["50", "30", "20"]);
    expect(amounts(b)).toEqual(amounts(e1));
    expect(shares(b)).toEqual(shares(e1));
    expect(b.rules).toEqual(rules);
    expect(b.rules.gateway.pct).toBe("2.9000");
  });

  test("la moneda viaja tal cual", () => {
    expect(compute(rulesE1(), paid("100.00"), "EUR").currency).toBe("EUR");
  });

  test.each(["0.00", "-5.00", "-0.00"])("grossOriginal %s: RangeError", (grossOriginal) => {
    expect(() => compute(rulesE1(), paid(grossOriginal), "USD")).toThrow(RangeError);
    expect(() => compute(rulesE1(), { ...paid(grossOriginal), failed: true }, "USD")).toThrow(RangeError);
  });

  test.each(["-0.01", "100.01", "250.00"])("refunded %s sobre 100,00: RangeError", (refunded) => {
    expect(() => compute(rulesE1(), { ...paid("100.00"), refunded }, "USD")).toThrow(RangeError);
  });

  test("el reembolso puede ser exactamente cero o exactamente el total", () => {
    expect(() => compute(rulesE1(), { ...paid("100.00"), refunded: "0.00" }, "USD")).not.toThrow();
    expect(() => compute(rulesE1(), { ...paid("100.00"), refunded: "100.00" }, "USD")).not.toThrow();
  });

  test.each(["100", "100.5", "100.005", "1e2", "abc", ""])("un monto que no es canónico («%s»): RangeError", (text) => {
    expect(() => compute(rulesE1(), paid(text), "USD")).toThrow(RangeError);
    expect(() => compute(rulesE1(), { ...paid("100.00"), refunded: text }, "USD")).toThrow(RangeError);
    expect(() => compute(rulesWithGateway({ fixed: text }), paid("100.00"), "USD")).toThrow(RangeError);
    expect(() => compute(rulesWithGateway({ feeOverride: text }), paid("100.00"), "USD")).toThrow(RangeError);
    expect(() => compute(rulesWithGateway({ disputeFee: text }), { ...paid("100.00"), dispute: "abierta" }, "USD")).toThrow(
      RangeError,
    );
    expect(() =>
      compute({ ...rulesE1(), extras: [{ ...extraOf(rulesE1()), fixed: text }] }, paid("100.00"), "USD"),
    ).toThrow(RangeError);
    expect(() =>
      compute({ ...rulesE1(), platform: { channelId: "c", name: "Canal", pct: "5", fixed: text } }, paid("100.00"), "USD"),
    ).toThrow(RangeError);
  });

  test("un porcentaje que no es un decimal: RangeError", () => {
    expect(() => compute(rulesWithGateway({ pct: "2,9" }), paid("100.00"), "USD")).toThrow(RangeError);
  });
});

// ─── recompute, recalc, diff ────────────────────────────────────────────────────────────────────────────────

describe("recompute y recalc", () => {
  test("recompute(b, {}) es idéntico a b", () => {
    expect(recompute(e1, {})).toStrictEqual(e1);
    const refunded = recompute(e1, { refunded: "40.00", dispute: "abierta" });
    expect(recompute(refunded, {})).toStrictEqual(refunded);
  });

  test("recompute conserva las reglas congeladas y la moneda, y no modifica el original", () => {
    const eur = compute(rulesE1(), paid("100.00"), "EUR");
    const copy = structuredClone(eur);
    const r = recompute(eur, { refunded: "40.00" });
    expect(r.rules).toEqual(eur.rules);
    expect(r.currency).toBe("EUR");
    expect(r.state).toEqual({
      grossOriginal: "100.00",
      refunded: "40.00",
      dispute: null,
      failed: false,
      feesPaidBy: "nosotros",
    });
    expect(eur).toStrictEqual(copy);
  });

  test("recompute con otro monto cobrado", () => {
    const r = recompute(e1, { grossOriginal: "200.00" });
    expect(amounts(r)).toEqual(["6.10", "3.00", "10.00"]);
    expect(r.net).toBe("180.90");
  });

  test("recalc con la tarifa 3,2 % + 0,30 cambia solo lo esperado y diff lo enumera", () => {
    const rules = rulesWithGateway({ feeVersionId: "fv-2", pct: "3.2" });
    const r = recalc(e1, rules);
    expect(r.rules).toEqual(rules);
    expect(r.state).toEqual(e1.state);
    expect(r.currency).toBe("USD");
    expect(kindsAndAmounts(r)).toEqual([
      ["pasarela", "3.50"],
      ["opcion", "1.50"],
      ["plataforma", "5.00"],
    ]);
    expect(r.gross).toBe(e1.gross);
    expect(r.lines.slice(1)).toEqual(e1.lines.slice(1));
    expect([r.feesTotal, r.net]).toEqual(["10.00", "90.00"]);
    expect(shares(r)).toEqual(["45.00", "27.00", "18.00"]);

    expect(diff(e1, r)).toEqual([
      { key: "line:pasarela:gw-stripe", label: "Stripe", before: "3.20", after: "3.50" },
      { key: "feesTotal", label: "Comisiones", before: "9.70", after: "10.00" },
      { key: "net", label: "Neto", before: "90.30", after: "90.00" },
      { key: "alloc:ben-a", label: "Grupo A", before: "45.15", after: "45.00" },
      { key: "alloc:ben-b", label: "Grupo B", before: "27.09", after: "27.00" },
      { key: "alloc:ben-c", label: "Grupo C", before: "18.06", after: "18.00" },
    ]);
  });

  test("recalc con las mismas reglas no cambia nada", () => {
    const refunded = recompute(e1, { refunded: "40.00" });
    expect(recalc(refunded, refunded.rules)).toStrictEqual(refunded);
  });

  test("recalc conserva el estado: un reembolso sigue reembolsado con la tarifa nueva", () => {
    const refunded = recompute(e1, { refunded: "40.00" });
    const r = recalc(refunded, rulesWithGateway({ feeVersionId: "fv-2", pct: "3.2" }));
    // F0 = 3,50; sobre 60,00 → 1,92 + 0,30 = 2,22; costo del reembolso 1,28
    expect(amounts(r)).toEqual(["2.22", "1.28", "0.90", "3.00"]);
  });
});

describe("diff", () => {
  test("sin cambios no devuelve nada", () => {
    expect(diff(e1, e1)).toEqual([]);
    expect(diff(e1, recompute(e1, {}))).toEqual([]);
  });

  test("reembolso parcial: una línea que aparece lleva «—» antes y va en su lugar", () => {
    expect(diff(e1, recompute(e1, { refunded: "40.00" }))).toEqual([
      { key: "gross", label: "Bruto", before: "100.00", after: "60.00" },
      { key: "line:pasarela:gw-stripe", label: "Stripe", before: "3.20", after: "2.04" },
      { key: "line:reembolso:Costo del reembolso", label: "Costo del reembolso", before: "—", after: "1.16" },
      { key: "line:opcion:ex-rapido", label: "Pago rápido", before: "1.50", after: "0.90" },
      { key: "line:plataforma:ch-web", label: "Tienda en línea", before: "5.00", after: "3.00" },
      { key: "feesTotal", label: "Comisiones", before: "9.70", after: "7.10" },
      { key: "net", label: "Neto", before: "90.30", after: "52.90" },
      { key: "alloc:ben-a", label: "Grupo A", before: "45.15", after: "26.45" },
      { key: "alloc:ben-b", label: "Grupo B", before: "27.09", after: "15.87" },
      { key: "alloc:ben-c", label: "Grupo C", before: "18.06", after: "10.58" },
    ]);
  });

  test("disputa ganada: una línea que desaparece lleva «—» después", () => {
    const open = recompute(e1, { dispute: "abierta" });
    expect(diff(open, recompute(open, { dispute: "ganada" }))).toEqual([
      { key: "line:disputa:Costo de disputa", label: "Costo de disputa", before: "15.00", after: "—" },
      { key: "feesTotal", label: "Comisiones", before: "24.70", after: "9.70" },
      { key: "net", label: "Neto", before: "75.30", after: "90.30" },
      { key: "alloc:ben-a", label: "Grupo A", before: "37.65", after: "45.15" },
      { key: "alloc:ben-b", label: "Grupo B", before: "22.59", after: "27.09" },
      { key: "alloc:ben-c", label: "Grupo C", before: "15.06", after: "18.06" },
    ]);
  });

  test("otro esquema: beneficiarios que salen y que entran", () => {
    const base = rulesE1();
    const rules: Rules = {
      ...base,
      scheme: {
        ...schemeOf(base),
        versionId: "sv-2",
        lines: [
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "60", feeExempt: false },
          { beneficiaryId: "ben-d", name: "Grupo D", pct: "40", feeExempt: false },
        ],
      },
    };
    expect(diff(e1, recalc(e1, rules))).toEqual([
      { key: "alloc:ben-a", label: "Grupo A", before: "45.15", after: "54.18" },
      { key: "alloc:ben-b", label: "Grupo B", before: "27.09", after: "—" },
      { key: "alloc:ben-c", label: "Grupo C", before: "18.06", after: "—" },
      { key: "alloc:ben-d", label: "Grupo D", before: "—", after: "36.12" },
    ]);
  });

  test("opciones que salen y que entran; la etiqueta es el nombre de después", () => {
    const base = rulesE1();
    const rules: Rules = {
      ...base,
      gateway: { ...base.gateway, name: "Stripe (tarifa nueva)", pct: "3.2" },
      extras: [{ id: "ex-otra", name: "Otra opción", pct: "1.5", fixed: "0.00", base: "bruto", payoutDaysOverride: null }],
    };
    expect(diff(e1, recalc(e1, rules)).slice(0, 3)).toEqual([
      { key: "line:pasarela:gw-stripe", label: "Stripe (tarifa nueva)", before: "3.20", after: "3.50" },
      { key: "line:opcion:ex-rapido", label: "Pago rápido", before: "1.50", after: "—" },
      { key: "line:opcion:ex-otra", label: "Otra opción", before: "—", after: "1.50" },
    ]);
  });

  test("recalcular para traer la retención: «Retenido» y lo de cada persona pasan de «—» a su monto", () => {
    const before = compute(rulesE10(null), paid("1000.00"), "USD");
    const after = recalc(before, rulesE10());
    expect(diff(before, after)).toEqual([
      { key: "retention", label: "Retenido", before: "—", after: "50.00" },
      { key: "retention:ben-ta", label: "Retenido · Titular A", before: "—", after: "25.00" },
      { key: "retention:ben-tb", label: "Retenido · Titular B", before: "—", after: "25.00" },
    ]);
    // Al revés, la retención que se quita.
    expect(diff(after, before).map((row) => [row.key, row.after])).toEqual([
      ["retention", "—"],
      ["retention:ben-ta", "—"],
      ["retention:ben-tb", "—"],
    ]);
  });

  test("un cobro que pasa a fallido pierde todas sus líneas", () => {
    expect(diff(e1, recompute(e1, { failed: true })).map((row) => [row.key, row.before, row.after])).toEqual([
      ["gross", "100.00", "0.00"],
      ["line:pasarela:gw-stripe", "3.20", "—"],
      ["line:opcion:ex-rapido", "1.50", "—"],
      ["line:plataforma:ch-web", "5.00", "—"],
      ["feesTotal", "9.70", "0.00"],
      ["net", "90.30", "0.00"],
      ["alloc:ben-a", "45.15", "0.00"],
      ["alloc:ben-b", "27.09", "0.00"],
      ["alloc:ben-c", "18.06", "0.00"],
    ]);
  });
});

// ─── parseBreakdown ─────────────────────────────────────────────────────────────────────────────────────────

describe("parseBreakdown", () => {
  const stored = (b: Breakdown): Record<string, unknown> => JSON.parse(JSON.stringify(b)) as Record<string, unknown>;

  test("acepta lo que compute produce, tal como vuelve de la base", () => {
    expect(parseBreakdown(stored(e1))).toEqual(e1);
    const complex = compute(
      rulesWithGateway({ feeOverride: "4.70" }),
      { grossOriginal: "100.00", refunded: "40.00", dispute: "perdida", failed: false, feesPaidBy: "nosotros" },
      "EUR",
    );
    expect(parseBreakdown(stored(complex))).toEqual(complex);
    const byBuyer = compute(rulesE1(), paidByBuyer("100.00"), "USD");
    expect(parseBreakdown(stored(byBuyer))).toEqual(byBuyer);
    const bare = compute({ ...rulesE1(), extras: [], platform: null, scheme: null }, paid("100.00"), "USD");
    expect(parseBreakdown(stored(bare))).toEqual(bare);
    const failed = recompute(e1, { failed: true });
    expect(parseBreakdown(stored(failed))).toEqual(failed);
  });

  test("acepta el objeto en memoria (con feeOverride sin definir)", () => {
    const b = compute(rulesWithGateway({ feeOverride: undefined }), paid("100.00"), "USD");
    expect(parseBreakdown(b).net).toBe("90.30");
  });

  test("una opción puede congelar el máximo de su ventana de días (un entero); sin él, como antes", () => {
    const [rapido] = e1.rules.extras;
    const windowed = compute(
      { ...rulesE1(), extras: [{ ...rapido!, payoutDaysOverride: 1, payoutDaysOverrideMax: 3 }] },
      paid("100.00"),
      "USD",
    );
    expect(parseBreakdown(stored(windowed)).rules.extras[0]?.payoutDaysOverrideMax).toBe(3);
    expect(parseBreakdown(stored(e1)).rules.extras[0]).not.toHaveProperty("payoutDaysOverrideMax");
    const extras = (payoutDaysOverrideMax: unknown) => [{ ...rapido, payoutDaysOverrideMax }];
    for (const bad of [2.5, "3", null]) {
      expect(() => parseBreakdown({ ...stored(e1), rules: { ...e1.rules, extras: extras(bad) } })).toThrow();
    }
  });

  test("un desglose guardado antes de saber quién pagó la comisión se lee como pagado por nosotros", () => {
    const { feesPaidBy: _payer, ...oldState } = e1.state;
    const old = { ...stored(e1), state: oldState };
    expect(parseBreakdown(old)).toEqual(e1);
    expect(parseBreakdown(old).state.feesPaidBy).toBe("nosotros");
  });

  test("un desglose guardado antes de las partes sin comisión se lee sin marcas y da exactamente lo mismo", () => {
    const old = stored(e1) as { rules: { scheme: { lines: Record<string, unknown>[] } }; alloc: { lines: Record<string, unknown>[] } };
    // Sin la clave en las líneas del esquema ni en las del reparto, como se guardaban antes.
    old.rules.scheme.lines = old.rules.scheme.lines.map(({ feeExempt: _mark, ...line }) => line);
    old.alloc.lines = old.alloc.lines.map(({ feeExempt: _mark, ...line }) => line);
    expect(JSON.stringify(old)).not.toContain("feeExempt");
    const parsed = parseBreakdown(old);
    expect(parsed).toEqual(e1);
    expect(schemeOf(parsed.rules).lines.map((l) => l.feeExempt)).toEqual([false, false, false]);
    expect(recompute(parsed, {})).toEqual(e1);
    // Con la marca, se lee tal cual; y tiene que ser un booleano.
    const e9 = compute(rulesE9(), paid("1000.00"), "USD");
    expect(parseBreakdown(stored(e9))).toEqual(e9);
    const scheme = schemeOf(e1.rules);
    const badLine = { ...scheme.lines[0], feeExempt: "true" };
    expect(() => parseBreakdown({ ...stored(e1), rules: { ...e1.rules, scheme: { ...scheme, lines: [badLine] } } })).toThrow();
  });

  test("la retención congelada se lee tal cual; sin ella, el desglose no la trae", () => {
    const e10 = compute(rulesE10(), paid("1000.00"), "USD");
    expect(parseBreakdown(JSON.parse(JSON.stringify(e10)))).toEqual(e10);
    const plain = parseBreakdown(JSON.parse(JSON.stringify(e1)));
    expect(plain.rules.gateway).not.toHaveProperty("retention");
    const broken = JSON.parse(JSON.stringify(e10));
    broken.rules.gateway.retention.days = 1.5;
    expect(() => parseBreakdown(broken)).toThrow();
    broken.rules.gateway.retention = { ...OTF_RETENTION, extra: true };
    expect(() => parseBreakdown(broken)).toThrow();
  });

  test("quién pagó la comisión es «nosotros» o «comprador»; nada más", () => {
    for (const bad of ["cliente", "Comprador", null, true]) {
      expect(() => parseBreakdown({ ...stored(e1), state: { ...e1.state, feesPaidBy: bad } })).toThrow();
    }
  });

  test("rechaza v: 2", () => {
    expect(() => parseBreakdown({ ...stored(e1), v: 2 })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), v: "1" })).toThrow();
  });

  test("rechaza montos como número", () => {
    expect(() => parseBreakdown({ ...stored(e1), net: 90.3 })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), gross: 100 })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), feesTotal: 9.7 })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), state: { ...e1.state, grossOriginal: 100 } })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), lines: [{ ...e1.lines[0], amount: 3.2 }] })).toThrow();
    expect(() =>
      parseBreakdown({ ...stored(e1), alloc: { ...e1.alloc, lines: [{ ...e1.alloc.lines[0], amount: 45.15 }] } }),
    ).toThrow();
    expect(() =>
      parseBreakdown({ ...stored(e1), rules: { ...e1.rules, gateway: { ...e1.rules.gateway, fixed: 0.3 } } }),
    ).toThrow();
  });

  test("rechaza montos y porcentajes mal escritos", () => {
    expect(() => parseBreakdown({ ...stored(e1), net: "90.3" })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), net: "90,30" })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), lines: [{ ...e1.lines[0], pct: "2,9" }] })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), lines: [{ ...e1.lines[0], pct: 2.9 }] })).toThrow();
  });

  test("rechaza formas que no son un desglose", () => {
    expect(() => parseBreakdown(null)).toThrow();
    expect(() => parseBreakdown(undefined)).toThrow();
    expect(() => parseBreakdown("{}")).toThrow();
    expect(() => parseBreakdown({})).toThrow();
    expect(() => parseBreakdown([])).toThrow();
    const { net: _net, ...withoutNet } = stored(e1);
    expect(() => parseBreakdown(withoutNet)).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), currency: "usd" })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), extra: true })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), lines: [{ ...e1.lines[0], kind: "propina" }] })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), state: { ...e1.state, dispute: "pendiente" } })).toThrow();
    expect(() => parseBreakdown({ ...stored(e1), alloc: { ...e1.alloc, baseKind: "otro" } })).toThrow();
  });

  test("el error dice en español qué campo está mal", () => {
    expect(() => parseBreakdown({ ...stored(e1), net: 90.3 })).toThrow(/monto/i);
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

describe("propiedades con 2 000 cobros generados", () => {
  const rnd = mulberry32(20261109);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const chance = (oneIn: number) => int(1, oneIn) === 1;

  // Montos y porcentajes se arman como TEXTO a partir de enteros (centavos y diezmilésimas de punto).
  const moneyText = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  const pctText = (tenThousandths: number) =>
    `${Math.floor(tenThousandths / 10_000)}.${String(tenThousandths % 10_000).padStart(4, "0")}`;

  function randomScheme(): SchemeRule | null {
    if (chance(5)) return null;
    const cuts = Array.from({ length: int(0, 4) }, () => int(1, 999_999)).sort((x, y) => x - y);
    const edges = [0, ...cuts, 1_000_000];
    const parts = edges.slice(1).map((edge, i) => edge - (edges[i] as number));
    const withRemainder = chance(3);
    const restGetsSome = withRemainder && parts.length > 1;
    const lineParts = restGetsSome ? parts.slice(0, -1) : parts;
    // Algunas partes no pagan comisión; si quedaran todas marcadas y el «Resto» sin nada, la última sí la paga (si
    // no, se rechaza: lo prueba E9c).
    const marks = lineParts.map(() => chance(3));
    if (!restGetsSome && marks.every(Boolean)) marks[marks.length - 1] = false;
    return {
      schemeId: "sch",
      versionId: "sv",
      name: "Esquema Demo",
      base: chance(4) ? "bruto" : "neto",
      lines: lineParts.map((part, i) => ({
        beneficiaryId: `ben-${i}`,
        name: `Grupo ${i}`,
        pct: pctText(part),
        feeExempt: marks[i] as boolean,
      })),
      remainder: withRemainder ? { beneficiaryId: "ben-resto", name: "Grupo Resto" } : null,
    };
  }

  function randomRules(): Rules {
    return {
      gateway: {
        id: "gw",
        name: "Pasarela Demo",
        feeVersionId: "fv",
        pct: pctText(int(0, 100_000)),
        fixed: moneyText(int(0, 100)),
        refundsReturnFee: chance(2),
        disputeFee: moneyText(int(0, 2500)),
        ...(chance(5) ? { feeOverride: moneyText(int(0, 500)) } : {}),
      },
      extras: Array.from({ length: int(0, 3) }, (_, i) => ({
        id: `ex-${i}`,
        name: `Opción ${i}`,
        pct: pctText(int(0, 50_000)),
        fixed: moneyText(chance(4) ? int(1, 100) : 0),
        base: chance(2) ? ("bruto" as const) : ("despues_de_comision" as const),
        payoutDaysOverride: null,
      })),
      platform: chance(2) ? { channelId: "ch", name: "Canal Demo", pct: pctText(int(0, 150_000)), fixed: moneyText(int(0, 50)) } : null,
      scheme: randomScheme(),
    };
  }

  function randomState(): State {
    const gross = chance(8) ? int(1, 500) : int(1, 5_000_000);
    const refunded = chance(2) ? 0 : chance(4) ? gross : int(0, gross);
    const dispute = ([null, null, null, "abierta", "ganada", "perdida"] as const)[int(0, 5)] as State["dispute"];
    const failed = chance(15);
    const feesPaidBy = chance(3) ? "comprador" : "nosotros";
    return { grossOriginal: moneyText(gross), refunded: moneyText(refunded), dispute, failed, feesPaidBy };
  }

  const cases = Array.from({ length: 2000 }, () => {
    const rules = randomRules();
    const state = randomState();
    return { rules, state, b: compute(rules, state, "USD") };
  });
  const sum = (xs: string[]) => xs.reduce((acc, x) => acc.plus(x), new D(0));
  const label = (b: Breakdown) => JSON.stringify({ rules: b.rules, state: b.state });

  test("los casos generados cubren reembolsos, disputas, fallidos, comisión informada y «Resto»", () => {
    const count = (pred: (c: (typeof cases)[number]) => boolean) => cases.filter(pred).length;
    expect(cases).toHaveLength(2000);
    expect(count((c) => c.state.failed)).toBeGreaterThan(50);
    expect(count((c) => c.state.refunded !== "0.00" && c.state.refunded !== c.state.grossOriginal)).toBeGreaterThan(300);
    expect(count((c) => c.state.refunded === c.state.grossOriginal)).toBeGreaterThan(100);
    expect(count((c) => c.state.dispute === "abierta" || c.state.dispute === "perdida")).toBeGreaterThan(300);
    expect(count((c) => c.rules.gateway.feeOverride !== undefined)).toBeGreaterThan(200);
    expect(count((c) => c.b.alloc.lines.some((l) => l.isRemainder))).toBeGreaterThan(200);
    expect(count((c) => c.rules.scheme === null)).toBeGreaterThan(200);
    expect(count((c) => new D(c.b.net).isNegative())).toBeGreaterThan(20);
    expect(count((c) => c.state.feesPaidBy === "comprador" && c.rules.scheme?.base === "bruto")).toBeGreaterThan(80);
  });

  test("bruto vigente = cobrado − reembolsado; neto = bruto − comisiones; comisiones = suma de las líneas", () => {
    for (const { state, b } of cases) {
      const gross = state.failed ? new D(0) : new D(state.grossOriginal).minus(state.refunded);
      expect(new D(b.gross).eq(gross), label(b)).toBe(true);
      expect(new D(b.net).eq(new D(b.gross).minus(b.feesTotal)), label(b)).toBe(true);
      expect(sum(b.lines.map((l) => l.amount)).eq(b.feesTotal), label(b)).toBe(true);
      expect(b.lines.every((l) => !new D(l.amount).isNegative()), label(b)).toBe(true);
    }
  });

  test("el reparto suma su base: el neto o el bruto según el esquema; el neto si pagó el comprador", () => {
    for (const { rules, state, b } of cases) {
      expect(sum(b.alloc.lines.map((l) => l.amount)).eq(b.alloc.baseAmount), label(b)).toBe(true);
      if (rules.scheme === null) {
        expect(b.alloc).toEqual({ baseKind: null, baseAmount: "0.00", lines: [] });
      } else {
        const base = state.feesPaidBy === "comprador" ? "neto" : rules.scheme.base;
        expect(b.alloc.baseKind).toBe(base);
        expect(b.alloc.baseAmount, label(b)).toBe(base === "bruto" ? b.gross : b.net);
        expect(sum(b.alloc.lines.map((l) => l.pct)).eq(100), label(b)).toBe(true);
      }
    }
  });

  test("partes sin comisión: cada una recibe pct × venta al centavo (salvo el centavo del mayor resto); suman el neto", () => {
    let applied = 0;
    for (const { rules, state, b } of cases) {
      const scheme = rules.scheme;
      if (scheme === null) continue;
      const applies = state.feesPaidBy === "nosotros" && scheme.base === "neto" && scheme.lines.some((l) => l.feeExempt);
      if (!applies) {
        // La marca no se aplica (comprador, sobre el bruto o sin marcas): el reparto de siempre, sobre su base.
        expect(b.alloc.lines.every((l) => !l.feeExempt), label(b)).toBe(true);
        expect(shares(b), label(b)).toEqual(allocate(b.alloc.baseAmount, b.alloc.lines.map((l) => l.pct)));
        continue;
      }
      applied += 1;
      expect(b.alloc.baseKind).toBe("neto");
      expect(sum(shares(b)).eq(b.net), label(b)).toBe(true);
      const marked = new Set(scheme.lines.filter((l) => l.feeExempt).map((l) => l.beneficiaryId));
      for (const line of b.alloc.lines) {
        expect(line.feeExempt, label(b)).toBe(marked.has(line.beneficiaryId));
        // Pagando nosotros, la venta es el bruto vigente: la parte exenta es su porcentaje de él.
        const exact = new D(b.gross).times(line.pct).div(100);
        if (line.feeExempt) expect(new D(line.amount).minus(exact).abs().lt("0.01"), label(b)).toBe(true);
      }
    }
    expect(applied).toBeGreaterThan(300);
  });

  test("lo de los compradores: gross = sale + buyerFees y net = sale − comisiones del negocio, con reembolsos y disputas", () => {
    let byBuyer = 0;
    for (const { state, b } of cases) {
      const buyerFees = buyerFeesOf(b);
      const own = businessFigures({ gross: b.gross, fees: b.feesTotal, buyerFees });
      expect(new D(b.gross).eq(new D(own.sale).plus(own.buyerFees)), label(b)).toBe(true);
      expect(new D(b.net).eq(new D(own.sale).minus(own.fees)), label(b)).toBe(true);
      // Las del comprador son las que se cobran sobre lo que sigue pagando; el reembolso y la disputa, del negocio.
      const ofBuyer = b.lines.filter((l) => l.kind !== "reembolso" && l.kind !== "disputa").map((l) => l.amount);
      const ofBusiness = b.lines.filter((l) => l.kind === "reembolso" || l.kind === "disputa").map((l) => l.amount);
      if (state.feesPaidBy === "comprador") {
        byBuyer += 1;
        expect(sum(ofBuyer).eq(buyerFees), label(b)).toBe(true);
        expect(sum(ofBusiness).eq(own.fees), label(b)).toBe(true);
      } else {
        expect(buyerFees, label(b)).toBe("0.00");
        expect(own.fees, label(b)).toBe(b.feesTotal);
      }
      expect(isMoney(buyerFees) && !new D(buyerFees).isNegative(), label(b)).toBe(true);
    }
    expect(byBuyer).toBeGreaterThan(500);
    const refundedOrDisputed = cases.filter(
      ({ state, b }) =>
        state.feesPaidBy === "comprador" && b.lines.some((l) => l.kind === "reembolso" || l.kind === "disputa"),
    );
    expect(refundedOrDisputed.length).toBeGreaterThan(200);
  });

  test('cada monto cumple isMoney y ninguno es "-0.00"', () => {
    for (const { b } of cases) {
      const all = [
        b.gross,
        b.feesTotal,
        b.net,
        b.alloc.baseAmount,
        ...b.lines.flatMap((l) => [l.baseAmount, l.fixed, l.amount]),
        ...b.alloc.lines.map((l) => l.amount),
      ];
      expect(all.every(isMoney), label(b)).toBe(true);
      expect(all, label(b)).not.toContain("-0.00");
    }
  });

  test("recompute es idempotente y recalc con las mismas reglas no cambia nada", () => {
    for (const { b } of cases) {
      expect(recompute(b, {}), label(b)).toStrictEqual(b);
      expect(recalc(b, b.rules), label(b)).toStrictEqual(b);
      const patch: Partial<State> = { refunded: b.state.grossOriginal, dispute: "perdida" };
      const once = recompute(b, patch);
      expect(recompute(once, patch), label(b)).toStrictEqual(once);
    }
  });

  test("lo retenido por una pasarela que no devuelve la comisión nunca baja al reembolsar", () => {
    const retained = (b: Breakdown) =>
      sum(b.lines.filter((l) => l.kind === "pasarela" || l.kind === "reembolso").map((l) => l.amount));
    let checked = 0;
    for (const { rules, state, b } of cases) {
      if (state.failed) continue;
      const unrefunded = retained(compute(rules, { ...state, refunded: "0.00" }, "USD"));
      if (rules.gateway.refundsReturnFee) {
        expect(b.lines.some((l) => l.kind === "reembolso"), label(b)).toBe(false);
        expect(retained(b).lte(unrefunded), label(b)).toBe(true);
      } else {
        expect(retained(b).gte(unrefunded), label(b)).toBe(true);
        expect(retained(b).eq(unrefunded), label(b)).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  test("todo desglose generado se puede guardar y volver a leer", () => {
    for (const { b } of cases) {
      expect(parseBreakdown(JSON.parse(JSON.stringify(b))), label(b)).toEqual(b);
    }
  });
});

describe("propiedades de la retención con 1 000 cobros generados", () => {
  const rnd = mulberry32(20261115);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const chance = (oneIn: number) => int(1, oneIn) === 1;
  const moneyText = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  const pctText = (tenThousandths: number) =>
    `${Math.floor(tenThousandths / 10_000)}.${String(tenThousandths % 10_000).padStart(4, "0")}`;

  /** De 1 a 4 personas con porcentajes que suman exactamente 100. */
  function randomRetention(): RetentionRule {
    const cuts = [...new Set(Array.from({ length: int(0, 3) }, () => int(1, 999_999)))].sort((x, y) => x - y);
    const edges = [0, ...cuts, 1_000_000];
    return {
      pct: pctText(int(1, 1_000_000)),
      days: int(0, 365),
      recipients: edges.slice(1).map((edge, i) => ({
        beneficiaryId: `ben-${i}`,
        name: `Titular ${i}`,
        pct: pctText(edge - (edges[i] as number)),
      })),
    };
  }

  const cases = Array.from({ length: 1000 }, () => {
    const gross = chance(8) ? int(1, 500) : int(1, 5_000_000);
    const refunded = chance(2) ? 0 : chance(4) ? gross : int(0, gross);
    const state: State = {
      grossOriginal: moneyText(gross),
      refunded: moneyText(refunded),
      dispute: ([null, null, "abierta", "ganada", "perdida"] as const)[int(0, 4)] as State["dispute"],
      failed: chance(15),
      feesPaidBy: chance(3) ? "comprador" : "nosotros",
    };
    return compute(rulesE10(randomRetention()), state, "USD");
  });
  const sum = (xs: string[]) => xs.reduce((acc, x) => acc.plus(x), new D(0));
  const label = (b: Breakdown) => JSON.stringify({ retention: b.rules.gateway.retention, state: b.state });

  test("los casos generados cubren fallidos, reembolsos totales y varias personas", () => {
    expect(cases.filter((b) => b.state.failed).length).toBeGreaterThan(30);
    expect(cases.filter((b) => b.state.refunded === b.state.grossOriginal).length).toBeGreaterThan(50);
    expect(cases.filter((b) => (b.rules.gateway.retention?.recipients.length ?? 0) > 2).length).toBeGreaterThan(200);
  });

  test("las partes suman exactamente lo retenido, ninguna es negativa y todas son montos", () => {
    for (const b of cases) {
      const r = retentionOf(b);
      if (r === null) throw new Error("Todos los casos retienen");
      expect(sum(r.shares.map((s) => s.amount)).eq(r.amount), label(b)).toBe(true);
      expect([r.amount, ...r.shares.map((s) => s.amount)].every(isMoney), label(b)).toBe(true);
      expect(r.shares.every((s) => !new D(s.amount).isNegative()), label(b)).toBe(true);
    }
  });

  test("lo retenido es pct × bruto vigente al centavo, y nunca pasa del bruto vigente", () => {
    for (const b of cases) {
      const amount = retentionOf(b)?.amount ?? "0.00";
      const exact = new D(b.gross).times(b.rules.gateway.retention?.pct ?? "0").div(100);
      expect(new D(amount).minus(exact).abs().lte("0.005"), label(b)).toBe(true);
      expect(new D(amount).lte(b.gross), label(b)).toBe(true);
      if (b.state.failed) expect(amount, label(b)).toBe("0.00");
    }
  });

  test("lo que llega al banco es el neto menos lo retenido", () => {
    for (const b of cases) {
      expect(payoutOf(b), label(b)).toBe(sub(b.net, retentionOf(b)?.amount ?? "0.00"));
    }
  });
});
