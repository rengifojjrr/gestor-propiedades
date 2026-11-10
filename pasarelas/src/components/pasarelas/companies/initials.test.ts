import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("toma la primera letra de las dos primeras palabras, en mayúsculas", () => {
    expect(initialsOf("Tienda Demo")).toBe("TD");
    expect(initialsOf("escuela demo de música")).toBe("ED");
  });

  it("con una sola palabra, su primera letra", () => {
    expect(initialsOf("Academia")).toBe("A");
  });

  it("salta lo que no es letra ni dígito y respeta las letras con tilde", () => {
    expect(initialsOf("  «Óptica»  & Ñandú ")).toBe("ÓÑ");
    expect(initialsOf("3 Hermanos")).toBe("3H");
  });

  it("sin nada que tomar, un signo neutro", () => {
    expect(initialsOf("")).toBe("·");
    expect(initialsOf("— & —")).toBe("·");
  });
});
