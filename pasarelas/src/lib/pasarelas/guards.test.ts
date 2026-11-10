import { describe, expect, test } from "vitest";
import { hasLongDigitRun, isHttpUrl, looksLikeCardNumber } from "./guards";

/** Generador determinista (mulberry32): la misma semilla da siempre los mismos casos. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Luhn escrito aparte y de otra manera, para no comprobar el código con el mismo código. */
function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let fromRight = 0; fromRight < digits.length; fromRight++) {
    const digit = Number(digits[digits.length - 1 - fromRight]);
    sum += fromRight % 2 === 0 ? digit : Math.floor((digit * 2) / 10) + ((digit * 2) % 10);
  }
  return sum % 10 === 0;
}

const digitsOf = (text: string) => text.replace(/\D/g, "");

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
    "4111 1111 1111 1111 2027", // un vecino de 4 cifras detrás: el año
    "4111-1111-1111-1111 2026-11-09",
    "1234 4111 1111 1111 1111", // o delante: un pedido
    "pedido 100245 4111 1111 1111 1111",
    "4111 1111 1111 1111 123 10001 2027", // un vecino corto corta la cuenta de vecinos largos
    "20261109 4111 1111 1111 1111 20261109", // un número de 7 cifras o más no es un grupo de tarjeta: no cuenta
    "20261109 4111111111111111 20261109", // escrita de corrido, da igual lo que lleve al lado
    "1234 5678 4111111111111111 1234 5678",
    "4111111111111111 5555555555554444",
    "4111 1111 1111 1111, 5555 5555 5555 4444",
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

  // La lectura literal: 13–19 dígitos con un espacio o un guion entre dígito y dígito, se agrupen como se agrupen.
  test("el tramo entero cuenta con cualquier agrupado, hasta los 19 dígitos", () => {
    expect(looksLikeCardNumber("4 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1")).toBe(true);
    expect(looksLikeCardNumber("41 11 11 11 11 11 11 11")).toBe(true);
    expect(looksLikeCardNumber("41111111 11111111")).toBe(true);
    // Inventado para que solo pasen Luhn los 19 dígitos juntos: ningún trozo de 13 a 18.
    expect(looksLikeCardNumber("4174179866154434292")).toBe(true);
    expect(looksLikeCardNumber("4 1 7 4 1 7 9 8 6 6 1 5 4 4 3 4 2 9 2")).toBe(true);
    expect(looksLikeCardNumber("4174 1798 6615 4434 292")).toBe(true); // 4-4-4-4-3
    expect(looksLikeCardNumber("417417-9866154434292")).toBe(true); // 6-13
  });

  // El precio de no probar todas las ventanas de grupos (ver el comentario de la función): esto se deja pasar.
  test.each([
    ["dígito a dígito y con otro número al lado", "7 4 1 7 4 1 7 9 8 6 6 1 5 4 4 3 4 2 9 2 3"],
    ["en grupos de 8 y con otro número al lado", "41111111 11111111 123"],
    ["4-4-4-4-3 con otro número al lado", "4174 1798 6615 4434 292 123"],
    ["4-4-4-4-3 con dos espacios", "4174  1798  6615  4434  292"],
    ["dos vecinos de 4 cifras al mismo lado", "4111 1111 1111 1111 1234 2027"],
    ["un vecino de 4 cifras a cada lado", "1234 4111 1111 1111 1111 2027"],
    ["en grupos y con otra detrás, sin más que un espacio entre las dos", "4111 1111 1111 1111 5555 5555 5555 4444"],
  ])("no se detecta una tarjeta %s", (_case, text) => {
    expect(looksLikeCardNumber(text)).toBe(false);
  });

  // Los grupos se prueban enteros: no se busca una tarjeta a medio grupo ni se pasa de 19 dígitos.
  test.each([
    "4111 1111 1111 1112 123", // 16 dígitos que no pasan Luhn, con o sin el vecino
    "4111111111111112 123",
    "12 4111 1111 1111 1112",
    "4111 1111 1111 1112 2027",
    "4111111111111111123", // tarjeta y CVV sin separar: es un solo número de 19 que no pasa
    "40000000000000000002 1", // 20 dígitos seguidos
    "4000 0000 0000 0000 0002", // 20 dígitos en grupos: pasan Luhn juntos, pero no sin el primero ni sin el último
    "400000000002 1", // 12 dígitos que pasan Luhn; con el vecino ya no
    "4000 0000 0002",
    "factura 1001 1002 1003", // 12 dígitos
  ])("no parece una tarjeta: «%s»", (text) => {
    expect(looksLikeCardNumber(text)).toBe(false);
  });

  test("el punto no se mezcla con espacios ni guiones: un número con decimales no son dos grupos", () => {
    // 16 dígitos que pasan Luhn, pero son dos números con cuatro decimales. El precio: una tarjeta escrita mitad con
    // puntos y mitad con espacios tampoco se detecta.
    expect(looksLikeCardNumber("4111.1111 1111.1111")).toBe(false);
    expect(looksLikeCardNumber("4111 1111.1111 1111")).toBe(false);
    expect(looksLikeCardNumber("1.234.567,89 2.345.678,90")).toBe(false);
  });
});

