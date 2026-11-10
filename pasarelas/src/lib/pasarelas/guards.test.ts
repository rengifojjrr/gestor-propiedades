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
    "4111,1111,1111,1111",
    "4111\n1111\n1111\n1111", // el salto de línea no une grupos
  ])("no parece una tarjeta: «%s»", (text) => {
    expect(looksLikeCardNumber(text)).toBe(false);
  });

  test("basta un tramo que lo parezca, aunque haya otros números", () => {
    expect(looksLikeCardNumber("pedido 1234, cobro del 2026-11-09, tarjeta 4000000000006")).toBe(true);
    expect(looksLikeCardNumber("4111111111111112 y 4111111111111111")).toBe(true);
  });

  // Así se apuntan de verdad los datos de una tarjeta: con el CVV, el vencimiento u otro número al lado.
  test.each([
    "4111 1111 1111 1111 123", // + CVV
    "4111-1111-1111-1111 123",
    "4111111111111111 123",
    "4111 1111 1111 1111 12/27", // + vencimiento
    "4111 1111 1111 1111 12-27",
    "4111111111111111 2026-11-09", // + fecha
    "12 4111 1111 1111 1111", // un número delante
    "pedido 7 4111-1111-1111-1111",
    "12 4111 1111 1111 1111 123", // delante y detrás
    "1 2 3 4 5 6 4111 1111 1111 1111",
    "5555 5555 5555 4444 321",
    "3782 822463 10005 1234", // 15 dígitos en 4-6-5 y un código de 4
    "4000000000006 99", // 13 dígitos y algo más
    "4000000000000000006 123", // 19 dígitos y algo más
    "4111.1111.1111.1111 123",
    "12.4111.1111.1111.1111",
  ])("parece una tarjeta aunque lleve otro número pegado: «%s»", (text) => {
    expect(looksLikeCardNumber(text)).toBe(true);
  });

  test.each([
    ["dos espacios", "4111  1111  1111  1111"],
    ["tabulador", "4111\t1111\t1111\t1111"],
    ["espacio duro", "4111 1111 1111 1111"],
    ["espacio duro estrecho", "4111 1111 1111 1111"],
    ["punto", "4111.1111.1111.1111"],
    ["guion entre espacios", "4111 - 1111 - 1111 - 1111"],
    ["dos guiones", "4111--1111--1111--1111"],
    ["raya corta", "4111–1111–1111–1111"],
    ["de todo un poco", "4111 \t1111 - 1111  1111"],
  ])("parece una tarjeta con los grupos separados por %s", (_separator, text) => {
    expect(looksLikeCardNumber(text)).toBe(true);
  });

  test("un dígito por grupo también cuenta, hasta los 19", () => {
    expect(looksLikeCardNumber("4 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1")).toBe(true);
    // Inventado para que solo pasen Luhn los 19 dígitos juntos: ningún trozo de 13 a 18, ni con el 7 o el 3.
    expect(looksLikeCardNumber("4174179866154434292")).toBe(true);
    expect(looksLikeCardNumber("4 1 7 4 1 7 9 8 6 6 1 5 4 4 3 4 2 9 2")).toBe(true);
    expect(looksLikeCardNumber("7 4 1 7 4 1 7 9 8 6 6 1 5 4 4 3 4 2 9 2 3")).toBe(true);
  });

  // Los grupos se prueban enteros: no se busca una tarjeta a medio grupo ni se pasa de 19 dígitos.
  test.each([
    "4111 1111 1111 1112 123", // 16 dígitos que no pasan Luhn, con o sin el vecino
    "4111111111111112 123",
    "12 4111 1111 1111 1112",
    "4111111111111111123", // tarjeta y CVV sin separar: es un solo número de 19 que no pasa
    "40000000000000000002 1", // 20 dígitos seguidos
    "4000 0000 0000 0000 0002", // 20 dígitos en grupos: pasan Luhn juntos, pero ninguna ventana de 13–19
    "400000000002 1", // 12 dígitos que pasan Luhn; con el vecino ya no
    "4000 0000 0002",
    "del 2026-11-03 al 2026-11-28",
    "tel. 212-555-0100 212-555-0101",
    "cuotas 100 200 300 1500 250",
    "factura 1001 1002 1003",
    "09.11.2026 10.11.2026",
  ])("no parece una tarjeta: «%s»", (text) => {
    expect(looksLikeCardNumber(text)).toBe(false);
  });

  test("el punto no se mezcla con espacios ni guiones: una lista de montos no es una tarjeta", () => {
    // Mezclándolos, «100 00 200 00 300 00 150» serían 17 dígitos seguidos que pasan Luhn.
    expect(looksLikeCardNumber("pagos: 100.00 200.00 300.00 150.00")).toBe(false);
    expect(looksLikeCardNumber("pagos: 917.42 136.58 407.67 772.43")).toBe(false);
    expect(looksLikeCardNumber("1.234.567,89 2.345.678,90")).toBe(false);
    // El precio: una tarjeta escrita mitad con puntos y mitad con espacios no se detecta.
    expect(looksLikeCardNumber("4111.1111 1111.1111")).toBe(false);
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
