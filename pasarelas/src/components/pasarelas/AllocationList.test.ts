import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { compute, recompute, resolveRules, type Selection } from "@/lib/pasarelas";
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
const PAID = { grossOriginal: "100.00", refunded: "0.00", dispute: null, failed: false } as const;

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

  it("sin esquema dice que el cobro no se reparte", () => {
    const markup = html(compute(resolveRules(cfgDemo(), { ...E1, schemeId: null }), PAID, "USD"));
    expect(markup).not.toContain("<li");
    expect(text(markup)).toBe("Este cobro no se reparte.");
  });
});
