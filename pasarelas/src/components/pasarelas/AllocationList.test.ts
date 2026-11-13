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
});
