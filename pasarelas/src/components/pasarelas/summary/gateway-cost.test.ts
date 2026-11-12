import { describe, expect, it } from "vitest";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import { gatewaysByCost, whyUncosted } from "./gateway-cost";

type Gateway = CurrencySummary["byGateway"][number];

const gateway = (gatewayId: string, effectiveCostPct: string | null): Gateway => ({
  gatewayId,
  gross: effectiveCostPct === null ? "0.00" : "100.00",
  sale: effectiveCostPct === null ? "0.00" : "100.00",
  fees: "1.00",
  buyerFees: "0.00",
  net: "99.00",
  count: 1,
  sharePct: null,
  effectiveCostPct,
});

describe("gatewaysByCost", () => {
  it("de la más cara a la más barata (como decimales, no como texto); las que no tienen costo efectivo, aparte", () => {
    const { costed, uncosted } = gatewaysByCost([
      gateway("barata", "2.5"),
      gateway("reembolsada", null),
      gateway("cara", "10.25"),
      gateway("media", "3"),
    ]);
    expect(costed.map((row) => [row.gatewayId, row.effectiveCostPct])).toEqual([
      ["cara", "10.25"],
      ["media", "3"],
      ["barata", "2.5"],
    ]);
    // Sin bruto no hay costo efectivo: no es un 0 %, no se dibuja como tal.
    expect(uncosted.map((row) => row.gatewayId)).toEqual(["reembolsada"]);
  });

  it("sin ninguna con costo efectivo", () => {
    expect(gatewaysByCost([gateway("a", null)])).toEqual({ costed: [], uncosted: [gateway("a", null)] });
  });
});

describe("whyUncosted", () => {
  it("sin bruto (todo reembolsado), o porque todas sus comisiones las pagaron los compradores", () => {
    expect(whyUncosted(gateway("reembolsada", null))).toBe("sin_bruto");
    const byBuyers = { ...gateway("compradores", null), gross: "1040.00", sale: "1009.54", fees: "0.00", buyerFees: "30.46" };
    expect(whyUncosted(byBuyers)).toBe("compradores");
    // Si el negocio pagó algo (lo que la pasarela retuvo de un reembolso), es que no le quedó bruto propio.
    expect(whyUncosted({ ...byBuyers, fees: "3.20" })).toBe("sin_bruto");
  });
});
