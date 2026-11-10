import { describe, expect, test } from "vitest";
import type { ImportFormat } from "./detect";
import { mapRows, parseImportAmount, validateMapping } from "./mapping";
import { presetFor, type ColumnMapping } from "./presets";

/** Un mapeo mínimo sobre columnas de nombre corto; cada prueba cambia solo lo que mira. */
const BASE: ColumnMapping = {
  reference: "ref",
  date: "fecha",
  time: null,
  timezone: null,
  gross: "monto",
  currency: null,
  fee: null,
  status: null,
  type: null,
  note: null,
  fixedZone: "UTC",
  decimal: ".",
  dateFormat: "YYYY-MM-DD",
  defaultCurrency: "USD",
};

/** Una fila válida con lo que se le cambie. */
const fila = (cambios: Record<string, string> = {}): Record<string, string> => ({
  ref: "ref_demo_1",
  fecha: "2026-11-13 10:30:00",
  monto: "10.00",
  ...cambios,
});

/** Convierte una sola fila y devuelve lo que salió de ella (la única que hay en una de las tres listas). */
function una(cambios: Record<string, string>, mapeo: Partial<ColumnMapping> = {}, formato: ImportFormat = "otro") {
  return mapRows([fila(cambios)], { ...BASE, ...mapeo }, formato);
}

const okDe = (cambios: Record<string, string>, mapeo: Partial<ColumnMapping> = {}, formato: ImportFormat = "otro") => {
  const r = una(cambios, mapeo, formato);
  expect(r.errors).toEqual([]);
  expect(r.skipped).toEqual([]);
  expect(r.ok).toHaveLength(1);
  return r.ok[0]!;
};
const errorDe = (cambios: Record<string, string>, mapeo: Partial<ColumnMapping> = {}, formato: ImportFormat = "otro") => {
  const r = una(cambios, mapeo, formato);
  expect(r.ok).toEqual([]);
  expect(r.errors).toHaveLength(1);
  return r.errors[0]!.reason;
};
const omitidaPor = (cambios: Record<string, string>, mapeo: Partial<ColumnMapping> = {}, formato: ImportFormat = "otro") => {
  const r = una(cambios, mapeo, formato);
  expect(r.ok).toEqual([]);
  expect(r.errors).toEqual([]);
  expect(r.skipped).toHaveLength(1);
  return r.skipped[0]!.reason;
};

describe("parseImportAmount: con el separador decimal del mapeo, sin adivinar", () => {
  test.each([
    ["1,234.56", "1234.56"],
    ["1234.56", "1234.56"],
    ["1,234,567.89", "1234567.89"],
    ["0.5", "0.50"],
    ["100", "100.00"],
    ["$1,234.56", "1234.56"],
    ["  $ 12.30  ", "12.30"],
    ["€5.00", "5.00"],
    ["5.00 €", "5.00"],
    ["-3.20", "-3.20"],
    ["-$3.20", "-3.20"],
    ["$-3.20", "-3.20"],
    ["+3.20", "3.20"],
    ["(3.20)", "-3.20"],
    ["($1,234.56)", "-1234.56"],
    ["1,234", "1234.00"],
    ["999999999999.99", "999999999999.99"],
    ["-0.00", "0.00"],
  ])("punto decimal: «%s» → %s", (texto, monto) => {
    expect(parseImportAmount(texto, ".")).toBe(monto);
  });

  test.each([
    ["1.234,56", "1234.56"],
    ["1.234.567,89", "1234567.89"],
    ["100,5", "100.50"],
    ["-1,50", "-1.50"],
    ["(1,50)", "-1.50"],
    ["1.234", "1234.00"],
    ["€ 1.234,56", "1234.56"],
  ])("coma decimal: «%s» → %s", (texto, monto) => {
    expect(parseImportAmount(texto, ",")).toBe(monto);
  });

  test.each([
    "",
    "   ",
    "abc",
    "$",
    "-",
    "()",
    "1.234,56",
    "12,34,5",
    "1,23.00",
    "0,123.00",
    "1.234",
    "1.2.3",
    "12.",
    ".5",
    "1 234.56",
    "--3",
    "-(3.20)",
    "(3.20",
    "3.20-",
    "1e3",
    "Infinity",
    "12.30 USD",
    "$$12.30",
    "1234567890123.00",
  ])("punto decimal: «%s» no es un monto", (texto) => {
    expect(parseImportAmount(texto, ".")).toBeNull();
  });

  test.each(["1,234.56", "1.234,567", "1.23,00", "100.5"])("coma decimal: «%s» no es un monto", (texto) => {
    expect(parseImportAmount(texto, ",")).toBeNull();
  });
});

