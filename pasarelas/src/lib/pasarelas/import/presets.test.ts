import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { describe, expect, test } from "vitest";
import { detectFormat } from "./detect";
import { mapRows, validateMapping, type ImportRow } from "./mapping";
import { presetFor, referenceWarning, type ColumnMapping } from "./presets";

/** Lee un archivo de ejemplo como lo leerá el navegador: papaparse con encabezados. */
function leer(nombre: string): { headers: string[]; rows: Record<string, string>[] } {
  const texto = readFileSync(new URL(`../../../../tests/fixtures/${nombre}`, import.meta.url), "utf8");
  const leido = Papa.parse<Record<string, string>>(texto, { header: true, skipEmptyLines: true });
  return { headers: leido.meta.fields ?? [], rows: leido.data };
}

const fila = (r: Omit<ImportRow, "note"> & { note?: string | null }): ImportRow => ({ note: null, ...r });

const REEMBOLSO = "reembolso: el importador solo trae cobros (el reembolso se registra en el detalle del cobro)";
const RETIRO = "retiro, depósito o transferencia de saldo: no es un cobro";
const COMISION = "comisión suelta: no es un cobro";
const AJUSTE = "ajuste, disputa o contracargo: no es un cobro";
const RETENCION = "retención o liberación de saldo: no es un cobro";
const CONVERSION = "conversión de moneda: no es un cobro";
const FALLIDO = "cobro fallido o cancelado";
const PENDIENTE = "cobro pendiente o sin capturar";
const NO_POSITIVO = "monto en cero o negativo: no es un cobro";
const repetida = (linea: number) => `referencia repetida: ya salió en la línea ${linea}`;

/** Nada de lo que identifica al comprador sale del archivo. */
function sinDatosDelComprador(resultado: unknown): void {
  const json = JSON.stringify(resultado);
  expect(json).not.toMatch(/example\.com/);
  expect(json).not.toMatch(/Cliente Demo/);
  expect(json).not.toMatch(/4111/);
}

describe("presetFor: el mapeo por defecto de cada formato", () => {
  test("Stripe, pagos", () => {
    expect(presetFor("stripe_pagos")).toEqual<ColumnMapping>({
      reference: "id",
      date: "Created date (UTC)",
      time: null,
      timezone: null,
      gross: "Amount",
      currency: "Currency",
      fee: "Fee",
      status: "Status",
      type: null,
      note: null,
      fixedZone: "UTC",
      decimal: ".",
      dateFormat: "YYYY-MM-DD",
      defaultCurrency: "USD",
    });
  });

  test("Stripe, movimientos de saldo", () => {
    expect(presetFor("stripe_saldo")).toEqual<ColumnMapping>({
      reference: "balance_transaction_id",
      date: "created_utc",
      time: null,
      timezone: null,
      gross: "gross",
      currency: "currency",
      fee: "fee",
      status: null,
      type: "reporting_category",
      note: null,
      fixedZone: "UTC",
      decimal: ".",
      dateFormat: "YYYY-MM-DD",
      defaultCurrency: "USD",
    });
  });

  test("PayPal, actividad", () => {
    expect(presetFor("paypal_actividad")).toEqual<ColumnMapping>({
      reference: "Transaction ID",
      date: "Date",
      time: "Time",
      timezone: "TimeZone",
      gross: "Gross",
      currency: "Currency",
      fee: "Fee",
      status: "Status",
      type: "Type",
      note: null,
      fixedZone: "America/New_York",
      decimal: ".",
      dateFormat: "MM/DD/YYYY",
      defaultCurrency: "USD",
    });
  });

  test("«otro» no tiene mapeo por defecto: se arma a mano", () => {
    expect(presetFor("otro")).toBeNull();
  });

  test("cada llamada da una copia: cambiarla no cambia el mapeo por defecto", () => {
    const uno = presetFor("paypal_actividad")!;
    uno.reference = "Name";
    expect(presetFor("paypal_actividad")!.reference).toBe("Transaction ID");
  });

  test("Stripe, saldo: si el archivo trae source_id (el id del cobro), esa es la referencia", () => {
    const { headers } = leer("stripe-saldo-fuente.csv");
    expect(presetFor("stripe_saldo", headers)).toEqual<ColumnMapping>({
      ...presetFor("stripe_saldo")!,
      reference: "source_id",
    });
    // Sin distinguir mayúsculas ni la marca BOM, como el resto de las columnas.
    expect(presetFor("stripe_saldo", ["\uFEFFbalance_transaction_id", " SOURCE_ID "])!.reference).toBe("source_id");
    // Sin esa columna, el id del movimiento; en otro formato, la columna no cambia nada.
    expect(presetFor("stripe_saldo", leer("stripe-saldo.csv").headers)!.reference).toBe("balance_transaction_id");
    expect(presetFor("stripe_pagos", ["source_id"])!.reference).toBe("id");
  });
});

