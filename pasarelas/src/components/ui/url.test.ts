import { describe, expect, it } from "vitest";
import { PAGE_PARAM, PERIOD_PRESETS, hrefWith, periodChanges } from "./url";

describe("hrefWith", () => {
  it("agrega un parámetro y conserva los demás", () => {
    expect(hrefWith("/pasarelas/cobros", "empresa=a1", { pasarela: "g1" })).toBe(
      "/pasarelas/cobros?empresa=a1&pasarela=g1",
    );
  });

  it("reemplaza el valor de un parámetro que ya estaba", () => {
    expect(hrefWith("/pasarelas/cobros", "empresa=a1", { empresa: "a2" })).toBe("/pasarelas/cobros?empresa=a2");
  });

  it("quita el parámetro cuando el valor es nulo o vacío", () => {
    expect(hrefWith("/pasarelas/cobros", "empresa=a1&q=demo", { empresa: null })).toBe("/pasarelas/cobros?q=demo");
    expect(hrefWith("/pasarelas/cobros", "empresa=a1&q=demo", { q: "" })).toBe("/pasarelas/cobros?empresa=a1");
  });

  it("sin parámetros no deja un «?» colgando", () => {
    expect(hrefWith("/pasarelas/cobros", "empresa=a1", { empresa: null })).toBe("/pasarelas/cobros");
  });

  it("cambiar un filtro vuelve a la primera página", () => {
    expect(PAGE_PARAM).toBe("pagina");
    expect(hrefWith("/pasarelas/cobros", "pagina=3&empresa=a1", { empresa: "a2" })).toBe(
      "/pasarelas/cobros?empresa=a2",
    );
  });

  it("cambiar de página conserva los filtros", () => {
    expect(hrefWith("/pasarelas/cobros", "empresa=a1&pagina=3", { pagina: "4" })).toBe(
      "/pasarelas/cobros?empresa=a1&pagina=4",
    );
    expect(hrefWith("/pasarelas/cobros", "empresa=a1&pagina=3", { pagina: null })).toBe(
      "/pasarelas/cobros?empresa=a1",
    );
  });

  it("acepta un URLSearchParams y no lo modifica", () => {
    const current = new URLSearchParams("q=tienda demo");
    expect(hrefWith("/pasarelas", current, { periodo: "30d" })).toBe("/pasarelas?q=tienda+demo&periodo=30d");
    expect(current.toString()).toBe("q=tienda+demo");
  });

  it("admite otro nombre para el parámetro de página", () => {
    expect(hrefWith("/x", "p=2&q=a", { q: "b" }, "p")).toBe("/x?q=b");
  });
});

describe("períodos", () => {
  it("ofrece los siete períodos del motor, en orden", () => {
    expect(PERIOD_PRESETS.map((p) => p.value)).toEqual([
      "este_mes",
      "mes_anterior",
      "30d",
      "90d",
      "365d",
      "este_anio",
      "personalizado",
    ]);
    expect(PERIOD_PRESETS.map((p) => p.label)).toEqual([
      "Este mes",
      "El mes anterior",
      "Últimos 30 días",
      "Últimos 90 días",
      "Últimos 365 días",
      "Este año",
      "Elegir fechas",
    ]);
  });

  it("un período fijo borra las fechas elegidas a mano", () => {
    expect(periodChanges("30d")).toEqual({ periodo: "30d", desde: null, hasta: null });
  });

  it("«elegir fechas» conserva las fechas que ya hubiera en la URL", () => {
    expect(periodChanges("personalizado")).toEqual({ periodo: "personalizado" });
    expect(hrefWith("/pasarelas", "desde=2026-11-01&hasta=2026-11-09", periodChanges("personalizado"))).toBe(
      "/pasarelas?desde=2026-11-01&hasta=2026-11-09&periodo=personalizado",
    );
  });
});
