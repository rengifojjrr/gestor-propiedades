import { describe, expect, it } from "vitest";
import { TotpCode } from "./totp-code";

describe("TotpCode", () => {
  it("acepta seis dígitos, y los entrega sin los espacios con que algunas apps los muestran", () => {
    expect(TotpCode.parse("123456")).toBe("123456");
    expect(TotpCode.parse("123 456")).toBe("123456");
    expect(TotpCode.parse(" 012345\n")).toBe("012345");
  });

  it.each([
    ["cinco dígitos", "12345"],
    ["siete dígitos", "1234567"],
    ["letras", "12345a"],
    ["un signo", "-12345"],
    ["nada", ""],
    ["un campo que no vino en el formulario", null],
    ["un número en vez de texto", 123456],
  ])("rechaza %s", (_caso, value) => {
    expect(TotpCode.safeParse(value).success).toBe(false);
  });
});