describe("validateMapping", () => {
  const ENCABEZADOS = ["ref", "fecha", "monto", "Descripción", "Customer Email", "customer_name", "Address Line 1"];

  test("un mapeo que cuadra con el archivo no tiene problemas", () => {
    expect(validateMapping(ENCABEZADOS, BASE)).toEqual([]);
    expect(validateMapping(ENCABEZADOS, { ...BASE, note: "Descripción" })).toEqual([]);
  });

  test("las columnas se buscan sin distinguir mayúsculas, espacios alrededor ni la marca BOM", () => {
    expect(validateMapping(["﻿REF", " Fecha ", "MONTO"], { ...BASE, reference: " ref", gross: "Monto " })).toEqual([]);
  });

  test("faltan las obligatorias o no están en el archivo", () => {
    expect(validateMapping(ENCABEZADOS, { ...BASE, reference: "", date: "  ", gross: "Importe" })).toEqual([
      "Falta elegir la columna de referencia.",
      "Falta elegir la columna de fecha.",
      "No está en el archivo la columna «Importe» (monto).",
    ]);
  });

  test("las opcionales, si se eligen, tienen que estar en el archivo; vacías o null es no usarlas", () => {
    expect(
      validateMapping(ENCABEZADOS, {
        ...BASE,
        time: "hora",
        timezone: "zona",
        currency: "moneda",
        fee: "comision",
        status: "estado",
        type: "tipo",
        note: "nota",
      }),
    ).toEqual([
      "No está en el archivo la columna «hora» (hora).",
      "No está en el archivo la columna «zona» (zona horaria).",
      "No está en el archivo la columna «moneda» (moneda).",
      "No está en el archivo la columna «comision» (comisión).",
      "No está en el archivo la columna «estado» (estado).",
      "No está en el archivo la columna «tipo» (tipo).",
      "No está en el archivo la columna «nota» (nota).",
    ]);
    expect(validateMapping(ENCABEZADOS, { ...BASE, time: "", fee: undefined, note: null })).toEqual([]);
  });

  test.each([
    "Customer Email",
    "customer_name",
    "Address Line 1",
    "From Email Address",
    "Name",
    "Payer Name",
    "Correo cliente",
    "Nombre",
    "Dirección",
    "E-mail",
    "Contact Phone Number",
    "Customer Description",
    // La dirección por partes: PayPal las trae marcadas por defecto en la descarga de actividad.
    "Town/City",
    "Zip/Postal Code",
    "State / Province / Region / Territory / Prefecture / Republic",
    "Country",
    "customer_shipping_address_city",
    "Shipping State",
    "Ciudad",
    "Código postal",
    "Provincia",
    "País",
    "Localidad",
  ])("la nota y la referencia no pueden salir de «%s» (datos del comprador)", (columna) => {
    const encabezados = [...ENCABEZADOS, columna];
    const motivo = (campo: string) =>
      `La columna «${columna}» tiene datos del comprador (correo, nombre o dirección): no se puede usar como ${campo}.`;
    expect(validateMapping(encabezados, { ...BASE, note: columna })).toEqual([motivo("nota")]);
    expect(validateMapping(encabezados, { ...BASE, reference: columna })).toEqual([motivo("referencia")]);
  });

  test.each(["Statement Descriptor", "Status", "Estado", "Descripción", "Item Title", "Subject"])(
    "«%s» no es una columna del comprador: sirve como nota",
    (columna) => {
      expect(validateMapping([...ENCABEZADOS, columna], { ...BASE, note: columna })).toEqual([]);
    },
  );

  test("zona fija, moneda por defecto, separador y formato de fecha inválidos (pueden venir mal de la base)", () => {
    const malo = {
      ...BASE,
      fixedZone: "Hora de Marte",
      defaultCurrency: "us",
      decimal: ";",
      dateFormat: "YY/MM/DD",
    } as unknown as ColumnMapping;
    expect(validateMapping(ENCABEZADOS, malo)).toEqual([
      "Zona horaria fija desconocida: «Hora de Marte».",
      "Moneda por defecto inválida: «us» (se esperan 3 letras, como USD).",
      "Separador decimal inválido: «;» (punto o coma).",
      "Formato de fecha inválido: «YY/MM/DD».",
    ]);
  });

  test("la zona fija puede ser UTC, un nombre IANA o una abreviatura de EE. UU.", () => {
    for (const fixedZone of ["UTC", "GMT", "America/Los_Angeles", "Europe/Madrid", "PDT"]) {
      expect(validateMapping(ENCABEZADOS, { ...BASE, fixedZone })).toEqual([]);
    }
  });
});

