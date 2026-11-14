import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compute, recompute, resolveRules } from "@/lib/pasarelas";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import { BreakdownCard } from "./BreakdownCard";

/** Lo cobrado (100,00), sin reembolso ni disputa, con la comisión a cargo del negocio. */
const PAID = { grossOriginal: "100.00", refunded: "0.00", dispute: null, failed: false, feesPaidBy: "nosotros" } as const;

/** E1 del spec con la configuración de ejemplo: 100,00 por Stripe con pago rápido, canal al 5 % y 50/30/20. */
function e1() {
  const rules = resolveRules(cfgDemo(), {
    companyId: DEMO.companyId,
    channelId: DEMO.channelId,
    gatewayId: DEMO.gatewayId,
    extraIds: [DEMO.extraId],
    schemeId: DEMO.schemeId,
    occurredOn: "2026-11-13",
  });
  return compute(rules, PAID, "USD");
}

const html = (breakdown: ReturnType<typeof e1>, occurredOn?: string) =>
  renderToStaticMarkup(createElement(BreakdownCard, { breakdown, occurredOn }));
/** El texto que ve la persona, con un espacio donde había etiquetas. */
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** El texto del elemento marcado con ese `data-testid`. */
const byTestId = (markup: string, id: string) => {
  const match = new RegExp(`data-testid="${id}"[^>]*>(.*?)</(?:dd|li)>`).exec(markup);
  return match ? text(match[1] ?? "") : null;
};

