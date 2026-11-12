import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  zAlias,
  zCurrency,
  zDate,
  zFeesPaidBy,
  zHttpUrl,
  zId,
  zMoney,
  zOptionalText,
  zPct,
  zPositiveMoney,
  zReference,
  zText,
} from "./zod";

/** El mensaje del primer problema de una entrada rechazada (falla si la entrada pasó). */
function messageOf(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error(`Se esperaba un rechazo y pasó: ${JSON.stringify(result.data)}`);
  return result.error.issues[0]?.message ?? "";
}

const CARD_TEXT = "Parece un número de tarjeta. No lo guardes aquí: si son fechas o montos, sepáralos con texto";

describe("zId", () => {
  test("acepta un uuid y lo deja en minúsculas, que es como lo devuelve la base", () => {
    expect(zId.parse("3F2B8C1E-9D4A-4E7B-8A6F-0C1D2E3F4A5B")).toBe("3f2b8c1e-9d4a-4e7b-8a6f-0c1d2e3f4a5b");
    // Postgres admite cualquier uuid bien formado, no solo los de la versión 4.
    expect(zId.parse("11111111-1111-1111-1111-111111111111")).toBe("11111111-1111-1111-1111-111111111111");
  });

  test("rechaza lo que no es un uuid", () => {
    for (const input of ["", "abc", "3f2b8c1e-9d4a-4e7b-8a6f", "3f2b8c1e9d4a4e7b8a6f0c1d2e3f4a5b ' or 1=1", 7, null]) {
      expect(messageOf(zId, input)).toBe("Identificador no válido");
    }
  });
});

describe("zMoney", () => {
  test("lee lo que escribe una persona y devuelve el monto canónico", () => {
    expect(zMoney.parse("100")).toBe("100.00");
    expect(zMoney.parse(" $1.234,56 ")).toBe("1234.56");
    expect(zMoney.parse("1,234.56")).toBe("1234.56");
    expect(zMoney.parse("100,5")).toBe("100.50");
    expect(zMoney.parse("-3,20")).toBe("-3.20");
    expect(zMoney.parse("0")).toBe("0.00");
  });

  test("lo que no es un monto: «Monto no válido»", () => {
    for (const input of ["", "abc", "1,2,3", "10.9999", "1e3", 100, null, undefined]) {
      expect(messageOf(zMoney, input)).toBe("Monto no válido");
    }
  });

  test("no cabe en la base (numeric(14,2)): también es un monto no válido", () => {
    expect(zMoney.parse("999999999999.99")).toBe("999999999999.99");
    expect(messageOf(zMoney, "1000000000000")).toBe("Monto no válido");
    expect(messageOf(zMoney, "-1000000000000.00")).toBe("Monto no válido");
  });
});

describe("zPositiveMoney", () => {
  test("solo montos mayores que cero", () => {
    expect(zPositiveMoney.parse("0,01")).toBe("0.01");
    expect(messageOf(zPositiveMoney, "0")).toBe("El monto tiene que ser mayor que cero");
    expect(messageOf(zPositiveMoney, "-5")).toBe("El monto tiene que ser mayor que cero");
    expect(messageOf(zPositiveMoney, "cinco")).toBe("Monto no válido");
  });
});

describe("zPct", () => {
  test("lee un porcentaje con coma o punto y lo normaliza", () => {
    expect(zPct.parse("2,9")).toBe("2.9");
    expect(zPct.parse("2.90 %")).toBe("2.9");
    expect(zPct.parse("100")).toBe("100");
    expect(zPct.parse("0")).toBe("0");
  });

  test("fuera de 0–100 o mal escrito: «Porcentaje no válido»", () => {
    for (const input of ["", "101", "-1", "2.12345", "dos", 2.9, null]) {
      expect(messageOf(zPct, input)).toBe("Porcentaje no válido");
    }
  });
});

describe("zDate", () => {
  test("una fecha de calendario que existe", () => {
    expect(zDate.parse("2026-11-13")).toBe("2026-11-13");
    expect(zDate.parse("2028-02-29")).toBe("2028-02-29");
  });

  test("mal formada o que no existe: «Fecha no válida»", () => {
    for (const input of ["", "13/11/2026", "2026-02-30", "2026-11-13T10:00", "2026-1-3", null, 20261113]) {
      expect(messageOf(zDate, input)).toBe("Fecha no válida");
    }
  });
});

describe("zCurrency", () => {
  test("tres letras, a mayúsculas", () => {
    expect(zCurrency.parse("usd")).toBe("USD");
    expect(zCurrency.parse(" Eur ")).toBe("EUR");
  });

  test("otra cosa no es una moneda", () => {
    for (const input of ["", "US", "USDT", "U$D", "123", null]) {
      expect(messageOf(zCurrency, input)).toBe("Moneda no válida: son tres letras, como USD");
    }
  });
});

describe("zHttpUrl", () => {
  test("vacío es «sin link»", () => {
    expect(zHttpUrl.parse("")).toBeNull();
    expect(zHttpUrl.parse("   ")).toBeNull();
    expect(zHttpUrl.parse(null)).toBeNull();
    expect(zHttpUrl.parse(undefined)).toBeNull();
  });

  test("un link http(s), recortado", () => {
    expect(zHttpUrl.parse(" https://dashboard.example.com/pagos?x=1 ")).toBe("https://dashboard.example.com/pagos?x=1");
    expect(zHttpUrl.parse("http://example.com")).toBe("http://example.com");
  });

  test("otros esquemas, links rotos o con espacios (la base tampoco los admite): no", () => {
    const text = "El link tiene que empezar por http:// o https:// y no llevar espacios";
    for (const input of [
      "javascript:alert(1)",
      "ftp://example.com",
      "example.com",
      "https://",
      "https://a.example/con espacio",
    ]) {
      expect(messageOf(zHttpUrl, input)).toBe(text);
    }
  });

  test("más de 300 caracteres no caben", () => {
    expect(messageOf(zHttpUrl, `https://example.com/${"a".repeat(300)}`)).toBe("Máximo 300 caracteres");
  });
});

