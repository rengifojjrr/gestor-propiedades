import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  add,
  buyerFeesOf,
  compute,
  payoutStatus,
  recompute,
  resolveRules,
  retentionOf,
  type Breakdown,
  type Rules,
  type Selection,
} from "@/lib/pasarelas";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import type { TxPayout } from "@/server/pasarelas/queries/settlements";
import { AllocationList, type PayoutsView } from "./AllocationList";

const E1: Selection = {
  companyId: DEMO.companyId,
  channelId: DEMO.channelId,
  gatewayId: DEMO.gatewayId,
  extraIds: [DEMO.extraId],
  schemeId: DEMO.schemeId,
  occurredOn: "2026-11-13",
};
const PAID = { grossOriginal: "100.00", refunded: "0.00", dispute: null, failed: false, feesPaidBy: "nosotros" } as const;

const html = (breakdown: ReturnType<typeof compute>) =>
  renderToStaticMarkup(createElement(AllocationList, { breakdown }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const items = (markup: string) => [...markup.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => text(match[1] ?? ""));

describe("AllocationList", () => {
  it("E1: cada beneficiario con su porcentaje y su parte, y la base del reparto", () => {
    const markup = html(compute(resolveRules(cfgDemo(), E1), PAID, "USD"));
    expect(text(markup)).toContain("Sobre el neto: $90,30");
    expect(items(markup)).toEqual(["Grupo A 50 % $45,15", "Grupo B 30 % $27,09", "Grupo C 20 % $18,06"]);
  });

  it("el «Resto» se marca como tal", () => {
    const cfg = cfgDemo();
    const version = cfg.schemes[0]?.versions[0];
    if (version === undefined) throw new Error("Falta el esquema de ejemplo");
    version.lines = version.lines.slice(0, 2);
    version.remainderBeneficiaryId = DEMO.beneficiaryIds.c;
    const markup = html(compute(resolveRules(cfg, E1), PAID, "USD"));
    expect(items(markup).at(-1)).toBe("Grupo C Resto 20 % $18,06");
  });

  it("sobre el bruto lo dice, y una pérdida se reparte con signo", () => {
    const cfg = cfgDemo();
    const version = cfg.schemes[0]?.versions[0];
    if (version === undefined) throw new Error("Falta el esquema de ejemplo");
    version.base = "bruto";
    expect(text(html(compute(resolveRules(cfg, E1), PAID, "USD")))).toContain("Sobre el bruto: $100,00");

    const lost = recompute(compute(resolveRules(cfgDemo(), E1), PAID, "USD"), { refunded: "100.00" });
    expect(items(html(lost))).toEqual(["Grupo A 50 % -$1,60", "Grupo B 30 % -$0,96", "Grupo C 20 % -$0,64"]);
  });

  it("si la comisión la pagó el comprador, dice que se reparte lo que queda, aunque el esquema diga bruto", () => {
    const cfg = cfgDemo();
    const version = cfg.schemes[0]?.versions[0];
    if (version === undefined) throw new Error("Falta el esquema de ejemplo");
    version.base = "bruto";
    const markup = html(compute(resolveRules(cfg, E1), { ...PAID, feesPaidBy: "comprador" }, "USD"));
    expect(text(markup)).toContain("Se reparte sobre lo que te queda: la comisión la pagó el comprador.");
    expect(text(markup)).toContain("Sobre el neto: $90,30");
    // Pagando nosotros, no hay nada que explicar.
    expect(text(html(compute(resolveRules(cfg, E1), PAID, "USD")))).not.toContain("la pagó el comprador");
  });

  it("E8a: reembolsado del todo, no dice que la pagó el comprador; sí por qué se reparte lo que queda", () => {
    const cfg = cfgDemo();
    const version = cfg.schemes[0]?.versions[0];
    if (version === undefined) throw new Error("Falta el esquema de ejemplo");
    version.base = "bruto";
    const byBuyer = compute(resolveRules(cfg, E1), { ...PAID, feesPaidBy: "comprador" }, "USD");

    // Reembolso parcial: el comprador sigue pagando la comisión de lo que no se le devolvió.
    const partial = text(html(recompute(byBuyer, { refunded: "50.00" })));
    expect(partial).toContain("Se reparte sobre lo que te queda: la comisión la pagó el comprador.");

    // Reembolso total: lo que retuvo la pasarela lo perdió el negocio.
    const refunded = recompute(byBuyer, { refunded: "100.00" });
    expect(buyerFeesOf(refunded)).toBe("0.00");
    const markup = text(html(refunded));
    expect(markup).not.toContain("la pagó el comprador");
    expect(markup).toContain(
      "Se reparte sobre lo que te queda: el cobro se registró con la comisión a cargo del comprador.",
    );
    expect(markup).toContain("Sobre el neto: -$");
  });

  describe("partes que no pagan comisión", () => {
    /** E9: 1000,00 por Stripe, sin opciones ni canal, con el 50/30/20 sobre el neto y `exempt` sin comisión. */
    function e9(exempt: readonly string[], feesPaidBy: "nosotros" | "comprador" = "nosotros") {
      const cfg = cfgDemo();
      const version = cfg.schemes[0]?.versions[0];
      if (version === undefined) throw new Error("Falta el esquema de ejemplo");
      version.lines = version.lines.map((line) => ({ ...line, feeExempt: exempt.includes(line.beneficiaryId) }));
      const rules = resolveRules(cfg, { ...E1, channelId: null, extraIds: [] });
      return compute(rules, { ...PAID, grossOriginal: "1000.00", feesPaidBy }, "USD");
    }

    it("E9: la línea de C dice «no paga comisión» y una frase explica la cuenta", () => {
      const markup = html(e9([DEMO.beneficiaryIds.c]));
      expect(items(markup)).toEqual([
        "Grupo A 50 % $481,69",
        "Grupo B 30 % $289,01",
        "Grupo C no paga comisión 20 % $200,00",
      ]);
      expect(text(markup)).toContain(
        "Grupo C no paga comisión: su parte es el 20 % del bruto. La comisión la pagan los demás.",
      );
      expect(text(markup)).toContain("Sobre el neto: $970,70");
    });

    it("con dos partes sin comisión, la frase las nombra a las dos", () => {
      const markup = html(e9([DEMO.beneficiaryIds.a, DEMO.beneficiaryIds.c]));
      expect(text(markup)).toContain(
        "Grupo A y Grupo C no pagan comisión: sus partes son el 50 % y el 20 % del bruto. La comisión la pagan los demás.",
      );
      expect(items(markup)).toEqual([
        "Grupo A no paga comisión 50 % $500,00",
        "Grupo B 30 % $270,70",
        "Grupo C no paga comisión 20 % $200,00",
      ]);
    });

    it("con tres o más, separa con comas y la última con «y»", () => {
      const cfg = cfgDemo();
      const version = cfg.schemes[0]?.versions[0];
      if (version === undefined) throw new Error("Falta el esquema de ejemplo");
      version.lines = [
        ...version.lines.map((line) => ({ ...line, pct: "25", feeExempt: true })),
        { beneficiaryId: "ben-d", pct: "25", feeExempt: false },
      ];
      cfg.beneficiaries.push({ id: "ben-d", name: "Grupo D", kind: "persona", active: true });
      const b = compute(resolveRules(cfg, { ...E1, channelId: null, extraIds: [] }), PAID, "USD");
      // `text` cambia cada etiqueta por un espacio: el que queda antes de la coma no está en la pantalla.
      expect(text(html(b)).replaceAll(" ,", ",")).toContain(
        "Grupo A, Grupo B y Grupo C no pagan comisión: sus partes son el 25 %, el 25 % y el 25 % del bruto.",
      );
    });

    it("si pagó el comprador la marca no cuenta: ni la etiqueta ni la frase", () => {
      const markup = text(html(e9([DEMO.beneficiaryIds.c], "comprador")));
      expect(markup).not.toContain("no paga comisión");
      expect(markup).not.toContain("del bruto");
    });
  });

  it("sin esquema dice que el cobro no se reparte", () => {
    const markup = html(compute(resolveRules(cfgDemo(), { ...E1, schemeId: null }), PAID, "USD"));
    expect(markup).not.toContain("<li");
    expect(text(markup)).toBe("Este cobro no se reparte.");
  });

  describe("la retención de la pasarela", () => {
    /** E1 por una Stripe que retiene el 5 % para `recipients` (por defecto, A y B, mitad y mitad). */
    function retained(recipients: string[] = [DEMO.beneficiaryIds.a, DEMO.beneficiaryIds.b], scheme = true) {
      const cfg = cfgDemo();
      const stripe = cfg.gateways[0];
      if (stripe === undefined) throw new Error("Falta la pasarela de ejemplo");
      const pct = recipients.length === 1 ? "100" : "50";
      stripe.retention = { pct: "5", days: 30, recipients: recipients.map((beneficiaryId) => ({ beneficiaryId, pct })) };
      cfg.beneficiaries.push({ id: "ben-titular", name: "Titular A", kind: "persona", active: true });
      return compute(resolveRules(cfg, { ...E1, schemeId: scheme ? DEMO.schemeId : null }), PAID, "USD");
    }

    it("E10: cada titular ya recibió 25,00 de la retención y le faltan 25,00 de sus 50,00", () => {
      const rules: Rules = {
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
              { beneficiaryId: "ben-ta", name: "Titular A", pct: "50" },
              { beneficiaryId: "ben-tb", name: "Titular B", pct: "50" },
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
            { beneficiaryId: "ben-ga", name: "Grupo A", pct: "60", feeExempt: false },
            { beneficiaryId: "ben-gb", name: "Grupo B", pct: "30", feeExempt: false },
            { beneficiaryId: "ben-ta", name: "Titular A", pct: "5", feeExempt: true },
            { beneficiaryId: "ben-tb", name: "Titular B", pct: "5", feeExempt: true },
          ],
          remainder: null,
        },
      };
      const markup = html(compute(rules, { ...PAID, grossOriginal: "1000.00" }, "USD"));
      expect(items(markup)).toEqual([
        "Grupo A 60 % $580,53",
        "Grupo B 30 % $290,27",
        "Titular A no paga comisión 5 % $50,00 ya recibió $25,00 de la retención · falta $25,00",
        "Titular B no paga comisión 5 % $50,00 ya recibió $25,00 de la retención · falta $25,00",
      ]);
      expect(text(markup)).not.toContain("adelanto");
    });

    it("a cada persona que recibe retención: lo que ya recibió y lo que falta", () => {
      // 100,00 retiene 5,00: 2,50 a A (que tiene 45,15) y 2,50 a B (27,09).
      const markup = html(retained());
      expect(items(markup)).toEqual([
        "Grupo A 50 % $45,15 ya recibió $2,50 de la retención · falta $42,65",
        "Grupo B 30 % $27,09 ya recibió $2,50 de la retención · falta $24,59",
        "Grupo C 20 % $18,06",
      ]);
      expect(text(markup)).not.toContain("adelanto");
    });

    it("si alguien recibe retención sin estar en el reparto, lo advierte: es un adelanto y su saldo baja", () => {
      const markup = text(html(retained(["ben-titular"])));
      expect(markup).toContain(
        "Titular A recibe $5,00 de la retención pero no está en el reparto de este cobro: es un adelanto y su saldo baja.",
      );
      // Sin esquema, todos los que reciben retención están fuera del reparto.
      const unshared = text(html(retained([DEMO.beneficiaryIds.a], false)));
      expect(unshared).toContain("Este cobro no se reparte.");
      expect(unshared).toContain("Grupo A recibe $5,00 de la retención pero no está en el reparto de este cobro");
    });

    it("con un reembolso total ya no recibió nada: sin marcas ni advertencias", () => {
      const markup = text(html(recompute(retained(["ben-titular"]), { refunded: "100.00" })));
      expect(markup).not.toContain("retención");
    });

    it("si lo retenido pasa de su parte, lo de más es un adelanto", () => {
      const cfg = cfgDemo();
      const stripe = cfg.gateways[0];
      if (stripe === undefined) throw new Error("Falta la pasarela de ejemplo");
      stripe.retention = { pct: "50", days: 30, recipients: [{ beneficiaryId: DEMO.beneficiaryIds.c, pct: "100" }] };
      // 100,00 retiene 50,00 para C, que solo tiene 18,06 del reparto.
      const markup = html(compute(resolveRules(cfg, E1), PAID, "USD"));
      expect(items(markup)[2]).toBe("Grupo C 20 % $18,06 ya recibió $50,00 de la retención · $31,94 de adelanto");
    });
  });

  describe("lo pagado a cada parte, en el detalle del cobro", () => {
    /** E10: 1000,00 por OTF Demo, que retiene el 5 % para los titulares; Grupo A 60 %, Grupo B 30 %, 5 % y 5 %. */
    const E10 = compute(
      {
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
      },
      { ...PAID, grossOriginal: "1000.00" },
      "USD",
    );

    /** Un pago de un beneficiario ligado a este cobro (y, si se pide, a otros). */
    const payment = (beneficiaryId: string, here: string, others: TxPayout["others"] = []): TxPayout => ({
      settlementId: `s-${beneficiaryId}`,
      beneficiaryId,
      paidOn: "2026-11-14",
      method: null,
      currency: "USD",
      amount: add(here, ...others.map((item) => item.amount)),
      here,
      others,
    });

    /** Lo que el detalle le pasa: el estado que da el motor con esos pagos, y los pagos ligados. */
    function payouts(b: Breakdown, payments: TxPayout[], counts = true): PayoutsView {
      return {
        transactionId: "t1",
        status: payoutStatus({
          counts,
          allocations: b.alloc.lines.map((line) => ({ beneficiaryId: line.beneficiaryId, amount: line.amount })),
          retained: (retentionOf(b)?.shares ?? []).map(({ beneficiaryId, amount }) => ({ beneficiaryId, amount })),
          paid: payments.map((p) => ({ beneficiaryId: p.beneficiaryId, amount: p.here })),
        }),
        payments,
        names: { ga: "Grupo A", gb: "Grupo B", ta: "Titular A", tb: "Titular B", gc: "Grupo C" },
        today: "2026-11-14",
      };
    }
    const withPayouts = (b: Breakdown, view: PayoutsView) =>
      renderToStaticMarkup(createElement(AllocationList, { breakdown: b, payouts: view }));
    // `text` cambia cada etiqueta por un espacio: el que queda antes de los dos puntos (tras la fecha) no se ve.
    const rows = (markup: string) => items(markup).map((row) => row.replaceAll(" :", ":"));
    const all = (markup: string) => text(markup).replaceAll(" :", ":");
    const P2 = [payment("ga", "580.53"), payment("gb", "290.27"), payment("ta", "25.00"), payment("tb", "25.00")];

    it("P1: a cada parte le falta lo suyo; a los titulares, menos lo que ya recibieron de la retención", () => {
      const markup = withPayouts(E10, payouts(E10, []));
      expect(rows(markup)).toEqual([
        "Grupo A 60 % $580,53 Falta $580,53 Marcar pagado… a Grupo A",
        "Grupo B 30 % $290,27 Falta $290,27 Marcar pagado… a Grupo B",
        "Titular A no paga comisión 5 % $50,00 ya recibió $25,00 de la retención Falta $25,00 Marcar pagado… a Titular A",
        "Titular B no paga comisión 5 % $50,00 ya recibió $25,00 de la retención Falta $25,00 Marcar pagado… a Titular B",
      ]);
      expect(all(markup)).toContain("Marcar todo el reparto pagado…");
    });

    it("P2: todo pagado, con cada pago y su «Deshacer»; ya no ofrece marcar nada", () => {
      const markup = withPayouts(E10, payouts(E10, P2));
      expect(rows(markup)[0]).toBe(
        "Grupo A 60 % $580,53 Pagado Pagado el sáb 14 nov 2026: $580,53 Deshacer el pago a Grupo A del sáb 14 nov 2026",
      );
      expect(rows(markup)[2]).toContain("ya recibió $25,00 de la retención Pagado Pagado el sáb 14 nov 2026: $25,00");
      expect(all(markup)).not.toContain("Marcar");
    });

    it("un pago parcial: cuánto se pagó y lo que todavía falta", () => {
      const markup = withPayouts(E10, payouts(E10, [payment("ga", "500.00")]));
      expect(rows(markup)[0]).toBe(
        "Grupo A 60 % $580,53 Falta $80,53 Marcar pagado… a Grupo A Pagado el sáb 14 nov 2026: $500,00 Deshacer el " +
          "pago a Grupo A del sáb 14 nov 2026",
      );
    });

    it("P4: después de P2 y un reembolso total, se les pagó de más", () => {
      const refunded = recompute(E10, { refunded: "1000.00" });
      const markup = withPayouts(refunded, payouts(refunded, P2));
      expect(rows(markup)[0]).toContain("Grupo A 60 % -$19,47 Se le pagó de más $600,00 Pagado el");
      expect(rows(markup)[3]).toContain("Titular B no paga comisión 5 % $0,00 Se le pagó de más $25,00");
      expect(all(markup)).not.toContain("Marcar");
    });

    it("P3: un pago que cubre otros cobros lo dice junto a lo de este", () => {
      const other = {
        transactionId: "t2",
        amount: "290.27",
        occurredOn: "2026-11-10",
        currency: "USD",
        grossOriginal: "1000.00",
        reference: "E10-b",
      };
      const markup = withPayouts(E10, payouts(E10, [payment("gb", "290.27", [other])]));
      expect(rows(markup)[1]).toBe(
        "Grupo B 30 % $290,27 Pagado Pagado el sáb 14 nov 2026: $290,27 (de un pago de $580,54 por 2 cobros) Deshacer " +
          "el pago a Grupo B del sáb 14 nov 2026",
      );
    });

    it("fallido o en la papelera no tiene nada pendiente: sin estados ni «Marcar…», pero sus pagos se pueden deshacer", () => {
      const markup = withPayouts(E10, payouts(E10, [payment("ga", "580.53")], false));
      expect(rows(markup)[0]).toBe(
        "Grupo A 60 % $580,53 Pagado el sáb 14 nov 2026: $580,53 Deshacer el pago a Grupo A del sáb 14 nov 2026",
      );
      expect(rows(markup)[1]).toBe("Grupo B 30 % $290,27");
      expect(all(markup)).not.toContain("Marcar");
    });

    it("a quien se le pagó sin estar ya en el reparto (otro esquema) sale aparte, con lo que se le pagó de más", () => {
      const markup = withPayouts(E10, payouts(E10, [payment("gc", "10.00")]));
      expect(all(markup)).toContain(
        "Pagos a quien no está en el reparto Grupo C Se le pagó de más $10,00 Pagado el sáb 14 nov 2026: $10,00 " +
          "Deshacer el pago a Grupo C del sáb 14 nov 2026",
      );
    });

    it("sin pagos que mostrar, la vista previa de «Registrar» sigue igual", () => {
      expect(items(html(E10))[2]).toBe(
        "Titular A no paga comisión 5 % $50,00 ya recibió $25,00 de la retención · falta $25,00",
      );
    });
  });
});