describe("mapRows: lo general", () => {
  test("un mapeo inválido para estas filas es un error del programa, no de una fila", () => {
    expect(() => mapRows([fila({ "Customer Email": "cliente1@example.com" })], { ...BASE, note: "Customer Email" }, "otro")).toThrow(
      RangeError,
    );
    expect(() => mapRows([fila()], { ...BASE, gross: "Importe" }, "otro")).toThrow(/Importe/);
  });

  test("sin filas no hay nada que convertir", () => {
    expect(mapRows([], BASE, "otro")).toEqual({ ok: [], skipped: [], errors: [] });
  });

  test("line es la línea del archivo: la primera fila de datos es la 2", () => {
    const r = mapRows([fila({ ref: "a" }), fila({ ref: "b", monto: "x" }), fila({ ref: "c", monto: "0" })], BASE, "otro");
    expect(r.ok.map((x) => x.line)).toEqual([2]);
    expect(r.errors.map((x) => x.line)).toEqual([3]);
    expect(r.skipped.map((x) => x.line)).toEqual([4]);
  });

  test("encuentra las columnas aunque el archivo las escriba distinto que el mapeo (mayúsculas, BOM, espacios)", () => {
    const filas = [{ "﻿Ref": "ref_demo_1", " FECHA ": "2026-11-13", Monto: "10.00" }];
    expect(mapRows(filas, BASE, "otro").ok).toHaveLength(1);
  });

  test("una fila corta (le faltan columnas) se lee con esas celdas vacías", () => {
    const r = mapRows([fila(), { ref: "ref_demo_2", fecha: "2026-11-13" }], BASE, "otro");
    expect(r.errors).toEqual([{ line: 3, reason: "falta el monto" }]);
  });

  test("varios problemas en una fila se cuentan juntos", () => {
    expect(errorDe({ ref: " ", fecha: "ayer", monto: "diez" })).toBe(
      "falta la referencia; fecha u hora inválidas: «ayer» (se espera AAAA-MM-DD, con la hora opcional); monto inválido: «diez»",
    );
  });
});

describe("mapRows: referencia", () => {
  test("se recorta", () => expect(okDe({ ref: "  ch_demo_0001  " }).reference).toBe("ch_demo_0001"));
  test("vacía es un error", () => expect(errorDe({ ref: "" })).toBe("falta la referencia"));
  test("más de 120 caracteres es un error", () => {
    expect(okDe({ ref: "r".repeat(120) }).reference).toHaveLength(120);
    expect(errorDe({ ref: "r".repeat(121) })).toBe("la referencia pasa de 120 caracteres");
  });
  test("con forma de número de tarjeta es un error (y no se repite en el motivo)", () => {
    expect(errorDe({ ref: "4111 1111 1111 1111" })).toBe("la referencia parece un número de tarjeta");
  });

  test("repetida en el mismo archivo: se omite la segunda y se dice dónde salió la primera", () => {
    const r = mapRows(
      [fila({ ref: "a" }), fila({ ref: "a", monto: "x" }), fila({ ref: "b" }), fila({ ref: "a" }), fila({ ref: " b " })],
      BASE,
      "otro",
    );
    expect(r.ok.map((x) => x.reference)).toEqual(["a", "b"]);
    // La de la línea 3 no se pudo leer: no cuenta como «ya salió».
    expect(r.errors.map((x) => x.line)).toEqual([3]);
    expect(r.skipped).toEqual([
      { line: 5, reason: "referencia repetida: ya salió en la línea 2" },
      { line: 6, reason: "referencia repetida: ya salió en la línea 4" },
    ]);
  });
});

