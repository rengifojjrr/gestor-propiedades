import { describe, expect, it } from "vitest";
import { formatDays, payoutText } from "./days";

describe("formatDays", () => {
  it("escribe los días de la vista con un decimal y coma, sin ceros de relleno", () => {
    expect(formatDays("3.67")).toBe("3,7");
    expect(formatDays("3.00")).toBe("3");
    expect(formatDays("2.50")).toBe("2,5");
    expect(formatDays("0.00")).toBe("0");
    expect(formatDays("12.25")).toBe("12,3");
  });
});

describe("payoutText", () => {
  it("dice cuándo cae el dinero, en singular o plural y con el tipo de días", () => {
    expect(payoutText(2, "habiles")).toBe("2 días hábiles");
    expect(payoutText(1, "habiles")).toBe("1 día hábil");
    expect(payoutText(3, "corridos")).toBe("3 días corridos");
    expect(payoutText(1, "corridos")).toBe("1 día corrido");
  });

  it("con 0 días, el mismo día", () => {
    expect(payoutText(0, "habiles")).toBe("El mismo día");
    expect(payoutText(0, "corridos")).toBe("El mismo día");
  });
});
