import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("une las clases con un espacio", () => {
    expect(cn("a", "b c", "d")).toBe("a b c d");
  });

  it("descarta lo que no es una clase (false, null, undefined, cadena vacía)", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("sin clases devuelve cadena vacía", () => {
    expect(cn()).toBe("");
    expect(cn(false, undefined)).toBe("");
  });
});
