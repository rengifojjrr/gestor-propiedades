import { describe, expect, it } from "vitest";
import { moneyTone } from "./tone";

describe("moneyTone", () => {
  it("negativo si el valor empieza por el signo menos", () => {
    expect(moneyTone("-3.20")).toBe("negative");
    expect(moneyTone("-0.01")).toBe("negative");
    expect(moneyTone("-1234.56")).toBe("negative");
  });

  it("cero si el valor es 0.00 (también con signo)", () => {
    expect(moneyTone("0.00")).toBe("zero");
    expect(moneyTone("-0.00")).toBe("zero");
    expect(moneyTone("0")).toBe("zero");
  });

  it("positivo en cualquier otro caso", () => {
    expect(moneyTone("90.30")).toBe("positive");
    expect(moneyTone("0.01")).toBe("positive");
    expect(moneyTone("100.00")).toBe("positive");
  });
});
