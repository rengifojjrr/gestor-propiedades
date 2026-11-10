import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

describe("DateText y DateTimeText", () => {
  it("son un <time> con la fecha para la máquina y el texto que les pasen para la persona", () => {
    const date = createElement(DateText, { value: "2026-11-13", formatted: "vie 13 nov 2026" });
    expect(html(date)).toMatch(/^<time datetime="2026-11-13"/i);
    expect(text(date)).toBe("vie 13 nov 2026");

    const instant = createElement(DateTimeText, { value: "2026-11-13T15:30:00Z", formatted: "vie 13 nov 2026, 10:30" });
    expect(html(instant)).toMatch(/^<time datetime="2026-11-13T15:30:00Z"/i);
    expect(text(instant)).toBe("vie 13 nov 2026, 10:30");
  });

  it("sin texto pintan la fecha tal cual (ISO), que nunca engaña", () => {
    expect(text(createElement(DateText, { value: "2026-11-13" }))).toBe("2026-11-13");
    expect(text(createElement(DateTimeText, { value: "2026-11-13T15:30:00Z" }))).toBe("2026-11-13T15:30:00Z");
  });

  /*
   * Recordatorio que se cobra solo: `formatDate` y `formatDateTime` son de `dates.ts` (tarea 4), que todavía no
   * está junto al kit. El día que ese archivo exista, esta prueba falla hasta que `Figures.tsx` lo use.
   */
  it("en cuanto exista dates.ts, las fechas se formatean con formatDate y formatDateTime", () => {
    const datesModule = fileURLToPath(new URL("../../lib/pasarelas/dates.ts", import.meta.url));
    if (!existsSync(datesModule)) return;
    const figures = readFileSync(fileURLToPath(new URL("./Figures.tsx", import.meta.url)), "utf8");
    expect(
      figures,
      "Ya existe src/lib/pasarelas/dates.ts: DateText debe llamar a formatDate(value) y DateTimeText a formatDateTime(value); quita la prop `formatted` y actualiza esta prueba y la galería.",
    ).toMatch(/import \{[^}]*\bformatDate\b[^}]*\bformatDateTime\b[^}]*\} from "@\/lib\/pasarelas\/dates"/);
  });
});
