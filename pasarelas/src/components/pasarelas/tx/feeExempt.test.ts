import { describe, expect, it } from "vitest";
import { compute, resolveRules, type PayConfig, type SchemeRule } from "@/lib/pasarelas";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import { exemptIdsOf, exemptQuestion, frozenExemptQuestion, someonePays } from "./feeExempt";

const { a: A, b: B, c: C } = DEMO.beneficiaryIds;

/** El 50/30/20 de ejemplo con el Grupo C marcado «No paga comisión» y, desde el 1/12, una versión sobre el bruto. */
function cfgWithC(): PayConfig {
  const cfg = cfgDemo();
  const scheme = cfg.schemes[0];
  const version = scheme?.versions[0];
  if (scheme === undefined || version === undefined) throw new Error("Falta el esquema de ejemplo");
  version.lines = version.lines.map((line) => ({ ...line, feeExempt: line.beneficiaryId === C }));
  scheme.versions.push({ ...version, id: "sv-bruto", version: 2, base: "bruto", effectiveFrom: "2026-12-01" });
  return cfg;
}

describe("exemptQuestion (al registrar)", () => {
  it("pagando nosotros con un esquema sobre el neto: cada línea con su nombre, su porcentaje y la marca del esquema", () => {
    expect(exemptQuestion(cfgWithC(), "nosotros", DEMO.schemeId, "2026-11-13")).toEqual({
      lines: [
        { beneficiaryId: A, name: "Grupo A", pct: "50", feeExempt: false },
        { beneficiaryId: B, name: "Grupo B", pct: "30", feeExempt: false },
        { beneficiaryId: C, name: "Grupo C", pct: "20", feeExempt: true },
      ],
      hasRemainder: false,
    });
  });

  it("no se pregunta con el comprador, sin esquema, con uno que no existe o si la versión del día va sobre el bruto", () => {
    expect(exemptQuestion(cfgWithC(), "comprador", DEMO.schemeId, "2026-11-13")).toBeNull();
    expect(exemptQuestion(cfgWithC(), "nosotros", null, "2026-11-13")).toBeNull();
    expect(exemptQuestion(cfgWithC(), "nosotros", "sch-fantasma", "2026-11-13")).toBeNull();
    expect(exemptQuestion(cfgWithC(), "nosotros", DEMO.schemeId, "2026-12-01")).toBeNull();
  });

  it("dice si hay «Resto» (que no se marca y paga lo suyo); un beneficiario que no está se nombra con una raya", () => {
    const cfg = cfgDemo();
    const version = cfg.schemes[0]?.versions[0];
    if (version === undefined) throw new Error("Falta el esquema de ejemplo");
    version.lines = version.lines.slice(0, 2);
    version.remainderBeneficiaryId = C;
    cfg.beneficiaries = cfg.beneficiaries.filter((beneficiary) => beneficiary.id !== B);
    const question = exemptQuestion(cfg, "nosotros", DEMO.schemeId, "2026-11-13");
    expect(question?.hasRemainder).toBe(true);
    expect(question?.lines.map((line) => line.name)).toEqual(["Grupo A", "—"]);
  });
});

describe("frozenExemptQuestion (al editar, con el esquema que congeló el cobro)", () => {
  const frozen = (): SchemeRule => {
    const b = compute(
      resolveRules(cfgWithC(), {
        companyId: DEMO.companyId,
        channelId: null,
        gatewayId: DEMO.gatewayId,
        extraIds: [],
        schemeId: DEMO.schemeId,
        occurredOn: "2026-11-13",
        feeExemptIds: [A],
      }),
      { grossOriginal: "1000.00", refunded: "0.00", dispute: null, failed: false, feesPaidBy: "nosotros" },
      "USD",
    );
    if (b.rules.scheme === null) throw new Error("Falta el esquema congelado");
    return b.rules.scheme;
  };

  it("las líneas congeladas con sus marcas congeladas (las de ese cobro, no las del esquema)", () => {
    expect(frozenExemptQuestion("nosotros", frozen())).toEqual({
      lines: [
        { beneficiaryId: A, name: "Grupo A", pct: "50", feeExempt: true },
        { beneficiaryId: B, name: "Grupo B", pct: "30", feeExempt: false },
        { beneficiaryId: C, name: "Grupo C", pct: "20", feeExempt: false },
      ],
      hasRemainder: false,
    });
  });

  it("no se pregunta con el comprador, sin esquema o sobre el bruto", () => {
    expect(frozenExemptQuestion("comprador", frozen())).toBeNull();
    expect(frozenExemptQuestion("nosotros", null)).toBeNull();
    expect(frozenExemptQuestion("nosotros", { ...frozen(), base: "bruto" })).toBeNull();
  });
});

describe("exemptIdsOf y someonePays", () => {
  const question = () => {
    const found = exemptQuestion(cfgWithC(), "nosotros", DEMO.schemeId, "2026-11-13");
    if (found === null) throw new Error("Debía preguntar");
    return found;
  };

  it("sin elección, las marcas que traen las líneas; con elección, solo las líneas elegidas", () => {
    expect(exemptIdsOf(question(), null)).toEqual([C]);
    expect(exemptIdsOf(question(), [B, A, "ben-fantasma"])).toEqual([A, B]);
    expect(exemptIdsOf(question(), [])).toEqual([]);
  });

  it("alguien paga la comisión mientras quede una línea sin marcar o un «Resto» con algo", () => {
    expect(someonePays(question(), [A, B])).toBe(true);
    expect(someonePays(question(), [A, B, C])).toBe(false);
    const withRest = { lines: question().lines.slice(0, 2), hasRemainder: true };
    expect(someonePays(withRest, [A, B])).toBe(true);
  });
});
