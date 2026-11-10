import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateText, DateTimeText, Money, Percent } from "./Figures";

const html = (element: ReactElement) => renderToStaticMarkup(element);
/** El texto que ve la persona: lo que queda al quitar las etiquetas. */
const text = (element: ReactElement) => html(element).replace(/<[^>]+>/g, "");

describe("Money", () => {
  it("pinta el monto con formatMoney: coma decimal, miles con punto y el símbolo de la moneda", () => {
    expect(text(createElement(Money, { value: "1234.56", currency: "USD" }))).toBe("$1.234,56");
    expect(text(createElement(Money, { value: "90.30", currency: "USD" }))).toBe("$90,30");
    expect(text(createElement(Money, { value: "5.00", currency: "EUR" }))).toBe("€5,00");
    expect(text(createElement(Money, { value: "5.00", currency: "MXN" }))).toBe("5,00 MXN");
  });

  it("un negativo lleva su signo además del tono: el color nunca es la única señal", () => {
    const negative = createElement(Money, { value: "-3.20", currency: "USD" });
    expect(text(negative)).toBe("-$3,20");
    expect(html(negative)).toContain('data-tone="negative"');
    expect(html(negative)).toContain("text-danger");

    const withoutSymbol = createElement(Money, { value: "-1234.50", currency: "MXN" });
    expect(text(withoutSymbol)).toBe("-1.234,50 MXN");
    expect(html(withoutSymbol)).toContain('data-tone="negative"');
  });

  it("el cero va atenuado y el positivo, sin tono", () => {
    const zero = html(createElement(Money, { value: "0.00", currency: "USD" }));
    expect(zero).toContain('data-tone="zero"');
    expect(zero).toContain("text-ink-soft");

    const positive = html(createElement(Money, { value: "90.30", currency: "USD" }));
    expect(positive).toContain('data-tone="positive"');
    expect(positive).not.toContain("text-danger");
  });

  it("el tono sale del mismo monto que se pinta: lo que redondea a cero no queda en rojo sin signo", () => {
    for (const value of ["-0.00", "-0.001", "-0.004"]) {
      const element = createElement(Money, { value, currency: "USD" });
      expect(text(element), value).toBe("$0,00");
      expect(html(element), value).toContain('data-tone="zero"');
      expect(html(element), value).not.toContain("text-danger");
    }
    const cent = createElement(Money, { value: "-0.005", currency: "USD" });
    expect(text(cent)).toBe("-$0,01");
    expect(html(cent)).toContain('data-tone="negative"');
  });

  it("lleva la moneda, cifras tabulares y la clase que le pasen", () => {
    const markup = html(createElement(Money, { value: "90.30", currency: "USD", className: "text-xl" }));
    expect(markup).toContain('data-currency="USD"');
    expect(markup).toContain("cifra");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("text-xl");
  });

  it("un monto que no es un decimal no se pinta: falla en vez de mostrar dinero inventado", () => {
    expect(() => html(createElement(Money, { value: "abc", currency: "USD" }))).toThrow(RangeError);
  });
});

describe("Percent", () => {
  it("pinta el porcentaje con formatPct: coma decimal, sin ceros de relleno", () => {
    expect(text(createElement(Percent, { value: "2.9" }))).toBe("2,9 %");
    expect(text(createElement(Percent, { value: "2.90" }))).toBe("2,9 %");
    expect(text(createElement(Percent, { value: "50" }))).toBe("50 %");
    expect(text(createElement(Percent, { value: "33.3333" }))).toBe("33,3333 %");
  });

  it("guarda el valor canónico y usa cifras tabulares", () => {
    const markup = html(createElement(Percent, { value: "2.9", className: "text-sm" }));
    expect(markup).toContain('data-value="2.9"');
    expect(markup).toContain("cifra");
    expect(markup).toContain("text-sm");
  });
});