describe("zText", () => {
  test("recorta los extremos", () => {
    expect(zText(80).parse("  Escuela Demo  ")).toBe("Escuela Demo");
  });

  test("vacío o solo espacios: es obligatorio", () => {
    expect(messageOf(zText(80), "")).toBe("Este campo es obligatorio");
    expect(messageOf(zText(80), "   ")).toBe("Este campo es obligatorio");
    expect(messageOf(zText(80), null)).toBe("Este campo es obligatorio");
    expect(messageOf(zText(80), undefined)).toBe("Este campo es obligatorio");
  });

  test("el máximo se mide ya recortado", () => {
    expect(zText(5).parse(" abcde ")).toBe("abcde");
    expect(messageOf(zText(5), "abcdef")).toBe("Máximo 5 caracteres");
  });

  test("rechaza lo que parece un número de tarjeta, y dice por qué y cómo seguir", () => {
    expect(messageOf(zText(280), "Pagó con la 4111 1111 1111 1111")).toBe(CARD_TEXT);
    expect(messageOf(zText(280), "4111111111111111")).toBe(CARD_TEXT);
    // Dígitos largos que no son una tarjeta (no pasan Luhn) sí se guardan.
    expect(zText(280).parse("Pedido 4111111111111112")).toBe("Pedido 4111111111111112");
  });
});

describe("zOptionalText", () => {
  test("vacío es «nada»", () => {
    expect(zOptionalText(80).parse("")).toBeNull();
    expect(zOptionalText(80).parse("   ")).toBeNull();
    expect(zOptionalText(80).parse(null)).toBeNull();
    expect(zOptionalText(80).parse(undefined)).toBeNull();
  });

  test("con texto: recortado, con máximo y con la guarda de tarjeta", () => {
    expect(zOptionalText(80).parse("  Pagó en dos partes ")).toBe("Pagó en dos partes");
    expect(messageOf(zOptionalText(5), "abcdef")).toBe("Máximo 5 caracteres");
    expect(messageOf(zOptionalText(280), "tarjeta 4111-1111-1111-1111")).toBe(CARD_TEXT);
  });

  test("lo que no es texto no pasa", () => {
    expect(messageOf(zOptionalText(80), 5)).toBe("Texto no válido");
  });
});

describe("zAlias", () => {
  test("un alias corriente", () => {
    expect(zAlias(80).parse(" Cuenta principal 4321 ")).toBe("Cuenta principal 4321");
  });

  test("7 o más dígitos seguidos parecen un número de cuenta", () => {
    const text = "No escribas números de cuenta: un alias no lleva 7 o más dígitos seguidos";
    expect(messageOf(zAlias(80), "Cuenta 1234567")).toBe(text);
    expect(zAlias(80).parse("Cuenta 123456")).toBe("Cuenta 123456");
    // Separados no son un número de cuenta para la base, y aquí tampoco.
    expect(zAlias(80).parse("Cuenta 1234 567")).toBe("Cuenta 1234 567");
  });

  test("conserva las reglas de zText: obligatorio, máximo y tarjeta", () => {
    expect(messageOf(zAlias(80), " ")).toBe("Este campo es obligatorio");
    expect(messageOf(zAlias(5), "abcdef")).toBe("Máximo 5 caracteres");
    expect(messageOf(zAlias(80), "4111 1111 1111 1111")).toBe(CARD_TEXT);
  });
});

describe("zReference", () => {
  test("recorta; vacío es «sin referencia»", () => {
    expect(zReference.parse("  ch_demo_0001 ")).toBe("ch_demo_0001");
    expect(zReference.parse("   ")).toBeNull();
    expect(zReference.parse("")).toBeNull();
    expect(zReference.parse(null)).toBeNull();
    expect(zReference.parse(undefined)).toBeNull();
  });

  test("hasta 120 caracteres", () => {
    expect(zReference.parse("r".repeat(120))).toHaveLength(120);
    expect(messageOf(zReference, "r".repeat(121))).toBe("Máximo 120 caracteres");
  });

  test("NO lleva la guarda de tarjeta: los identificadores largos de una pasarela son normales", () => {
    expect(zReference.parse("4111111111111111")).toBe("4111111111111111");
    expect(zReference.parse("4111 1111 1111 1111")).toBe("4111 1111 1111 1111");
  });
});

describe("zFeesPaidBy", () => {
  test("«nosotros» o «comprador»; otra cosa no, y lo dice", () => {
    expect(zFeesPaidBy.parse("nosotros")).toBe("nosotros");
    expect(zFeesPaidBy.parse("comprador")).toBe("comprador");
    expect(messageOf(zFeesPaidBy, "cliente")).toBe("Elige quién pagó la comisión");
    expect(messageOf(zFeesPaidBy, undefined)).toBe("Elige quién pagó la comisión");
  });
});

describe("mensajes en español", () => {
  test("un esquema sin mensaje propio también habla en español", () => {
    expect(messageOf(z.object({ nombre: z.string() }), {})).toMatch(/inválida|se esperaba/i);
  });
});