describe("referenceWarning: cuando la referencia no coincide con lo registrado a mano", () => {
  const saldo = presetFor("stripe_saldo")!;
  const sinFuente = leer("stripe-saldo.csv").headers;
  const conFuente = leer("stripe-saldo-fuente.csv").headers;

  test("Stripe, saldo, sin source_id: avisa que las txn_… no coinciden y cómo pedir la columna", () => {
    expect(referenceWarning("stripe_saldo", sinFuente, saldo)).toBe(
      "Este informe no trae la columna source_id, así que la referencia de cada cobro es la del movimiento (txn_…). " +
        "No coincide con la de los cobros que registraste a mano ni con la de la exportación de pagos (ch_…): si " +
        "alguno ya está registrado, se repetiría. Al pedir el informe en Stripe, agrega la columna source_id.",
    );
  });

  test("Stripe, saldo, con source_id pero eligiendo la del movimiento (un mapeo recordado): también avisa", () => {
    expect(referenceWarning("stripe_saldo", conFuente, saldo)).toBe(
      "La referencia de cada cobro es la del movimiento (txn_…), que no coincide con la de los cobros que " +
        "registraste a mano (ch_…). El archivo trae source_id: elígela como referencia en «Ajustar columnas», salvo " +
        "que ya hayas importado estos cobros con la del movimiento (se repetirían).",
    );
  });

  test("con source_id como referencia, u otro formato, no hay nada que avisar", () => {
    expect(referenceWarning("stripe_saldo", conFuente, presetFor("stripe_saldo", conFuente)!)).toBeNull();
    expect(referenceWarning("stripe_saldo", sinFuente, { ...saldo, reference: " Balance_Transaction_ID" })).not.toBeNull();
    expect(referenceWarning("stripe_pagos", sinFuente, { ...saldo })).toBeNull();
    expect(referenceWarning("otro", sinFuente, { ...saldo })).toBeNull();
  });
});

describe("Stripe, movimientos de saldo con source_id (tests/fixtures/stripe-saldo-fuente.csv)", () => {
  const { headers, rows } = leer("stripe-saldo-fuente.csv");
  const formato = detectFormat(headers);
  const resultado = mapRows(rows, presetFor(formato, headers)!, formato);

  test("se reconoce el formato y cada cobro lleva el id del cobro (ch_…, py_…), no el del movimiento", () => {
    expect(formato).toBe("stripe_saldo");
    expect(resultado.ok.map((r) => r.reference)).toEqual(["ch_demo_0001", "py_demo_0002"]);
    expect(resultado.skipped).toEqual([
      { line: 4, reason: REEMBOLSO },
      { line: 5, reason: RETIRO },
    ]);
    expect(resultado.errors).toEqual([]);
    sinDatosDelComprador(resultado);
  });
});

describe("Stripe, movimientos de saldo (tests/fixtures/stripe-saldo.csv)", () => {
  const { headers, rows } = leer("stripe-saldo.csv");
  const resultado = mapRows(rows, presetFor(detectFormat(headers))!, detectFormat(headers));

  test("se reconoce el formato", () => expect(detectFormat(headers)).toBe("stripe_saldo"));

  test("solo los cargos, con la hora en UTC (incluidos los dos días de cambio de horario)", () => {
    expect(resultado.ok).toEqual([
      // 07:30 UTC del 8 de marzo = 03:30 EDT, recién cambiado el horario.
      fila({ line: 2, reference: "txn_demo_0001", occurredAt: "2026-03-08T07:30:00.000Z", occurredOn: "2026-03-08",
        grossOriginal: "100.00", currency: "USD", reportedFee: "3.20" }),
      // 05:30 UTC del 1 de noviembre = la primera 01:30 (EDT).
      fila({ line: 3, reference: "txn_demo_0002", occurredAt: "2026-11-01T05:30:00.000Z", occurredOn: "2026-11-01",
        grossOriginal: "1234.56", currency: "USD", reportedFee: "36.10" }),
    ]);
  });

  test("lo que no es un cobro se omite con su motivo", () => {
    expect(resultado.skipped).toEqual([
      { line: 4, reason: REEMBOLSO },
      { line: 5, reason: RETIRO },
      { line: 6, reason: COMISION },
      { line: 7, reason: AJUSTE },
      { line: 8, reason: AJUSTE },
      { line: 9, reason: RETENCION },
      { line: 10, reason: RETIRO },
      { line: 11, reason: repetida(2) },
    ]);
  });

  test("lo que no se puede leer va a errores con su línea", () => {
    expect(resultado.errors).toEqual([
      { line: 12, reason: "moneda inválida: «us dollars» (se esperan 3 letras, como USD)" },
      { line: 13, reason: "falta la fecha" },
    ]);
  });

  test("el correo y el nombre del comprador están en el archivo y no en el resultado", () => {
    expect(headers).toEqual(expect.arrayContaining(["customer_email", "customer_name"]));
    sinDatosDelComprador(resultado);
  });
});