describe("DateText", () => {
  it("pinta la fecha con formatDate y la deja en ISO para la máquina", () => {
    const date = createElement(DateText, { value: "2026-11-13" });
    expect(html(date)).toMatch(/^<time datetime="2026-11-13"/i);
    expect(text(date)).toBe("vie 13 nov 2026");
    expect(text(createElement(DateText, { value: "2026-02-01" }))).toBe("dom 1 feb 2026");
    expect(text(createElement(DateText, { value: "2027-12-31" }))).toBe("vie 31 dic 2027");
  });

  it("usa cifras tabulares, no se parte en dos líneas y lleva la clase que le pasen", () => {
    const markup = html(createElement(DateText, { value: "2026-11-13", className: "text-sm" }));
    expect(markup).toContain("cifra");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("text-sm");
  });

  it("una fecha que no existe no se pinta: falla en vez de mostrar otro día", () => {
    expect(() => html(createElement(DateText, { value: "2026-02-30" }))).toThrow(RangeError);
    expect(() => html(createElement(DateText, { value: "2026-11-13T15:30:00Z" }))).toThrow(RangeError);
    expect(() => html(createElement(DateText, { value: "" }))).toThrow(RangeError);
  });
});

describe("DateTimeText", () => {
  it("pinta el instante con formatDateTime, en hora de Nueva York, y lo deja tal cual para la máquina", () => {
    const instant = createElement(DateTimeText, { value: "2026-11-13T15:30:00Z" });
    expect(html(instant)).toMatch(/^<time datetime="2026-11-13T15:30:00Z"/i);
    expect(text(instant)).toBe("vie 13 nov 2026, 10:30");
  });

  it("el día es el de Nueva York, no el de UTC, en invierno y en verano", () => {
    // 03:30 UTC del sábado 14 todavía es viernes 13 en Nueva York (EST, −5).
    expect(text(createElement(DateTimeText, { value: "2026-11-14T03:30:00Z" }))).toBe("vie 13 nov 2026, 22:30");
    // En verano el desfase es −4 (EDT).
    expect(text(createElement(DateTimeText, { value: "2026-07-01T03:30:00Z" }))).toBe("mar 30 jun 2026, 23:30");
  });

  it("lee el instante como lo entrega la base, con desfase en vez de Z", () => {
    const fromDatabase = createElement(DateTimeText, { value: "2026-11-13T15:30:00.123456+00:00" });
    expect(text(fromDatabase)).toBe("vie 13 nov 2026, 10:30");
    expect(html(fromDatabase)).toMatch(/^<time datetime="2026-11-13T15:30:00.123456\+00:00"/i);
  });

  it("usa cifras tabulares y lleva la clase que le pasen", () => {
    const markup = html(createElement(DateTimeText, { value: "2026-11-13T15:30:00Z", className: "text-sm" }));
    expect(markup).toContain("cifra");
    expect(markup).toContain("whitespace-nowrap");
    expect(markup).toContain("text-sm");
  });

  it("un texto sin zona no es un instante: falla en vez de adivinarle la hora", () => {
    expect(() => html(createElement(DateTimeText, { value: "2026-11-13T15:30" }))).toThrow(RangeError);
    expect(() => html(createElement(DateTimeText, { value: "2026-11-13" }))).toThrow(RangeError);
    expect(() => html(createElement(DateTimeText, { value: "ayer" }))).toThrow(RangeError);
  });
});

describe("las fechas ya no aceptan un texto hecho a mano", () => {
  it("`formatted` no es una prop: aunque llegue, el texto sale del formateador", () => {
    // @ts-expect-error — `formatted` ya no existe en DateTextProps.
    const date = createElement(DateText, { value: "2026-11-13", formatted: "13/11/2026" });
    expect(text(date)).toBe("vie 13 nov 2026");
    // @ts-expect-error — `formatted` ya no existe en DateTimeTextProps.
    const instant = createElement(DateTimeText, { value: "2026-11-13T15:30:00Z", formatted: "13/11/2026 15:30" });
    expect(text(instant)).toBe("vie 13 nov 2026, 10:30");
  });
});
