import { describe, expect, it } from "vitest";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import { gatewaysByCost, paidByBuyers, whyUncosted } from "./gateway-cost";

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
  it("sin bruto (todo reembolsado), o con bruto pero sin venta: lo de los compradores se llevó lo que quedó", () => {
    expect(whyUncosted(gateway("reembolsada", null))).toBe("sin_bruto");
    // Quedaron 0,10 cobrados y lo del comprador (la cuota fija, 0,30) se los llevó: no se reembolsó todo.
    const leftover = { ...gateway("casi-todo", null), gross: "0.10", sale: "-0.20", buyerFees: "0.30" };
    expect(whyUncosted(leftover)).toBe("sin_venta");
  });
});

describe("paidByBuyers", () => {
  it("todas sus comisiones las pagaron los compradores; si el negocio pagó algo, no", () => {
    const byBuyers = { ...gateway("compradores", "0"), sale: "1009.54", fees: "0.00", buyerFees: "30.46" };
    expect(paidByBuyers(byBuyers)).toBe(true);
    // Lo que la pasarela retuvo de un reembolso lo pagó el negocio.
    expect(paidByBuyers({ ...byBuyers, fees: "3.20" })).toBe(false);
    expect(paidByBuyers(gateway("propia", "1"))).toBe(false);
  });
});
