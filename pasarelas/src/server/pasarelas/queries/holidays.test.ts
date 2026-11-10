import { describe, expect, it } from "vitest";
import { parseYear } from "./holidays";

describe("parseYear", () => {
  it("toma el año de la URL si es un año entero entre 1900 y 2200", () => {
    expect(parseYear("2028", 2026)).toBe(2028);
    expect(parseYear("1900", 2026)).toBe(1900);
    expect(parseYear("2200", 2026)).toBe(2200);
  });

  it("si no viene o no vale, da el de respaldo", () => {
    expect(parseYear(undefined, 2026)).toBe(2026);
    expect(parseYear(["2028", "2029"], 2026)).toBe(2026);
    expect(parseYear("", 2026)).toBe(2026);
    expect(parseYear("1899", 2026)).toBe(2026);
    expect(parseYear("2201", 2026)).toBe(2026);
    expect(parseYear("2028.5", 2026)).toBe(2026);
    expect(parseYear(" 2028", 2026)).toBe(2026);
    expect(parseYear("12028", 2026)).toBe(2026);
  });
});
