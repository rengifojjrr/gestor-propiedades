import { describe, expect, test } from "vitest";
import {
  add,
  cmp,
  formatAmount,
  formatMoney,
  formatPct,
  isZero,
  neg,
  parseMoney,
  parsePct,
  pctOf,
  sub,
  sumByCurrency,
} from "./money";

describe("parseMoney", () => {
  // Foco 2: los casos donde un separador mal leído cambia el monto por mil.
  test.each([
    ["1,234", "1234.00"],
    ["1.234,5", "1234.50"],
    ["$ 100", "100.00"],
    ["100,005", "100005.00"],
    ["1,234.56", "1234.56"],
    ["12.345", "12345.00"],
    ["0,5", "0.50"],
  ])("«%s» → %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  test.each(["1.2.3", "abc", "", "1,2345"])("«%s» → null", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  test.each([
    ["100", "100.00"],
    ["100.5", "100.50"],
    ["100,5", "100.50"],
    ["100.50", "100.50"],
    ["1.234,56", "1234.56"],
    ["1,234,567", "1234567.00"],
    ["1.234.567", "1234567.00"],
    ["1,234,567.89", "1234567.89"],
    ["1.234.567,89", "1234567.89"],
    ["  42  ", "42.00"],
    ["1 234,56", "1234.56"],
    ["007", "7.00"],
    ["0", "0.00"],
  ])("«%s» → %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  test.each([
    ["$1,234.56", "1234.56"],
    ["€5,00", "5.00"],
    ["5,00 €", "5.00"],
    ["-3,20", "-3.20"],
    ["-$3,20", "-3.20"],
    ["$-3.20", "-3.20"],
    ["- 3.20", "-3.20"],
    ["+3.20", "3.20"],
    ["-0", "0.00"],
    ["-0,00", "0.00"],
  ])("con símbolo o signo: «%s» → %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  test.each([
    "   ",
    "$",
    "-",
    "1,234.567", // tres decimales
    "100.005,123", // tres decimales
    "12a",
    "USD 5",
    "5 MXN",
    "100,", // separador sin decimales
    "100.",
    ",5", // sin parte entera
    ".5",
    "1,,5",
    "1.,5",
    "1,23.45", // miles mal agrupados
    "12,34.5",
    "1,234,56",
    "1,2,3",
    "1.234.56",
    "1.234,567.8",
    "0,500", // «miles» que empiezan por cero: ambiguo
    "0.500",
    "1234,567", // grupo de miles de cuatro dígitos: ambiguo
    "+-5",
    "--5",
    "-$-5",
    "$5€",
    "$$5",
    "5-",
    "1e3",
    "5%",
  ])("ambiguo o inválido: «%s» → null", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  test("lo que devuelve formatMoney en dólares o euros se vuelve a leer igual", () => {
    for (const amount of ["1234.56", "-3.20", "0.05", "1000000.00", "999.99"]) {
      expect(parseMoney(formatMoney(amount, "USD"))).toBe(amount);
      expect(parseMoney(formatMoney(amount, "EUR"))).toBe(amount);
      expect(parseMoney(formatAmount(amount))).toBe(amount);
    }
  });
});

describe("parsePct", () => {
  test.each([
    ["2,9", "2.9"],
    ["2.9 %", "2.9"],
    ["2,90 %", "2.9"],
    ["50", "50"],
    ["50%", "50"],
    ["33.3333", "33.3333"],
    ["33,3334", "33.3334"],
    ["0", "0"],
    ["0,0", "0"],
    ["100", "100"],
    ["100,0000", "100"],
    [" 1,5 ", "1.5"],
    ["007", "7"],
  ])("«%s» → %s", (input, expected) => {
    expect(parsePct(input)).toBe(expected);
  });

  test.each(["", "  ", "%", "abc", "100,0001", "101", "-1", "+5", "2,90001", "1.2.3", "1,2,3", "2.9%%", "% 5", ",5", "5,"])(
    "«%s» → null",
    (input) => {
      expect(parsePct(input)).toBeNull();
    },
  );
});