describe("BreakdownCard", () => {
  it("E1: cada comisión con su nombre y su cuenta, el total y el neto", () => {
    const markup = html(e1());
    const lines = [...markup.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => text(match[1] ?? ""));
    expect(lines).toEqual([
      "Stripe 2,9 % + $0,30 de $100,00 $3,20",
      "Pago rápido 1,5 % de $100,00 $1,50",
      "Escuela de marketing 5 % de $100,00 $5,00",
    ]);
    expect(byTestId(markup, "bruto")).toBe("$100,00");
    expect(byTestId(markup, "comisiones")).toBe("$9,70");
    expect(byTestId(markup, "neto")).toBe("$90,30");
  });

  it("una opción después de la comisión dice sobre cuánto se calcula", () => {
    const cfg = cfgDemo();
    const option = cfg.gateways[0]?.extras[0];
    if (option === undefined) throw new Error("Falta la opción de ejemplo");
    option.base = "despues_de_comision";
    const rules = resolveRules(cfg, {
      companyId: DEMO.companyId,
      channelId: null,
      gatewayId: DEMO.gatewayId,
      extraIds: [DEMO.extraId],
      schemeId: null,
      occurredOn: "2026-11-13",
    });
    const markup = html(compute(rules, PAID, "USD"));
    expect(text(markup)).toContain("Pago rápido 1,5 % de $96,80 (después de la comisión) $1,45");
    expect(byTestId(markup, "neto")).toBe("$95,35");
  });

  it("con un reembolso enseña lo cobrado, lo reembolsado y el costo del reembolso; el neto negativo lleva su signo", () => {
    const markup = html(recompute(e1(), { refunded: "100.00" }));
    expect(byTestId(markup, "cobrado")).toBe("$100,00");
    expect(byTestId(markup, "reembolsado")).toBe("$100,00");
    expect(byTestId(markup, "bruto")).toBe("$0,00");
    expect(text(markup)).toContain("Costo del reembolso $3,20");
    expect(byTestId(markup, "neto")).toBe("-$3,20");
  });

  it("sin reembolso no enseña ni lo cobrado ni lo reembolsado", () => {
    const markup = html(e1());
    expect(byTestId(markup, "cobrado")).toBeNull();
    expect(byTestId(markup, "reembolsado")).toBeNull();
  });

  it("si la comisión la pagó el comprador: la misma comisión, «Lo que te queda» y por qué", () => {
    const markup = html(recompute(e1(), { feesPaidBy: "comprador" }));
    expect(byTestId(markup, "comisiones")).toBe("$9,70");
    expect(byTestId(markup, "neto")).toBe("$90,30");
    expect(text(markup)).toContain("Lo que te queda $90,30");
    expect(text(markup)).toContain("La comisión la pagó el comprador: se le cobró de más para cubrirla.");
    // Pagando nosotros, el neto es el neto y no hay nota.
    expect(text(html(e1()))).toContain("Neto $90,30");
    expect(text(html(e1()))).not.toContain("la pagó el comprador");
  });

  describe("comprador con reembolso o disputa: qué parte pagó el comprador y qué parte el negocio", () => {
    /** E7: 1040 por Stripe (2,9 % + 0,30; no devuelve la comisión; disputa 15,00), la comisión del comprador. */
    function e7() {
      const rules = resolveRules(cfgDemo(), {
        companyId: DEMO.companyId,
        channelId: null,
        gatewayId: DEMO.gatewayId,
        extraIds: [],
        schemeId: DEMO.schemeId,
        occurredOn: "2026-11-13",
      });
      return compute(rules, { ...PAID, grossOriginal: "1040.00", feesPaidBy: "comprador" }, "USD");
    }
    const PARTS =
      "El comprador paga las comisiones de lo que sigue pagando; lo que cuesta un reembolso o una disputa lo paga " +
      "el negocio.";

    it("E8a, reembolso total: el comprador no pagó nada; los 30,46 que se quedó la pasarela, el negocio", () => {
      const markup = html(recompute(e7(), { refunded: "1040.00" }));
      expect(byTestId(markup, "comisiones")).toBe("$30,46");
      expect(byTestId(markup, "pagado-comprador")).toBe("$0,00");
      expect(byTestId(markup, "pagado-negocio")).toBe("$30,46");
      expect(byTestId(markup, "neto")).toBe("-$30,46");
      expect(text(markup)).toContain(PARTS);
      // No dice que la comisión la pagó el comprador: recuperó todo lo que pagó.
      expect(text(markup)).not.toContain("se le cobró de más para cubrirla");
    });

    it("E8b, reembolso parcial de 520: 15,38 el comprador y 15,08 el negocio", () => {
      const markup = html(recompute(e7(), { refunded: "520.00" }));
      expect(byTestId(markup, "pagado-comprador")).toBe("$15,38");
      expect(byTestId(markup, "pagado-negocio")).toBe("$15,08");
      expect(byTestId(markup, "neto")).toBe("$489,54");
    });

    it("con la disputa abierta: la comisión, el comprador; los 15,00 de la disputa, el negocio", () => {
      const markup = html(recompute(e7(), { dispute: "abierta" }));
      expect(byTestId(markup, "pagado-comprador")).toBe("$30,46");
      expect(byTestId(markup, "pagado-negocio")).toBe("$15,00");
      expect(text(markup)).toContain(PARTS);
    });

    it("sin reembolso ni disputa no hay partes: todo lo pagó el comprador; pagando nosotros, tampoco", () => {
      expect(byTestId(html(e7()), "pagado-comprador")).toBeNull();
      expect(text(html(e7()))).not.toContain(PARTS);
      const ours = html(recompute(e7(), { feesPaidBy: "nosotros", refunded: "520.00" }));
      expect(byTestId(ours, "pagado-negocio")).toBeNull();
      expect(text(ours)).not.toContain(PARTS);
    });
  });

  it("un cobro fallido no tiene comisiones y lo dice", () => {
    const markup = html(recompute(e1(), { failed: true }));
    expect(markup).not.toContain("<li");
    expect(text(markup)).toContain("Sin comisiones.");
    expect(byTestId(markup, "neto")).toBe("$0,00");
  });

  describe("la retención de la pasarela", () => {
    /** E10 en la configuración de ejemplo: Stripe como «OTF Demo» (2,9 % + 0,20) que retiene el 5 % 30 días. */
    function e10(refunded = "0.00") {
      const cfg = cfgDemo();
      const stripe = cfg.gateways[0];
      if (stripe === undefined) throw new Error("Falta la pasarela de ejemplo");
      stripe.name = "OTF Demo";
      stripe.feeVersions = [{ id: DEMO.feeVersionId, pct: "2.9", fixed: "0.20", effectiveFrom: "2000-01-01", note: null }];
      stripe.retention = {
        pct: "5",
        days: 30,
        recipients: [
          { beneficiaryId: DEMO.beneficiaryIds.a, pct: "50" },
          { beneficiaryId: DEMO.beneficiaryIds.b, pct: "50" },
        ],
      };
      const rules = resolveRules(cfg, {
        companyId: DEMO.companyId,
        channelId: null,
        gatewayId: DEMO.gatewayId,
        extraIds: [],
        schemeId: DEMO.schemeId,
        occurredOn: "2026-11-10",
      });
      return compute(rules, { ...PAID, grossOriginal: "1000.00", refunded }, "USD");
    }

    it("E10: cuánto retiene, a quién le cae y cuánto, hacia qué fecha se libera, y lo que llega al banco", () => {
      const markup = html(e10(), "2026-11-10");
      expect(byTestId(markup, "neto")).toBe("$970,80");
      expect(text(markup)).toContain("Retiene OTF Demo (5 %) $50,00");
      const shares = [...markup.matchAll(/<li data-testid="retencion-persona"[^>]*>(.*?)<\/li>/g)].map((m) =>
        text(m[1] ?? ""),
      );
      expect(shares).toEqual(["Grupo A $25,00", "Grupo B $25,00"]);
      expect(text(markup)).toContain("Se libera hacia el jue 10 dic 2026");
      expect(byTestId(markup, "llega-al-banco")).toBe("$920,80");
    });

    it("sin la fecha del cobro no dice cuándo se libera; con reembolso total retiene 0 y llega el neto", () => {
      expect(text(html(e10()))).not.toContain("Se libera");
      const refunded = html(e10("1000.00"), "2026-11-10");
      expect(text(refunded)).toContain("Retiene OTF Demo (5 %) $0,00");
      expect(byTestId(refunded, "llega-al-banco")).toBe("-$29,20");
      expect(byTestId(refunded, "llega-al-banco")).toBe(byTestId(refunded, "neto"));
      // Sin nada retenido, nadie recibe nada ni hay nada que liberar.
      expect(refunded).not.toContain('data-testid="retencion-persona"');
      expect(text(refunded)).not.toContain("Se libera");
      expect(text(refunded)).toContain("Sin nada cobrado, no retiene nada.");
    });

    it("una pasarela que no retiene no dice nada de la retención ni de lo que llega al banco", () => {
      const markup = html(e1(), "2026-11-13");
      expect(text(markup)).not.toContain("Retiene");
      expect(byTestId(markup, "llega-al-banco")).toBeNull();
    });
  });
});