// Textos corrientes, sin ninguna tarjeta, con varios números seguidos. No se prueban con dígitos elegidos para que
// salga bien: cada forma se genera 2 000 veces y se comprueba la regla, no el ejemplo.
describe("looksLikeCardNumber · textos corrientes con varios números", () => {
  const CASES = 2000;
  const rnd = mulberry32(20261110);
  const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  const several = (count: number, make: () => string, separator = " ") =>
    Array.from({ length: count }, make).join(separator);

  const phone = () => `${int(200, 999)}-555-${pad(int(0, 9999), 4)}`;
  const isoDate = () => `${int(2020, 2029)}-${pad(int(1, 12), 2)}-${pad(int(1, 28), 2)}`;
  const dottedDate = () => `${pad(int(1, 28), 2)}.${pad(int(1, 12), 2)}.${int(2020, 2029)}`;
  const amount = (digits: number) => String(int(10 ** (digits - 1), 10 ** digits - 1));
  const withCents = () => `${int(10, 99999)}.${pad(int(0, 99), 2)}`;
  const reference = () => `${amount(7)}${pad(int(0, 9999999), 7)}`; // 14 cifras

  // Aquí no hay ni 13–19 dígitos en un tramo simple, ni un número de 13–19 cifras de corrido, ni grupos de 4 a 6
  // cifras que sumen 13–19 con un vecino como mucho: no se marcan nunca, salgan los dígitos que salgan.
  test.each<[string, () => string]>([
    ["dos teléfonos", () => `tel. ${phone()} ${phone()}`],
    ["tres teléfonos", () => several(3, phone)],
    ["tres fechas", () => several(3, isoDate)],
    ["dos fechas con « - »", () => `${isoDate()} - ${isoDate()}`],
    ["dos fechas con raya", () => `${isoDate()}–${isoDate()}`],
    ["dos fechas con dos espacios", () => `${isoDate()}  ${isoDate()}`],
    ["dos fechas con «al»", () => `del ${isoDate()} al ${isoDate()}`],
    ["dos fechas con puntos", () => `${dottedDate()} ${dottedDate()}`],
    ["teléfono, fecha y monto", () => `${phone()} ${isoDate()} ${amount(4)}`],
    ["seis montos de 4 cifras", () => `cuotas ${several(6, () => amount(4))}`],
    ["ocho montos de 4 cifras", () => several(8, () => amount(4))],
    ["seis montos de 4 cifras con « - »", () => several(6, () => amount(4), " - ")],
    ["seis montos de 5 cifras", () => several(6, () => amount(5))],
    ["cuatro montos con centavos", () => `pagos: ${several(4, withCents)}`],
    ["ocho montos con centavos", () => several(8, withCents)],
    ["dos números de 8 cifras y un monto", () => `${amount(8)} ${amount(8)} ${amount(4)}`],
  ])("nunca se marcan: %s", (_form, make) => {
    const texts = Array.from({ length: CASES }, make);
    expect(texts.filter(looksLikeCardNumber)).toEqual([]);
  });

  // Estas formas sí son 13–19 dígitos seguidos, un número largo de corrido o grupos de 4 a 6 cifras como los de una
  // tarjeta: no se distinguen de una más que por Luhn, y lo pasan una de cada diez veces. Es el precio de la regla;
  // se marcan esas y solo esas (la función de la derecha dice cuáles, y el número, qué parte del total son).
  const firstFourOrLastFour = (d: string) => luhnOk(d.slice(0, 16)) || luhnOk(d.slice(4));
  const allOrTheThreeInTheMiddle = (d: string) => luhnOk(d) || luhnOk(d.slice(2, 17));
  test.each<[string, () => string, (digits: string) => boolean, number]>([
    ["dos fechas con un espacio", () => `${isoDate()} ${isoDate()}`, luhnOk, 0.1],
    ["teléfono y fecha", () => `${phone()} ${isoDate()}`, luhnOk, 0.1],
    ["seis montos de 3 cifras", () => several(6, () => amount(3)), luhnOk, 0.1],
    ["cuatro montos de 4 cifras", () => several(4, () => amount(4)), luhnOk, 0.1],
    ["cuatro montos de 4 cifras con « - »", () => several(4, () => amount(4), " - "), luhnOk, 0.1],
    ["una referencia de 14 cifras y una fecha", () => `ref ${reference()} ${isoDate()}`, (d) => luhnOk(d.slice(0, 14)), 0.1],
    // Cinco: los cuatro primeros o los cuatro últimos, como una tarjeta con un pedido delante o el año detrás.
    ["cinco montos de 4 cifras", () => several(5, () => amount(4)), firstFourOrLastFour, 0.19],
    // Los 19 dígitos del tramo entero, o los tres grupos de 5 con sus dos vecinos cortos.
    [
      "tres montos de 5 cifras entre dos de 2",
      () => `${amount(2)} ${several(3, () => amount(5))} ${amount(2)}`,
      allOrTheThreeInTheMiddle,
      0.19,
    ],
  ])("solo se marcan si pasan Luhn: %s", (_form, make, passes, share) => {
    const texts = Array.from({ length: CASES }, make);
    const flagged = texts.filter(looksLikeCardNumber);
    expect(flagged).toEqual(texts.filter((text) => passes(digitsOf(text))));
    expect(flagged.length / CASES).toBeCloseTo(share, 1);
  });

  // La primera versión solo miraba el tramo entero (un espacio o un guion entre dígito y dígito). Lo que marcaba se
  // sigue marcando.
  test("todo lo que parecía una tarjeta por el tramo entero lo sigue pareciendo", () => {
    const texts = Array.from({ length: CASES }, () =>
      several(int(1, 6), () => amount(int(1, 8)), rnd() < 0.5 ? " " : "-"),
    );
    const wholeRun = texts.filter((text) => {
      const digits = digitsOf(text);
      return digits.length >= 13 && digits.length <= 19 && luhnOk(digits);
    });
    expect(wholeRun.length).toBeGreaterThan(20);
    expect(wholeRun.filter((text) => !looksLikeCardNumber(text))).toEqual([]);
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
