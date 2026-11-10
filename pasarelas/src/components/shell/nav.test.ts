import { describe, expect, it } from "vitest";
import { NAV, isActive } from "./nav";

describe("NAV", () => {
  it("la barra principal: Resumen, Cobros y Repartos", () => {
    expect(NAV.main.map((i) => [i.href, i.label])).toEqual([
      ["/pasarelas", "Resumen"],
      ["/pasarelas/cobros", "Cobros"],
      ["/pasarelas/repartos", "Repartos"],
    ]);
  });

  it("el botón fijo lleva a registrar un cobro", () => {
    expect([NAV.register.href, NAV.register.label]).toEqual(["/pasarelas/registrar", "Registrar cobro"]);
  });

  it("«Más» trae el resto de secciones del spec, en orden", () => {
    expect(NAV.more.map((i) => [i.href, i.label])).toEqual([
      ["/pasarelas/empresas", "Empresas"],
      ["/pasarelas/pasarelas", "Pasarelas"],
      ["/pasarelas/cuentas", "Cuentas destino"],
      ["/pasarelas/importar", "Importar"],
      ["/pasarelas/feriados", "Feriados"],
      ["/pasarelas/papelera", "Papelera"],
      ["/ajustes", "Ajustes"],
    ]);
  });

  it("cada entrada tiene su ícono", () => {
    for (const item of [...NAV.main, NAV.register, ...NAV.more]) {
      expect(item.icon, item.label).toBeTruthy();
    }
  });
});

describe("isActive", () => {
  it("el Resumen solo está activo en su ruta exacta", () => {
    expect(isActive("/pasarelas", "/pasarelas")).toBe(true);
    expect(isActive("/pasarelas/cobros", "/pasarelas")).toBe(false);
    expect(isActive("/pasarelas/pasarelas", "/pasarelas")).toBe(false);
  });

  it("una sección está activa en su ruta y en las de adentro", () => {
    expect(isActive("/pasarelas/cobros", "/pasarelas/cobros")).toBe(true);
    expect(isActive("/pasarelas/cobros/123", "/pasarelas/cobros")).toBe(true);
    expect(isActive("/pasarelas/pasarelas/abc", "/pasarelas/pasarelas")).toBe(true);
    expect(isActive("/ajustes", "/ajustes")).toBe(true);
  });

  it("no confunde rutas que empiezan igual", () => {
    expect(isActive("/pasarelas/cobros-viejos", "/pasarelas/cobros")).toBe(false);
    expect(isActive("/pasarelas/repartos", "/pasarelas/cobros")).toBe(false);
  });
});