describe("mapRows: montos y moneda", () => {
  test("el monto se lee con el decimal del mapeo", () => {
    expect(okDe({ monto: "1,234.56" }).grossOriginal).toBe("1234.56");
    expect(okDe({ monto: "1.234,56" }, { decimal: "," }).grossOriginal).toBe("1234.56");
  });

  test("vacío o ilegible es un error; cero o negativo se omite", () => {
    expect(errorDe({ monto: "" })).toBe("falta el monto");
    expect(errorDe({ monto: "1.234,56" })).toBe("monto inválido: «1.234,56»");
    expect(omitidaPor({ monto: "0.00" })).toBe("monto en cero o negativo: no es un cobro");
    expect(omitidaPor({ monto: "(5.00)" })).toBe("monto en cero o negativo: no es un cobro");
  });

  test("la comisión se guarda en positivo; vacía o sin columna → null; ilegible es un error", () => {
    expect(okDe({ com: "-1.50" }, { fee: "com" }).reportedFee).toBe("1.50");
    expect(okDe({ com: "(1.50)" }, { fee: "com" }).reportedFee).toBe("1.50");
    expect(okDe({ com: "1.50" }, { fee: "com" }).reportedFee).toBe("1.50");
    expect(okDe({ com: "0.00" }, { fee: "com" }).reportedFee).toBe("0.00");
    expect(okDe({ com: "  " }, { fee: "com" }).reportedFee).toBeNull();
    expect(okDe({}).reportedFee).toBeNull();
    expect(errorDe({ com: "uno" }, { fee: "com" })).toBe("comisión inválida: «uno»");
  });

  test("la moneda va en mayúsculas; vacía o sin columna, la de por defecto; otra cosa es un error", () => {
    expect(okDe({ mon: "usd" }, { currency: "mon" }).currency).toBe("USD");
    expect(okDe({ mon: " eur " }, { currency: "mon" }).currency).toBe("EUR");
    expect(okDe({ mon: "" }, { currency: "mon", defaultCurrency: "MXN" }).currency).toBe("MXN");
    expect(okDe({}, { defaultCurrency: "EUR" }).currency).toBe("EUR");
    expect(errorDe({ mon: "US$" }, { currency: "mon" })).toBe("moneda inválida: «US$» (se esperan 3 letras, como USD)");
  });
});

