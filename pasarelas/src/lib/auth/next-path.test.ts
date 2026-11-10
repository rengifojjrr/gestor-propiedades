import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT_PATH, NEXT_PARAM, loginPath, safeNextPath, verifyPath } from "./next-path";

describe("safeNextPath", () => {
  it("deja pasar una ruta interna, con su consulta y su ancla", () => {
    expect(safeNextPath("/pasarelas/cobros")).toBe("/pasarelas/cobros");
    expect(safeNextPath("/pasarelas/cobros?estado=depositado&pagina=2")).toBe(
      "/pasarelas/cobros?estado=depositado&pagina=2",
    );
    expect(safeNextPath("/ajustes#seguridad")).toBe("/ajustes#seguridad");
    expect(safeNextPath("/")).toBe("/");
  });

  it.each([
    ["otro sitio sin esquema", "//evil.example"],
    ["otro sitio sin esquema, con ruta", "//evil.example/pasarelas"],
    ["otro sitio con http", "http://evil.example"],
    ["otro sitio con https", "https://evil.example/pasarelas"],
    ["un esquema sin barras", "https:evil.example"],
    ["un esquema que ejecuta código", "javascript:alert(1)"],
    ["una barra invertida (el navegador la lee como «//»)", "/\\evil.example"],
    ["una barra invertida más adentro", "/\\/evil.example"],
    ["un tabulador que el navegador descarta", "/\t/evil.example"],
    ["un salto de línea que el navegador descarta", "/\n/evil.example"],
    ["una ruta relativa", "pasarelas/cobros"],
    ["una ruta relativa hacia arriba", "../pasarelas"],
    ["una cadena vacía", ""],
  ])("cambia por el Resumen %s", (_caso, value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_NEXT_PATH);
  });

  it("cambia por el Resumen lo que no es una cadena", () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(["/ajustes", "/pasarelas"])).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(42)).toBe(DEFAULT_NEXT_PATH);
  });

  it("no manda de vuelta a la entrada (sería un ir y venir)", () => {
    expect(safeNextPath("/login")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/login/verificar?siguiente=/ajustes")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/loginx")).toBe("/loginx");
  });

  it("el Resumen es /pasarelas y el parámetro se llama «siguiente»", () => {
    expect(DEFAULT_NEXT_PATH).toBe("/pasarelas");
    expect(NEXT_PARAM).toBe("siguiente");
  });
});

describe("loginPath y verifyPath", () => {
  it("llevan la ruta a la que se vuelve, codificada", () => {
    expect(loginPath("/pasarelas/cobros?estado=depositado")).toBe(
      "/login?siguiente=%2Fpasarelas%2Fcobros%3Festado%3Ddepositado",
    );
    expect(verifyPath("/ajustes")).toBe("/login/verificar?siguiente=%2Fajustes");
  });

  it("sin ruta, o con el Resumen, van sin parámetro", () => {
    expect(loginPath()).toBe("/login");
    expect(loginPath(DEFAULT_NEXT_PATH)).toBe("/login");
    expect(verifyPath()).toBe("/login/verificar");
    expect(verifyPath(DEFAULT_NEXT_PATH)).toBe("/login/verificar");
  });

  it("nunca llevan una ruta de fuera", () => {
    expect(loginPath("//evil.example")).toBe("/login");
    expect(verifyPath("https://evil.example")).toBe("/login/verificar");
  });
});