describe("Stripe, pagos (tests/fixtures/stripe-pagos.csv)", () => {
  const { headers, rows } = leer("stripe-pagos.csv");
  const resultado = mapRows(rows, presetFor(detectFormat(headers))!, detectFormat(headers));

  test("se reconoce el formato", () => expect(detectFormat(headers)).toBe("stripe_pagos"));

  test("los cobros logrados, con lo reembolsado en la nota y el monto original", () => {
    expect(resultado.ok).toEqual([
      fila({ line: 2, reference: "ch_demo_0001", occurredAt: "2026-11-13T15:30:00.000Z", occurredOn: "2026-11-13",
        grossOriginal: "100.00", currency: "USD", reportedFee: "3.20" }),
      // 03:30 UTC del 14 = 22:30 del 13 en Nueva York.
      fila({ line: 3, reference: "ch_demo_0002", occurredAt: "2026-11-14T03:30:00.000Z", occurredOn: "2026-11-13",
        grossOriginal: "1234.56", currency: "USD", reportedFee: "36.10",
        note: "Reembolsado en la pasarela: $40,00 (falta registrarlo en el detalle del cobro)" }),
      fila({ line: 7, reference: "ch_demo_0006", occurredAt: "2026-11-14T13:00:00.000Z", occurredOn: "2026-11-14",
        grossOriginal: "25.00", currency: "USD", reportedFee: "1.03",
        note: "Reembolsado en la pasarela: $25,00 (falta registrarlo en el detalle del cobro)" }),
      // Cobro en EUR en una cuenta en USD: la comisión va en USD, así que no se trae.
      fila({ line: 12, reference: "ch_demo_0010", occurredAt: "2026-11-15T16:00:00.000Z", occurredOn: "2026-11-15",
        grossOriginal: "50.00", currency: "EUR", reportedFee: null,
        note: "Comisión informada en USD, otra moneda que el cobro: no se trajo" }),
    ]);
  });

  test("fallidos, pendientes, sin capturar, cancelados y repetidos se omiten", () => {
    expect(resultado.skipped).toEqual([
      { line: 4, reason: FALLIDO },
      { line: 5, reason: PENDIENTE },
      { line: 6, reason: PENDIENTE },
      { line: 8, reason: FALLIDO },
      { line: 9, reason: repetida(2) },
    ]);
  });

  test("fecha y monto ilegibles van a errores", () => {
    expect(resultado.errors).toEqual([
      { line: 10, reason: "fecha u hora inválidas: «13/11/2026 10:00» (se espera AAAA-MM-DD, con la hora opcional)" },
      { line: 11, reason: "monto inválido: «12,34,5»" },
    ]);
  });

  test("ni el correo ni la descripción del comprador salen del archivo", () => {
    expect(headers).toEqual(expect.arrayContaining(["Customer Email", "Customer Description"]));
    sinDatosDelComprador(resultado);
  });
});

