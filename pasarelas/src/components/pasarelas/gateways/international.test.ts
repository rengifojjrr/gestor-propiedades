import { describe, expect, test } from "vitest";
import type { ExtraCfg } from "@/lib/pasarelas/types";
import {
  activeInternational,
  draftTotal,
  internationalTotal,
  isOption,
  originOf,
  surchargeText,
  withOrigin,
} from "./international";

const extra = (id: string, patch: Partial<ExtraCfg> = {}): ExtraCfg => ({
  id,
  name: id,
  pct: "1.5",
  fixed: "0.00",
  base: "bruto",
  payoutDaysOverride: null,
  defaultOn: false,
  active: true,
  sort: 0,
  kind: "opcion",
  ...patch,
});

const rapido = extra("rapido", { payoutDaysOverride: 0 });
const vieja = extra("vieja", { kind: "internacional", active: false, pct: "1" });
const internacional = extra("internacional", { kind: "internacional", sort: 2 });
const stripe = { extras: [rapido, vieja, internacional] };

describe("el recargo internacional de la pasarela", () => {
  test("activeInternational: el encendido; ninguno si no hay pasarela, si no cobra o si está apagado", () => {
    expect(activeInternational(stripe)).toBe(internacional);
    expect(activeInternational(undefined)).toBeNull();
    expect(activeInternational({ extras: [rapido] })).toBeNull();
    expect(activeInternational({ extras: [rapido, vieja] })).toBeNull();
  });

  test("isOption: las opciones sí; el recargo internacional (encendido o no) no es una opción más", () => {
    expect(stripe.extras.filter(isOption)).toEqual([rapido]);
  });
});

describe("nacional o internacional", () => {
  test("originOf: si las opciones guardadas traen un recargo internacional, cuál y las demás aparte", () => {
    expect(originOf(stripe, ["rapido"])).toEqual({ origin: "nacional", international: null, optionIds: ["rapido"] });
    expect(originOf(stripe, ["rapido", "internacional"])).toEqual({
      origin: "internacional",
      international: internacional,
      optionIds: ["rapido"],
    });
    // Uno ya apagado también cuenta: el cobro lo congeló así.
    expect(originOf(stripe, ["vieja"])).toEqual({ origin: "internacional", international: vieja, optionIds: [] });
    // Sin pasarela (o una id que ya no es de ella), lo que llega se queda como opción.
    expect(originOf(undefined, ["rapido"])).toEqual({ origin: "nacional", international: null, optionIds: ["rapido"] });
  });

  test("withOrigin: internacional agrega el recargo detrás de las opciones; nacional, o sin recargo, no", () => {
    expect(withOrigin(["rapido"], internacional, "internacional")).toEqual(["rapido", "internacional"]);
    expect(withOrigin(["rapido"], internacional, "nacional")).toEqual(["rapido"]);
    expect(withOrigin([], null, "internacional")).toEqual([]);
  });
});

describe("la cuenta completa", () => {
  test("internationalTotal: tarifa más recargo, sin pasar por number", () => {
    expect(internationalTotal({ pct: "2.9", fixed: "0.30" }, { pct: "1.5", fixed: "0.00" })).toEqual({
      pct: "4.4",
      fixed: "0.30",
    });
    expect(internationalTotal({ pct: "0.1", fixed: "0.10" }, { pct: "0.2", fixed: "0.20" })).toEqual({
      pct: "0.3",
      fixed: "0.30",
    });
  });

  test("draftTotal: con lo escrito en los campos; null mientras algo no se pueda leer o sea negativo", () => {
    expect(draftTotal({ pct: "2,9", fixed: "0,30" }, { pct: "1,5", fixed: "0,00" })).toEqual({
      pct: "4.4",
      fixed: "0.30",
    });
    expect(draftTotal({ pct: "2,9", fixed: "0,30" }, { pct: "1,5", fixed: "0,15" })).toEqual({
      pct: "4.4",
      fixed: "0.45",
    });
    expect(draftTotal({ pct: "", fixed: "0,30" }, { pct: "1,5", fixed: "0" })).toBeNull();
    expect(draftTotal({ pct: "2,9", fixed: "" }, { pct: "1,5", fixed: "0" })).toBeNull();
    expect(draftTotal({ pct: "2,9", fixed: "0,30" }, { pct: "", fixed: "0" })).toBeNull();
    expect(draftTotal({ pct: "2,9", fixed: "0,30" }, { pct: "1,5", fixed: "abc" })).toBeNull();
    expect(draftTotal({ pct: "2,9", fixed: "-0,30" }, { pct: "1,5", fixed: "0" })).toBeNull();
    expect(draftTotal({ pct: "2,9", fixed: "0,30" }, { pct: "1,5", fixed: "-1" })).toBeNull();
  });

  test("surchargeText: lo que suma el recargo en la moneda del cobro, sin los ceros", () => {
    expect(surchargeText({ pct: "1.5", fixed: "0.00" }, "USD")).toBe("1,5 %");
    expect(surchargeText({ pct: "1.5", fixed: "0.30" }, "USD")).toBe("1,5 % + $0,30");
    expect(surchargeText({ pct: "0", fixed: "0.30" }, "EUR")).toBe("€0,30");
    expect(surchargeText({ pct: "0", fixed: "0.00" }, "USD")).toBe("0 %");
  });
});
