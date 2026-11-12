import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buyerFeesOf, compute, recompute, resolveRules, type Selection } from "@/lib/pasarelas";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import { AllocationList } from "./AllocationList";

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

  it("sin esquema dice que el cobro no se reparte", () => {
    const markup = html(compute(resolveRules(cfgDemo(), { ...E1, schemeId: null }), PAID, "USD"));
    expect(markup).not.toContain("<li");
    expect(text(markup)).toBe("Este cobro no se reparte.");
  });
});
