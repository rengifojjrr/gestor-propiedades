import { describe, expect, test } from "vitest";
import { compute, diff, parseBreakdown, recalc, recompute } from "./breakdown";
import { D, isMoney } from "./decimal";
import type { Breakdown, ExtraRule, Rules, SchemeRule, State } from "./types";

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
        { beneficiaryId: "ben-a", name: "Grupo A", pct: "50" },
        { beneficiaryId: "ben-b", name: "Grupo B", pct: "30" },
        { beneficiaryId: "ben-c", name: "Grupo C", pct: "20" },
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
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "50", amount: "45.15", isRemainder: false },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "30", amount: "27.09", isRemainder: false },
          { beneficiaryId: "ben-c", name: "Grupo C", pct: "20", amount: "18.06", isRemainder: false },
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
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "33.3333" },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "33.3333" },
          { beneficiaryId: "ben-c", name: "Grupo C", pct: "33.3334" },
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
      { beneficiaryId: "ben-a", name: "Grupo A", pct: "50", amount: "45.15", isRemainder: false },
      { beneficiaryId: "ben-b", name: "Grupo B", pct: "30", amount: "27.09", isRemainder: false },
      { beneficiaryId: "ben-c", name: "Grupo C", pct: "20", amount: "18.06", isRemainder: true },
    ]);
  });

  test("el porcentaje del «Resto» es exacto también con cuatro decimales", () => {
    const base = rulesE1();
    const rules: Rules = {
      ...base,
      scheme: {
        ...schemeOf(base),
        lines: [
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "33.3333" },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "33.3333" },
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
    const lines = [...schemeOf(base).lines, { beneficiaryId: "ben-d", name: "Grupo D", pct: "0.0001" }];
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
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "50", amount: "0.00", isRemainder: false },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "30", amount: "0.00", isRemainder: false },
          { beneficiaryId: "ben-c", name: "Grupo C", pct: "20", amount: "0.00", isRemainder: false },
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
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "50.0000" },
          { beneficiaryId: "ben-b", name: "Grupo B", pct: "30.0000" },
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
          { beneficiaryId: "ben-a", name: "Grupo A", pct: "60" },
          { beneficiaryId: "ben-d", name: "Grupo D", pct: "40" },
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
    const lineParts = withRemainder && parts.length > 1 ? parts.slice(0, -1) : parts;
    return {
      schemeId: "sch",
      versionId: "sv",
      name: "Esquema Demo",
      base: chance(4) ? "bruto" : "neto",
      lines: lineParts.map((part, i) => ({ beneficiaryId: `ben-${i}`, name: `Grupo ${i}`, pct: pctText(part) })),
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
