import { Decimal } from "decimal.js";
import { describe, expect, test } from "vitest";
import { D, ZERO, dec, isMoney, normPct, r2, toMoney } from "./decimal";

describe("D: la instancia propia de decimal.js", () => {
  test("usa 40 dígitos y redondea la mitad hacia arriba", () => {
    expect(D.precision).toBe(40);
    expect(D.rounding).toBe(Decimal.ROUND_HALF_UP);
  });

  test("no toca la configuración global", () => {
    expect(D).not.toBe(Decimal);
    expect(Decimal.precision).toBe(20);
  });

  test("0,1 + 0,2 es exactamente 0,3", () => {
    expect(new D("0.1").plus("0.2").eq("0.3")).toBe(true);
  });
});

describe("dec", () => {
  test("lee decimales escritos con punto", () => {
    expect(dec("90.30").toFixed(2)).toBe("90.30");
    expect(dec("-3.2").toFixed(2)).toBe("-3.20");
    expect(dec("33.3333").toFixed()).toBe("33.3333");
    expect(dec("0").isZero()).toBe(true);
  });

  test("devuelve siempre un decimal de la instancia propia", () => {
    expect(dec("1")).toBeInstanceOf(D);
    expect(dec(new Decimal("1.25"))).toBeInstanceOf(D);
    expect(dec(new Decimal("1.25")).toFixed()).toBe("1.25");
    expect(dec(new D("7")).toFixed()).toBe("7");
  });

  test.each(["", " ", "abc", "1,5", " 1", "1 ", "1e3", "0x1F", "Infinity", "NaN", "+1", ".5", "5.", "--1", "1.2.3"])(
    "«%s» no es un decimal: RangeError",
    (text) => {
      expect(() => dec(text)).toThrow(RangeError);
    },
  );

  test("rechaza decimales que no son finitos", () => {
    expect(() => dec(new D(NaN))).toThrow(RangeError);
    expect(() => dec(new D(Infinity))).toThrow(RangeError);
    expect(() => dec(new D(1).div(0))).toThrow(RangeError);
  });
});

describe("r2", () => {
  test.each([
    ["1.452", "1.45"],
    ["1.455", "1.46"],
    ["0.005", "0.01"],
    ["0.004", "0.00"],
    ["2.675", "2.68"],
    ["3.2", "3.20"],
    ["1.005", "1.01"],
    ["-1.452", "-1.45"],
  ])("%s → %s", (input, expected) => {
    expect(r2(new D(input)).toFixed(2)).toBe(expected);
  });

  test("no depende del redondeo de quien creó el decimal", () => {
    const Otro = Decimal.clone({ rounding: Decimal.ROUND_DOWN });
    expect(r2(new Otro("0.005")).toFixed(2)).toBe("0.01");
  });
});

describe("toMoney", () => {
  test("siempre dos decimales", () => {
    expect(toMoney(new D("90.3"))).toBe("90.30");
    expect(toMoney(new D("5"))).toBe("5.00");
    expect(toMoney(new D("-3.2"))).toBe("-3.20");
    expect(toMoney(new D("1234567.891"))).toBe("1234567.89");
    expect(toMoney(new D("1.005"))).toBe("1.01");
  });

  test('nunca devuelve "-0.00"', () => {
    expect(toMoney(new D("-0"))).toBe("0.00");
    expect(toMoney(new D("-0.001"))).toBe("0.00");
    expect(toMoney(new D(0).times(-1))).toBe("0.00");
    expect(toMoney(new D("0"))).toBe(ZERO);
  });

  test("un valor que no es finito no es dinero", () => {
    expect(() => toMoney(new D(NaN))).toThrow(RangeError);
  });

  test('ZERO es "0.00"', () => {
    expect(ZERO).toBe("0.00");
  });
});

describe("isMoney", () => {
  test.each(["0.00", "90.30", "-3.20", "1234567.89"])("%s es un monto canónico", (text) => {
    expect(isMoney(text)).toBe(true);
  });

  test.each(["90.3", "90", "90.300", "1,00", ".50", "$1.00", "1.00 ", "+1.00", "abc", ""])(
    "«%s» no es un monto canónico",
    (text) => {
      expect(isMoney(text)).toBe(false);
    },
  );

  test("lo que no es texto no es dinero", () => {
    expect(isMoney(90.3)).toBe(false);
    expect(isMoney(null)).toBe(false);
    expect(isMoney(undefined)).toBe(false);
    expect(isMoney(new D("1.00"))).toBe(false);
  });
});

describe("normPct", () => {
  test.each([
    ["2.90", "2.9"],
    ["50.0000", "50"],
    ["33.3333", "33.3333"],
    ["0.0000", "0"],
    ["-0", "0"],
    ["100", "100"],
    ["0.0001", "0.0001"],
  ])("%s → %s", (input, expected) => {
    expect(normPct(input)).toBe(expected);
  });

  test("acepta un decimal", () => {
    expect(normPct(new D(100).minus("80.5"))).toBe("19.5");
  });

  test("no usa notación exponencial", () => {
    expect(normPct("0.00000001")).toBe("0.00000001");
  });

  test("lo que no es un decimal: RangeError", () => {
    expect(() => normPct("2,9")).toThrow(RangeError);
  });
});