describe("mapRows: fechas y zonas", () => {
  test("en UTC, con la hora pegada a la fecha (espacio o T) y con o sin segundos", () => {
    expect(okDe({ fecha: "2026-11-13 10:30:15" }).occurredAt).toBe("2026-11-13T10:30:15.000Z");
    expect(okDe({ fecha: "2026-11-13T10:30" }).occurredAt).toBe("2026-11-13T10:30:00.000Z");
  });

  test("occurredOn es la fecha en Nueva York: 03:30 UTC del 14 es todavía el 13", () => {
    const r = okDe({ fecha: "2026-11-14 03:30:00" });
    expect(r.occurredAt).toBe("2026-11-14T03:30:00.000Z");
    expect(r.occurredOn).toBe("2026-11-13");
  });

  test("la hora en su propia columna, con la hora de un dígito", () => {
    expect(okDe({ fecha: "2026-11-13", hora: "9:05" }, { time: "hora" }).occurredAt).toBe("2026-11-13T09:05:00.000Z");
    expect(okDe({ fecha: "2026-11-13", hora: "09:05:07" }, { time: "hora" }).occurredAt).toBe("2026-11-13T09:05:07.000Z");
  });

  test("sin hora: las 12:00 de la zona que corresponda", () => {
    expect(okDe({ fecha: "2026-11-13" }).occurredAt).toBe("2026-11-13T12:00:00.000Z");
    expect(okDe({ fecha: "2026-11-13", hora: "" }, { time: "hora", fixedZone: "America/New_York" }).occurredAt).toBe(
      "2026-11-13T17:00:00.000Z",
    );
  });

  test("los tres formatos de fecha", () => {
    expect(okDe({ fecha: "11/13/2026 10:30" }, { dateFormat: "MM/DD/YYYY" }).occurredAt).toBe("2026-11-13T10:30:00.000Z");
    expect(okDe({ fecha: "1/5/2026" }, { dateFormat: "MM/DD/YYYY" }).occurredOn).toBe("2026-01-05");
    expect(okDe({ fecha: "13/11/2026 10:30" }, { dateFormat: "DD/MM/YYYY" }).occurredAt).toBe("2026-11-13T10:30:00.000Z");
    expect(okDe({ fecha: "5/1/2026" }, { dateFormat: "DD/MM/YYYY" }).occurredOn).toBe("2026-01-05");
  });

  test.each<[string, Partial<ColumnMapping>]>([
    ["", {}],
    ["13/11/2026", {}],
    ["2026-11-13 25:00", {}],
    ["2026-11-13 10:60", {}],
    ["2026-11-13 10:30:60", {}],
    ["2026-02-29", {}],
    ["2026-11-13 10:30 PM", {}],
    ["2026-11-13T10:30Z", {}],
    ["13/11/2026", { dateFormat: "MM/DD/YYYY" }],
    ["11/13/2026", { dateFormat: "DD/MM/YYYY" }],
    ["2026-11-13", { dateFormat: "DD/MM/YYYY" }],
  ])("«%s» no es una fecha válida", (fecha, mapeo) => {
    expect(errorDe({ fecha }, mapeo)).toMatch(fecha === "" ? /^falta la fecha$/ : /^fecha u hora inválidas: «/);
  });

  test("hora inválida en su columna, u hora en la fecha y además en su columna, es un error", () => {
    expect(errorDe({ fecha: "2026-11-13", hora: "7pm" }, { time: "hora" })).toBe(
      "fecha u hora inválidas: «2026-11-13 7pm» (se espera AAAA-MM-DD, con la hora opcional)",
    );
    expect(errorDe({ fecha: "2026-11-13 10:00", hora: "11:00" }, { time: "hora" })).toBe(
      "fecha u hora inválidas: «2026-11-13 10:00 11:00» (se espera AAAA-MM-DD, con la hora opcional)",
    );
  });

  describe("zona fija (sin columna de zona)", () => {
    const LA = { fixedZone: "America/Los_Angeles" };

    test("un cobro a las 23:30 de Los Ángeles cae al día siguiente en Nueva York", () => {
      const r = okDe({ fecha: "2026-11-13 23:30:00" }, LA);
      expect(r.occurredAt).toBe("2026-11-14T07:30:00.000Z");
      expect(r.occurredOn).toBe("2026-11-14");
    });

    test("los dos cambios de horario de 2026: la hora que no existe va hacia adelante; la repetida, la primera", () => {
      expect(okDe({ fecha: "2026-03-08 02:30:00" }, LA).occurredAt).toBe("2026-03-08T10:30:00.000Z");
      expect(okDe({ fecha: "2026-11-01 01:30:00" }, LA).occurredAt).toBe("2026-11-01T08:30:00.000Z");
      expect(okDe({ fecha: "2026-03-08 02:30:00" }, { fixedZone: "America/New_York" }).occurredAt).toBe(
        "2026-03-08T07:30:00.000Z",
      );
      expect(okDe({ fecha: "2026-11-01 01:30:00" }, { fixedZone: "America/New_York" }).occurredAt).toBe(
        "2026-11-01T05:30:00.000Z",
      );
    });
  });

  describe("columna de zona: se respeta la de cada fila", () => {
    const ZONA = { timezone: "zona" };

    // A las 12:00 del 1 de julio: cada abreviatura es su desfase exacto, aunque no sea el horario de esa fecha.
    test.each([
      ["EST", "17:00"],
      ["EDT", "16:00"],
      ["CST", "18:00"],
      ["CDT", "17:00"],
      ["MST", "19:00"],
      ["MDT", "18:00"],
      ["PST", "20:00"],
      ["PDT", "19:00"],
      ["AKST", "21:00"],
      ["AKDT", "20:00"],
      ["HST", "22:00"],
      ["UTC", "12:00"],
      ["GMT", "12:00"],
      ["pdt", "19:00"],
      [" PST ", "20:00"],
    ])("%s", (zona, utc) => {
      expect(okDe({ fecha: "2026-07-01 12:00:00", zona }, ZONA).occurredAt).toBe(`2026-07-01T${utc}:00.000Z`);
    });

    test("un nombre IANA se usa como zona, con su cambio de horario", () => {
      expect(okDe({ fecha: "2026-07-01 12:00:00", zona: "Europe/Madrid" }, ZONA).occurredAt).toBe("2026-07-01T10:00:00.000Z");
      expect(okDe({ fecha: "2026-03-08 02:30:00", zona: "America/Los_Angeles" }, ZONA).occurredAt).toBe(
        "2026-03-08T10:30:00.000Z",
      );
    });

    test("la columna manda sobre la zona fija", () => {
      expect(okDe({ fecha: "2026-07-01 12:00:00", zona: "UTC" }, { ...ZONA, fixedZone: "America/Los_Angeles" }).occurredAt).toBe(
        "2026-07-01T12:00:00.000Z",
      );
    });

    test("una zona vacía o que no se reconoce es un error de esa fila, no una suposición", () => {
      expect(errorDe({ zona: "" }, ZONA)).toBe("falta la zona horaria");
      expect(errorDe({ zona: "CET+1" }, ZONA)).toBe("zona horaria desconocida: «CET+1»");
      expect(errorDe({ zona: "Hora del Pacífico" }, ZONA)).toBe("zona horaria desconocida: «Hora del Pacífico»");
    });
  });
});