describe("formatAmount", () => {
  test.each([
    ["1234.56", "1.234,56"],
    ["-3.20", "-3,20"],
    ["0.00", "0,00"],
    ["0.05", "0,05"],
    ["999.99", "999,99"],
    ["1000.00", "1.000,00"],
    ["100000.00", "100.000,00"],
    ["1234567.89", "1.234.567,89"],
    ["-1234567.89", "-1.234.567,89"],
    ["-0.00", "0,00"],
  ])("%s → %s", (input, expected) => {
    expect(formatAmount(input)).toBe(expected);
  });

  test("lo que no es un decimal: RangeError", () => {
    expect(() => formatAmount("1.234,56")).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  test.each([
    ["1234.56", "USD", "$1.234,56"],
    ["-3.20", "USD", "-$3,20"],
    ["5.00", "MXN", "5,00 MXN"],
    ["5.00", "EUR", "€5,00"],
    ["1234.56", "GBP", "1.234,56 GBP"],
    ["1234.56", "MXN", "1.234,56 MXN"],
    ["-5.00", "MXN", "-5,00 MXN"],
    ["-5.00", "EUR", "-€5,00"],
    ["0.00", "USD", "$0,00"],
    ["-0.00", "USD", "$0,00"],
  ])("%s %s → %s", (amount, currency, expected) => {
    expect(formatMoney(amount, currency)).toBe(expected);
  });

  test("solo llevan símbolo las monedas que parseMoney sabe leer: las demás van con su código", () => {
    for (const currency of ["GBP", "MXN", "CAD", "JPY", "CHF"]) {
      expect(formatMoney("5.00", currency)).toBe(`5,00 ${currency}`);
    }
    for (const currency of ["USD", "EUR"]) {
      expect(parseMoney(formatMoney("5.00", currency))).toBe("5.00");
    }
  });

  test("una moneda con nombre de propiedad heredada va como código", () => {
    expect(formatMoney("1.00", "constructor")).toBe("1,00 constructor");
  });
});

describe("formatPct", () => {
  test.each([
    ["2.9", "2,9 %"],
    ["2.90", "2,9 %"],
    ["50", "50 %"],
    ["33.3333", "33,3333 %"],
    ["0", "0 %"],
  ])("%s → %s", (input, expected) => {
    expect(formatPct(input)).toBe(expected);
  });
});

describe("aritmética de montos", () => {
  test("add suma sin perder centavos", () => {
    expect(add("0.10", "0.20")).toBe("0.30");
    expect(add("3.20", "1.50", "5.00")).toBe("9.70");
    expect(add("5.00", "-8.20")).toBe("-3.20");
    expect(add("7.00")).toBe("7.00");
    expect(add()).toBe("0.00");
  });

  test("sub resta", () => {
    expect(sub("100.00", "9.70")).toBe("90.30");
    expect(sub("0.00", "3.20")).toBe("-3.20");
    expect(sub("3.20", "3.20")).toBe("0.00");
  });

  test('neg cambia el signo y nunca da "-0.00"', () => {
    expect(neg("3.20")).toBe("-3.20");
    expect(neg("-3.20")).toBe("3.20");
    expect(neg("0.00")).toBe("0.00");
  });

  test("cmp compara por valor, no como texto", () => {
    expect(cmp("9.00", "10.00")).toBe(-1);
    expect(cmp("10.00", "9.00")).toBe(1);
    expect(cmp("10.00", "10.00")).toBe(0);
    expect(cmp("-0.00", "0.00")).toBe(0);
    expect(cmp("-1.00", "0.00")).toBe(-1);
  });

  test("isZero", () => {
    expect(isZero("0.00")).toBe(true);
    expect(isZero("-0.00")).toBe(true);
    expect(isZero("0.01")).toBe(false);
    expect(isZero("-0.01")).toBe(false);
  });

  test("lo que no es un decimal: RangeError", () => {
    expect(() => add("1.00", "abc")).toThrow(RangeError);
    expect(() => sub("1,00", "1.00")).toThrow(RangeError);
    expect(() => neg("")).toThrow(RangeError);
    expect(() => cmp("x", "1.00")).toThrow(RangeError);
    expect(() => isZero("cero")).toThrow(RangeError);
  });
});

describe("sumByCurrency", () => {
  type Row = { currency: string; net: string };
  const rows: Row[] = [
    { currency: "USD", net: "90.30" },
    { currency: "EUR", net: "10.00" },
    { currency: "USD", net: "-3.20" },
    { currency: "USD", net: "0.10" },
    { currency: "EUR", net: "0.20" },
  ];

  test("nunca suma monedas distintas", () => {
    expect(
      sumByCurrency(
        rows,
        (r) => r.currency,
        (r) => r.net,
      ),
    ).toEqual({ USD: "87.20", EUR: "10.20" });
  });

  test("conserva el orden en que aparece cada moneda", () => {
    const totals = sumByCurrency(
      rows.toReversed(),
      (r) => r.currency,
      (r) => r.net,
    );
    expect(Object.keys(totals)).toEqual(["EUR", "USD"]);
  });

  test("sin filas no hay monedas", () => {
    expect(
      sumByCurrency(
        [] as Row[],
        (r) => r.currency,
        (r) => r.net,
      ),
    ).toEqual({});
  });
});

describe("pctOf", () => {
  test("parte sobre el total, en porcentaje", () => {
    expect(pctOf("9.70", "100.00")).toBe("9.7");
    expect(pctOf("50.00", "200.00")).toBe("25");
    expect(pctOf("0.00", "100.00")).toBe("0");
    expect(pctOf("-3.20", "100.00")).toBe("-3.2");
  });

  test("redondea a dos decimales si no se dice otra cosa", () => {
    expect(pctOf("1.00", "3.00")).toBe("33.33");
    expect(pctOf("2.00", "3.00")).toBe("66.67");
  });

  test("redondea a los decimales pedidos, mitad hacia arriba", () => {
    expect(pctOf("1.00", "3.00", 4)).toBe("33.3333");
    expect(pctOf("2.00", "3.00", 0)).toBe("67");
    expect(pctOf("1.00", "8.00", 1)).toBe("12.5");
    expect(pctOf("1.00", "16.00", 1)).toBe("6.3");
  });

  test("si el total es cero no hay porcentaje", () => {
    expect(pctOf("5.00", "0.00")).toBeNull();
    expect(pctOf("0.00", "-0.00")).toBeNull();
  });
});