describe("PayPal, actividad (tests/fixtures/paypal-actividad.csv)", () => {
  const { headers, rows } = leer("paypal-actividad.csv");
  const resultado = mapRows(rows, presetFor(detectFormat(headers))!, detectFormat(headers));

  test("se reconoce el formato (el archivo trae marca BOM)", () => expect(detectFormat(headers)).toBe("paypal_actividad"));

  test("cada fila con su zona: abreviatura de EE. UU. o nombre IANA", () => {
    expect(resultado.ok).toEqual([
      // 23:30 PST del 13 = 07:30 UTC del 14 = 02:30 del 14 en Nueva York: cae al día siguiente.
      fila({ line: 2, reference: "DEMOPAYPAL0000001", occurredAt: "2026-11-14T07:30:00.000Z", occurredOn: "2026-11-14",
        grossOriginal: "1234.56", currency: "USD", reportedFee: "36.10" }),
      // 02:30 del 8 de marzo en Nueva York no existe: hacia adelante, 03:30 EDT.
      fila({ line: 3, reference: "DEMOPAYPAL0000002", occurredAt: "2026-03-08T07:30:00.000Z", occurredOn: "2026-03-08",
        grossOriginal: "100.00", currency: "USD", reportedFee: "3.20" }),
      // 01:30 del 1 de noviembre en Nueva York ocurre dos veces: la primera (EDT).
      fila({ line: 4, reference: "DEMOPAYPAL0000003", occurredAt: "2026-11-01T05:30:00.000Z", occurredOn: "2026-11-01",
        grossOriginal: "50.00", currency: "USD", reportedFee: "1.75" }),
      // PDT es −07:00 tal cual.
      fila({ line: 5, reference: "DEMOPAYPAL0000004", occurredAt: "2026-07-01T19:00:00.000Z", occurredOn: "2026-07-01",
        grossOriginal: "20.00", currency: "USD", reportedFee: "0.88" }),
    ]);
  });

  test("reembolsos, retiros, depósitos, comisiones, conversiones, retenciones, contracargos, pendientes, fallidos, pagos enviados y repetidos se omiten", () => {
    expect(resultado.skipped).toEqual([
      { line: 6, reason: REEMBOLSO },
      { line: 7, reason: RETIRO },
      { line: 8, reason: RETIRO },
      { line: 9, reason: COMISION },
      { line: 10, reason: CONVERSION },
      { line: 11, reason: RETENCION },
      { line: 12, reason: RETENCION },
      { line: 13, reason: AJUSTE },
      { line: 14, reason: PENDIENTE },
      { line: 15, reason: FALLIDO },
      { line: 16, reason: NO_POSITIVO },
      { line: 17, reason: repetida(2) },
    ]);
  });

  test("una zona que no se reconoce y un monto ilegible van a errores", () => {
    expect(resultado.errors).toEqual([
      { line: 18, reason: "zona horaria desconocida: «Hora de Marte»" },
      { line: 19, reason: "monto inválido: «quince»" },
    ]);
  });

  test("nombre y correos del comprador están en el archivo y no en el resultado", () => {
    expect(headers).toEqual(expect.arrayContaining(["Name", "From Email Address", "To Email Address"]));
    sinDatosDelComprador(resultado);
  });
});

describe("otro formato con un mapeo a mano (tests/fixtures/otro.csv)", () => {
  const { headers, rows } = leer("otro.csv");
  const mapeo: ColumnMapping = {
    reference: "Referencia",
    date: "Fecha",
    time: "Hora",
    timezone: null,
    gross: "Importe",
    currency: "Moneda",
    fee: "Comisión",
    status: null,
    type: null,
    note: "Concepto",
    fixedZone: "America/New_York",
    decimal: ",",
    dateFormat: "DD/MM/YYYY",
    defaultCurrency: "EUR",
  };
  const resultado = mapRows(rows, mapeo, "otro");

  test("no se reconoce como ninguna pasarela", () => expect(detectFormat(headers)).toBe("otro"));

  test("el mapeo a mano es válido para este archivo", () => expect(validateMapping(headers, mapeo)).toEqual([]));

  test("coma decimal, fecha día/mes, zona fija y moneda por defecto", () => {
    expect(resultado.ok).toEqual([
      fila({ line: 2, reference: "OT-0001", occurredAt: "2026-11-14T03:30:00.000Z", occurredOn: "2026-11-13",
        grossOriginal: "1234.56", currency: "EUR", reportedFee: "1.50", note: "Clase de prueba" }),
      // Sin hora: las 12:00 de la zona. Sin moneda: la de por defecto. La nota con forma de tarjeta se descarta.
      fila({ line: 3, reference: "OT-0002", occurredAt: "2026-11-14T17:00:00.000Z", occurredOn: "2026-11-14",
        grossOriginal: "10.00", currency: "EUR", reportedFee: null }),
    ]);
  });

  test("sin tipo ni estado, solo se omite lo que no es positivo y lo repetido", () => {
    expect(resultado.skipped).toEqual([
      { line: 4, reason: NO_POSITIVO },
      { line: 5, reason: repetida(2) },
    ]);
  });

  test("fecha que no existe y referencia vacía van a errores", () => {
    expect(resultado.errors).toEqual([
      { line: 6, reason: "fecha u hora inválidas: «31/02/2026 10:00» (se espera DD/MM/AAAA, con la hora opcional)" },
      { line: 7, reason: "falta la referencia" },
    ]);
  });

  test("las columnas del cliente no salen", () => sinDatosDelComprador(resultado));
});