describe("mapRows: la nota", () => {
  test("por defecto no se lee ninguna columna como nota", () => expect(okDe({ Descripción: "algo" }).note).toBeNull());

  test("recortada; vacía → null", () => {
    expect(okDe({ desc: "  Pedido demo  " }, { note: "desc" }).note).toBe("Pedido demo");
    expect(okDe({ desc: "   " }, { note: "desc" }).note).toBeNull();
  });

  test("una nota que parece número de tarjeta se descarta", () => {
    expect(okDe({ desc: "tarjeta 4111-1111-1111-1111" }, { note: "desc" }).note).toBeNull();
  });

  test("más de 280 caracteres se corta con «…» (lo que admite la base)", () => {
    const nota = okDe({ desc: "a".repeat(300) }, { note: "desc" }).note!;
    expect(nota).toHaveLength(280);
    expect(nota.endsWith("a…")).toBe(true);
    expect(okDe({ desc: "a".repeat(280) }, { note: "desc" }).note).toBe("a".repeat(280));
  });
});

describe("mapRows: qué es un cobro en Stripe, movimientos de saldo", () => {
  const SALDO = presetFor("stripe_saldo")!;
  const filaSaldo = (reporting_category: string, gross = "10.00") => ({
    balance_transaction_id: "txn_demo_0001",
    created_utc: "2026-11-13 10:00:00",
    currency: "usd",
    gross,
    fee: "0.59",
    reporting_category,
  });
  const motivo = (categoria: string) => {
    const r = mapRows([filaSaldo(categoria)], SALDO, "stripe_saldo");
    return r.ok.length === 1 ? "cobro" : r.skipped[0]!.reason;
  };

  test.each([
    ["charge", "cobro"],
    ["Charge", "cobro"],
    ["payment", "cobro"],
    ["refund", "reembolso: el importador solo trae cobros (el reembolso se registra en el detalle del cobro)"],
    ["payment_refund", "reembolso: el importador solo trae cobros (el reembolso se registra en el detalle del cobro)"],
    ["partial_capture_reversal", "reembolso: el importador solo trae cobros (el reembolso se registra en el detalle del cobro)"],
    ["payout", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["payout_reversal", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["topup", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["topup_reversal", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["transfer", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["transfer_reversal", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["fee", "comisión suelta: no es un cobro"],
    ["adjustment", "ajuste, disputa o contracargo: no es un cobro"],
    ["other_adjustment", "ajuste, disputa o contracargo: no es un cobro"],
    ["dispute", "ajuste, disputa o contracargo: no es un cobro"],
    ["dispute_reversal", "ajuste, disputa o contracargo: no es un cobro"],
    ["refund_failure", "ajuste, disputa o contracargo: no es un cobro"],
    ["risk_reserved_funds", "retención o liberación de saldo: no es un cobro"],
    ["connect_reserved_funds", "retención o liberación de saldo: no es un cobro"],
    ["climate_order_purchase", "«climate_order_purchase» no es un cobro logrado"],
    ["", "sin tipo: no se sabe si es un cobro"],
  ])("categoría «%s» → %s", (categoria, esperado) => {
    expect(motivo(categoria)).toBe(esperado);
  });

  test("sin columna de tipo en el mapeo, cada fila positiva es un cobro", () => {
    expect(mapRows([filaSaldo("payout")], { ...SALDO, type: null }, "stripe_saldo").ok).toHaveLength(1);
  });
});

describe("mapRows: qué es un cobro en Stripe, pagos", () => {
  const PAGOS = presetFor("stripe_pagos")!;
  const filaPago = (Status: string, extra: Record<string, string> = {}) => ({
    id: "ch_demo_0001",
    "Created date (UTC)": "2026-11-13 10:00:00",
    Amount: "10.00",
    "Amount Refunded": "0.00",
    Currency: "usd",
    Captured: "true",
    Fee: "0.59",
    Status,
    ...extra,
  });
  const motivo = (status: string, extra: Record<string, string> = {}) => {
    const r = mapRows([filaPago(status, extra)], PAGOS, "stripe_pagos");
    return r.ok.length === 1 ? "cobro" : r.skipped[0]!.reason;
  };

  test.each([
    ["Paid", "cobro"],
    ["Succeeded", "cobro"],
    ["Refunded", "cobro"],
    ["Partially refunded", "cobro"],
    ["Disputed", "cobro"],
    ["Failed", "cobro fallido o cancelado"],
    ["Canceled", "cobro fallido o cancelado"],
    ["Cancelled", "cobro fallido o cancelado"],
    ["Blocked", "cobro fallido o cancelado"],
    ["Pending", "cobro pendiente o sin capturar"],
    ["Uncaptured", "cobro pendiente o sin capturar"],
    ["Partial capture", "cobro pendiente o sin capturar"],
    ["Partially paid", "cobro pendiente o sin capturar"],
    ["Incomplete", "cobro pendiente o sin capturar"],
    ["Waiting on funding", "cobro pendiente o sin capturar"],
    ["Processing", "cobro pendiente o sin capturar"],
    ["Raro", "«Raro» no es un cobro logrado"],
    ["", "sin estado: no se sabe si es un cobro"],
  ])("estado «%s» → %s", (status, esperado) => {
    expect(motivo(status)).toBe(esperado);
  });

  test("pagado pero sin capturar es pendiente; «Captured» vacío o ausente no cambia nada", () => {
    expect(motivo("Paid", { Captured: "FALSE" })).toBe("cobro pendiente o sin capturar");
    expect(motivo("Paid", { Captured: "" })).toBe("cobro");
    const { Captured: _sinColumna, ...sinCaptured } = filaPago("Paid");
    expect(mapRows([sinCaptured], PAGOS, "stripe_pagos").ok).toHaveLength(1);
  });

  test("lo reembolsado va en la nota (en la moneda del cobro), delante de la nota elegida", () => {
    const conNota = mapRows(
      [filaPago("Partially refunded", { "Amount Refunded": "4.00", Currency: "eur", Description: "Pedido demo" })],
      { ...PAGOS, note: "Description" },
      "stripe_pagos",
    );
    expect(conNota.ok[0]!.note).toBe("Reembolsado en la pasarela: €4,00 (falta registrarlo en el detalle del cobro) · Pedido demo");
    expect(conNota.ok[0]!.grossOriginal).toBe("10.00");
  });

  test("reembolsado en cero, vacío o sin columna: sin nota; ilegible es un error", () => {
    expect(mapRows([filaPago("Paid", { "Amount Refunded": "" })], PAGOS, "stripe_pagos").ok[0]!.note).toBeNull();
    const { "Amount Refunded": _sinColumna, ...sinReembolso } = filaPago("Paid");
    expect(mapRows([sinReembolso], PAGOS, "stripe_pagos").ok[0]!.note).toBeNull();
    expect(mapRows([filaPago("Paid", { "Amount Refunded": "mucho" })], PAGOS, "stripe_pagos").errors).toEqual([
      { line: 2, reason: "monto reembolsado inválido: «mucho»" },
    ]);
  });

  test("sin columna de estado en el mapeo, no se filtra por estado", () => {
    expect(mapRows([filaPago("Failed")], { ...PAGOS, status: null }, "stripe_pagos").ok).toHaveLength(1);
  });

  test("un cobro en EUR en una cuenta en USD: la comisión (en USD) no se trae y la nota lo dice", () => {
    const r = mapRows(
      [filaPago("Paid", { Currency: "eur", "Converted Currency": "usd", Fee: "1.87", Description: "Pedido demo" })],
      { ...PAGOS, note: "Description" },
      "stripe_pagos",
    );
    expect(r.ok).toHaveLength(1);
    expect(r.ok[0]!.currency).toBe("EUR");
    expect(r.ok[0]!.grossOriginal).toBe("10.00");
    expect(r.ok[0]!.reportedFee).toBeNull();
    expect(r.ok[0]!.note).toBe("Comisión informada en USD, otra moneda que el cobro: no se trajo · Pedido demo");
  });

  test("con la misma moneda (sin distinguir mayúsculas), sin «Converted Currency» o sin comisión, nada cambia", () => {
    const igual = mapRows([filaPago("Paid", { Currency: "usd", "Converted Currency": "USD " })], PAGOS, "stripe_pagos");
    expect(igual.ok[0]!).toMatchObject({ reportedFee: "0.59", note: null });
    const vacia = mapRows([filaPago("Paid", { Currency: "eur", "Converted Currency": "" })], PAGOS, "stripe_pagos");
    expect(vacia.ok[0]!).toMatchObject({ currency: "EUR", reportedFee: "0.59", note: null });
    const sinComision = mapRows([filaPago("Paid", { Currency: "eur", "Converted Currency": "usd", Fee: "" })], PAGOS, "stripe_pagos");
    expect(sinComision.ok[0]!).toMatchObject({ reportedFee: null, note: null });
  });

  test("la moneda de la cuenta solo se mira en Stripe, pagos", () => {
    const r = okDe({ moneda: "eur", "Converted Currency": "usd", comision: "1.00" }, { currency: "moneda", fee: "comision" });
    expect(r).toMatchObject({ currency: "EUR", reportedFee: "1.00", note: null });
  });
});

describe("mapRows: qué es un cobro en PayPal", () => {
  const PAYPAL = presetFor("paypal_actividad")!;
  const filaPaypal = (Type: string, Status = "Completed", Gross = "10.00") => ({
    Date: "11/13/2026",
    Time: "10:00:00",
    TimeZone: "PST",
    Type,
    Status,
    Currency: "USD",
    Gross,
    Fee: "-0.59",
    "Transaction ID": "DEMOPAYPAL0000001",
  });
  const motivo = (type: string, status?: string, gross?: string) => {
    const r = mapRows([filaPaypal(type, status, gross)], PAYPAL, "paypal_actividad");
    return r.ok.length === 1 ? "cobro" : r.skipped[0]!.reason;
  };

  test.each([
    ["General payment", "cobro"],
    ["Express Checkout Payment", "cobro"],
    ["Website Payment", "cobro"],
    ["Donation payment", "cobro"],
    ["Payment refund", "reembolso: el importador solo trae cobros (el reembolso se registra en el detalle del cobro)"],
    ["Payment reversal", "reembolso: el importador solo trae cobros (el reembolso se registra en el detalle del cobro)"],
    ["General withdrawal", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["Bank deposit to PayPal account", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["General transfer", "retiro, depósito o transferencia de saldo: no es un cobro"],
    ["General non-payment-related fee", "comisión suelta: no es un cobro"],
    ["General currency conversion", "conversión de moneda: no es un cobro"],
    ["Hold on available balance", "retención o liberación de saldo: no es un cobro"],
    ["Reversal of general account hold", "retención o liberación de saldo: no es un cobro"],
    ["Payment release", "retención o liberación de saldo: no es un cobro"],
    ["Payment reserve", "retención o liberación de saldo: no es un cobro"],
    ["Chargeback", "ajuste, disputa o contracargo: no es un cobro"],
    ["Dispute fee", "ajuste, disputa o contracargo: no es un cobro"],
    ["General adjustment", "ajuste, disputa o contracargo: no es un cobro"],
    ["Account correction", "ajuste, disputa o contracargo: no es un cobro"],
    ["Cashback bonus", "«Cashback bonus» no es un cobro logrado"],
    ["", "sin tipo: no se sabe si es un cobro"],
  ])("tipo «%s» → %s", (tipo, esperado) => {
    expect(motivo(tipo)).toBe(esperado);
  });

  test.each([
    ["Completed", "cobro"],
    ["Pending", "cobro pendiente o sin capturar"],
    ["Processing", "cobro pendiente o sin capturar"],
    ["Created", "cobro pendiente o sin capturar"],
    ["Unverified", "cobro pendiente o sin capturar"],
    ["Payment pending", "cobro pendiente o sin capturar"],
    ["Denied", "cobro fallido o cancelado"],
    ["Reversed", "cobro fallido o cancelado"],
    ["Voided", "cobro fallido o cancelado"],
    ["Canceled", "cobro fallido o cancelado"],
    ["Expired", "cobro fallido o cancelado"],
    ["Error", "cobro fallido o cancelado"],
    ["Active", "«Active» no es un cobro logrado"],
    ["", "sin estado: no se sabe si es un cobro"],
  ])("estado «%s» → %s", (estado, esperado) => {
    expect(motivo("General payment", estado)).toBe(esperado);
  });

  test("un pago enviado (bruto negativo) no es un cobro", () => {
    expect(motivo("Express Checkout payment", "Completed", "-20.00")).toBe("monto en cero o negativo: no es un cobro");
  });

  test("sin columnas de tipo ni de estado en el mapeo, no se filtra por ellas", () => {
    const r = mapRows([filaPaypal("General withdrawal", "Denied")], { ...PAYPAL, type: null, status: null }, "paypal_actividad");
    expect(r.ok).toHaveLength(1);
  });
});
