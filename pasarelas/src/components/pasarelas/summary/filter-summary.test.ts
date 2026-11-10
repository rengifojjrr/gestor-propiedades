import { describe, expect, it } from "vitest";
import { filterSummary } from "./filter-summary";

describe("filterSummary", () => {
  it("el período y la moneda", () => {
    expect(filterSummary({ period: undefined, currency: "USD", others: 0 })).toBe("Este mes · USD");
    expect(filterSummary({ period: "90d", currency: "EUR", others: 0 })).toBe("Últimos 90 días · EUR");
    expect(filterSummary({ period: "personalizado", currency: "USD", others: 0 })).toBe("Fechas elegidas · USD");
  });

  it("cuántos filtros más hay activos (empresa, canal, pasarela)", () => {
    expect(filterSummary({ period: "este_anio", currency: "USD", others: 1 })).toBe("Este año · USD · 1 filtro más");
    expect(filterSummary({ period: "este_mes", currency: "USD", others: 3 })).toBe("Este mes · USD · 3 filtros más");
  });

  it("sin moneda (nada que mostrar) y con un período que no se entiende (rige este mes)", () => {
    expect(filterSummary({ period: "siempre", currency: null, others: 0 })).toBe("Este mes");
  });
});
