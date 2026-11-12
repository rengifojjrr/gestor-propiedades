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

const html = (breakdown: ReturnType<typeof e1>) => renderToStaticMarkup(createElement(BreakdownCard, { breakdown }));
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

  it("un cobro fallido no tiene comisiones y lo dice", () => {
    const markup = html(recompute(e1(), { failed: true }));
    expect(markup).not.toContain("<li");
    expect(text(markup)).toContain("Sin comisiones.");
    expect(byTestId(markup, "neto")).toBe("$0,00");
  });
});
