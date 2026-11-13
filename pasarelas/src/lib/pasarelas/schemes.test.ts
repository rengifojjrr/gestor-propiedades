import { describe, expect, test } from "vitest";
import { SCHEME_ISSUE_TEXT, schemeTotal, someonePaysFees, validateScheme, type SchemeIssue } from "./schemes";

const line = (beneficiaryId: string, pct: string) => ({ beneficiaryId, pct });

describe("schemeTotal", () => {
  test("suma los porcentajes sin perder precisión", () => {
    expect(schemeTotal([{ pct: "50" }, { pct: "30" }, { pct: "20" }])).toBe("100");
    expect(schemeTotal([{ pct: "33.3333" }, { pct: "33.3333" }, { pct: "33.3334" }])).toBe("100");
    expect(schemeTotal([{ pct: "50.0000" }, { pct: "30.5" }])).toBe("80.5");
    expect(schemeTotal([{ pct: "0.1" }, { pct: "0.2" }])).toBe("0.3");
  });

  test("sin líneas suma cero", () => {
    expect(schemeTotal([])).toBe("0");
  });

  test("un porcentaje que no es un decimal: RangeError", () => {
    expect(() => schemeTotal([{ pct: "50" }, { pct: "x" }])).toThrow(RangeError);
  });
});

describe("validateScheme", () => {
  test("un esquema que suma 100 % no tiene problemas", () => {
    expect(validateScheme([line("a", "50"), line("b", "30"), line("c", "20")], null)).toEqual([]);
    expect(validateScheme([line("a", "33.3333"), line("b", "33.3333"), line("c", "33.3334")], null)).toEqual([]);
    expect(validateScheme([line("a", "100")], null)).toEqual([]);
  });

  test("menos de 100 % con «Resto» es válido", () => {
    expect(validateScheme([line("a", "50"), line("b", "30")], "c")).toEqual([]);
  });

  test("100 % exacto con «Resto» también es válido (el resto no recibe nada)", () => {
    expect(validateScheme([line("a", "50"), line("b", "50")], "c")).toEqual([]);
  });

  test("sin líneas", () => {
    expect(validateScheme([], null)).toEqual(["sin_lineas"]);
    expect(validateScheme([], "c")).toEqual(["sin_lineas"]);
  });

  test("suma menos de 100 % y no hay «Resto»", () => {
    expect(validateScheme([line("a", "50"), line("b", "30")], null)).toEqual(["suma_menor_sin_resto"]);
    expect(validateScheme([line("a", "50"), line("b", "49.9999")], null)).toEqual(["suma_menor_sin_resto"]);
  });

  test("suma más de 100 %", () => {
    expect(validateScheme([line("a", "50"), line("b", "50.0001")], null)).toEqual(["suma_mayor_100"]);
    expect(validateScheme([line("a", "80"), line("b", "30")], "c")).toEqual(["suma_mayor_100"]);
  });

  test.each(["0", "0.0000", "-5", "100.0001", "150", "2.90001", "abc", "", "2,9", "1e1"])(
    "porcentaje inválido: «%s»",
    (pct) => {
      expect(validateScheme([line("a", "50"), line("b", pct)], "c")).toEqual(["pct_invalido"]);
    },
  );

  test("con un porcentaje inválido no se opina sobre la suma", () => {
    expect(validateScheme([line("a", "50"), line("b", "abc")], null)).toEqual(["pct_invalido"]);
  });

  test("un beneficiario dos veces", () => {
    expect(validateScheme([line("a", "50"), line("a", "50")], null)).toEqual(["beneficiario_repetido"]);
  });

  test("el «Resto» no puede ser además una línea", () => {
    expect(validateScheme([line("a", "50"), line("b", "30")], "b")).toEqual(["resto_en_lineas"]);
  });

  test("E9c: si todas las líneas están marcadas «No paga comisión» y no hay «Resto» que la pague, no se guarda", () => {
    const spared = (beneficiaryId: string, pct: string) => ({ ...line(beneficiaryId, pct), feeExempt: true });
    expect(validateScheme([spared("a", "50"), spared("b", "30"), spared("c", "20")], null)).toEqual([
      "nadie_paga_comision",
    ]);
    // El «Resto» con algo la paga; con las líneas en 100 % no recibe nada, así que no.
    expect(validateScheme([spared("a", "50"), spared("b", "30")], "c")).toEqual([]);
    expect(validateScheme([spared("a", "50"), spared("b", "50")], "c")).toEqual(["nadie_paga_comision"]);
    // Una sola sin marcar basta (sin la marca, la paga).
    expect(validateScheme([spared("a", "50"), spared("b", "30"), line("c", "20")], null)).toEqual([]);
    expect(validateScheme([spared("a", "50"), { ...line("b", "50"), feeExempt: false }], null)).toEqual([]);
  });

  test("devuelve todos los problemas a la vez, siempre en el mismo orden", () => {
    expect(validateScheme([line("a", "60"), line("a", "60")], "a")).toEqual([
      "suma_mayor_100",
      "beneficiario_repetido",
      "resto_en_lineas",
    ]);
    expect(validateScheme([line("a", "0"), line("a", "60")], "a")).toEqual([
      "pct_invalido",
      "beneficiario_repetido",
      "resto_en_lineas",
    ]);
    expect(validateScheme([line("a", "10"), line("a", "10")], null)).toEqual([
      "suma_menor_sin_resto",
      "beneficiario_repetido",
    ]);
  });
});

describe("SCHEME_ISSUE_TEXT", () => {
  test("cada problema tiene su texto en español", () => {
    const issues: SchemeIssue[] = [
      "sin_lineas",
      "pct_invalido",
      "suma_mayor_100",
      "suma_menor_sin_resto",
      "beneficiario_repetido",
      "resto_en_lineas",
      "nadie_paga_comision",
    ];
    expect(Object.keys(SCHEME_ISSUE_TEXT).sort()).toEqual([...issues].sort());
    for (const issue of issues) {
      expect(SCHEME_ISSUE_TEXT[issue].length).toBeGreaterThan(10);
    }
    expect(SCHEME_ISSUE_TEXT.suma_menor_sin_resto).toContain("Resto");
    expect(SCHEME_ISSUE_TEXT.suma_mayor_100).toContain("100");
    expect(SCHEME_ISSUE_TEXT.nadie_paga_comision).toBe(
      "Alguien tiene que pagar la comisión: deja al menos una parte sin marcar.",
    );
  });
});

describe("someonePaysFees", () => {
  test("una línea sin marcar con algo de porcentaje, o el «Resto» con algo, pagan la comisión", () => {
    expect(someonePaysFees([{ pct: "50", feeExempt: true }, { pct: "50" }], false)).toBe(true);
    expect(someonePaysFees([{ pct: "50", feeExempt: true }, { pct: "30", feeExempt: true }], true)).toBe(true);
  });

  test("todas marcadas, una sin marcar en 0 % o un «Resto» que no recibe nada: nadie la paga", () => {
    expect(someonePaysFees([{ pct: "100", feeExempt: true }], false)).toBe(false);
    expect(someonePaysFees([{ pct: "100", feeExempt: true }, { pct: "0", feeExempt: false }], true)).toBe(false);
    expect(someonePaysFees([{ pct: "50", feeExempt: true }, { pct: "30", feeExempt: true }], false)).toBe(false);
  });
});
