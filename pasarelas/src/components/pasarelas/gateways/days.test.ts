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

  it("con un máximo mayor, la ventana: «De 3 a 5 días hábiles»; igual o vacío, un solo día", () => {
    expect(payoutText(3, "habiles", 5)).toBe("De 3 a 5 días hábiles");
    expect(payoutText(7, "corridos", 10)).toBe("De 7 a 10 días corridos");
    expect(payoutText(0, "habiles", 1)).toBe("De 0 a 1 día hábil");
    expect(payoutText(2, "habiles", 2)).toBe("2 días hábiles");
    expect(payoutText(2, "habiles", null)).toBe("2 días hábiles");
  });
});
