import { describe, expect, test } from "vitest";
import { hasLongDigitRun, isHttpUrl, looksLikeCardNumber } from "./guards";

// Números de PRUEBA públicos o inventados (pasan Luhn; no son de ninguna tarjeta real).
describe("looksLikeCardNumber", () => {
  test.each([
    "4111111111111111",
    "4111 1111 1111 1111",
    "4111-1111-1111-1111",
    "4111 1111-1111 1111",
    "4000000000006", // 13 dígitos
    "4000000000000000006", // 19 dígitos
    "5555 5555 5555 4444", // dígitos altos: al duplicarlos pasan de 9
    "9999999999999995",
    "pagó con la 4111 1111 1111 1111, vence pronto",
    "ref. 99; tarjeta: 4111111111111111.",
    "A4111111111111111B",
  ])("parece una tarjeta: «%s»", (text) => {
    expect(looksLikeCardNumber(text)).toBe(true);
  });

  test.each([
    "",
    "sin números",
    "4111111111111112", // 16 dígitos, no pasa Luhn
    "4111 1111 1111 1112",
    "5555 5555 5555 4445",
    "9999999999999999",
    "400000000002", // pasa Luhn pero son 12 dígitos
    "40000000000000000002", // pasa Luhn pero son 20 dígitos
    "ch_3PabcXYZ 2026-11-09",
    "pedido 1234",
    "4111 1111 y luego 1111 1111", // dos tramos separados por texto
    "4111/1111/1111/1111", // otro separador: son cuatro tramos cortos
  ])("no parece una tarjeta: «%s»", (text) => {
    expect(looksLikeCardNumber(text)).toBe(false);
  });

  test("basta un tramo que lo parezca, aunque haya otros números", () => {
    expect(looksLikeCardNumber("pedido 1234, cobro del 2026-11-09, tarjeta 4000000000006")).toBe(true);
    expect(looksLikeCardNumber("4111111111111112 y 4111111111111111")).toBe(true);
  });
});

describe("hasLongDigitRun", () => {
  test("por defecto, siete o más dígitos seguidos", () => {
    expect(hasLongDigitRun("cuenta 1234567")).toBe(true);
    expect(hasLongDigitRun("12345678")).toBe(true);
    expect(hasLongDigitRun("x1234567x")).toBe(true);
  });

  test("seis dígitos, o más pero separados, no cuentan", () => {
    expect(hasLongDigitRun("cuenta 123456")).toBe(false);
    expect(hasLongDigitRun("123 4567")).toBe(false);
    expect(hasLongDigitRun("1234-5678")).toBe(false);
    expect(hasLongDigitRun("Banco Demo ··· 4321")).toBe(false);
    expect(hasLongDigitRun("")).toBe(false);
  });

  test("el mínimo se puede cambiar", () => {
    expect(hasLongDigitRun("1234", 4)).toBe(true);
    expect(hasLongDigitRun("123", 4)).toBe(false);
    expect(hasLongDigitRun("1234567", 8)).toBe(false);
  });
});

describe("isHttpUrl", () => {
  test.each([
    "https://example.com",
    "http://example.com",
    "https://example.com/panel?cuenta=1#pagos",
    "HTTPS://EXAMPLE.COM",
    "http://localhost:3000/pago",
  ])("vale: %s", (text) => {
    expect(isHttpUrl(text)).toBe(true);
  });

  test.each([
    "",
    "example.com",
    "www.example.com",
    "ftp://example.com",
    "javascript:alert(1)",
    "data:text/html,hola",
    "mailto:alguien@example.com",
    "//example.com",
    " https://example.com",
    "https://",
    "https://exa mple.com",
    "http:/example.com",
    "texto https://example.com",
  ])("no vale: «%s»", (text) => {
    expect(isHttpUrl(text)).toBe(false);
  });
});
