import { describe, expect, it } from "vitest";
import { retentionDraftIssues, retentionDraftTotal } from "./retention";

const person = (beneficiaryId: string, pct: string) => ({ beneficiaryId, pct });

describe("retentionDraftIssues: lo que no deja guardar la retención, mientras se escribe", () => {
  it("sin retener (0 %) y sin personas se puede guardar; con personas, no", () => {
    expect(retentionDraftIssues("0", [])).toEqual([]);
    expect(retentionDraftIssues("0,00", [person("a", "100")])).toEqual(["personas_sin_pct"]);
  });

  it("con más de 0 % hace falta al menos una persona, y que sumen exactamente 100", () => {
    expect(retentionDraftIssues("5", [])).toEqual(["sin_personas"]);
    expect(retentionDraftIssues("5", [person("a", "50"), person("b", "50")])).toEqual([]);
    expect(retentionDraftIssues("5 %", [person("a", "50"), person("b", "49,99")])).toEqual(["no_suma_100"]);
    expect(
      retentionDraftIssues("2,5", [person("a", "33,3333"), person("b", "33,3333"), person("c", "33,3334")]),
    ).toEqual([]);
  });

  it("un porcentaje de persona que no se lee no suma; una persona dos veces, tampoco vale", () => {
    expect(retentionDraftIssues("5", [person("a", "100"), person("b", "")])).toEqual([]);
    expect(retentionDraftIssues("5", [person("a", "50"), person("b", "cincuenta")])).toEqual(["no_suma_100"]);
    expect(retentionDraftIssues("5", [person("a", "50"), person("a", "50")])).toEqual(["persona_repetida"]);
  });

  it("si el % que retiene no se lee, no adivina: lo dice el servidor junto al campo", () => {
    expect(retentionDraftIssues("", [])).toEqual([]);
    expect(retentionDraftIssues("150", [person("a", "100")])).toEqual([]);
  });
});

describe("retentionDraftTotal: lo que suman las personas", () => {
  it("suma lo que se lee y no cuenta lo que no", () => {
    expect(retentionDraftTotal([])).toBe("0");
    expect(retentionDraftTotal([person("a", "50"), person("b", "49,5")])).toBe("99.5");
    expect(retentionDraftTotal([person("a", "33,3333"), person("b", "33,3333"), person("c", "33,3334")])).toBe("100");
    expect(retentionDraftTotal([person("a", "60"), person("b", "")])).toBe("60");
  });
});
