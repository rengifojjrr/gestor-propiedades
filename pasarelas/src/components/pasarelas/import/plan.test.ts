import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { presetFor, type ColumnMapping } from "@/lib/pasarelas";
import { chunk, columnChoices, formatConflict, groupSkips, isBuyerColumn, proposeMapping } from "./plan";

/** Los encabezados de un archivo de ejemplo, leídos como los lee la pantalla. */
function headersOf(fixture: string): string[] {
  const text = readFileSync(`tests/fixtures/${fixture}`, "utf8");
  return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).meta.fields ?? [];
}

const saldo = presetFor("stripe_saldo")!;

describe("proposeMapping", () => {
  it("reconoce el formato y propone su mapeo por defecto", () => {
    expect(proposeMapping(headersOf("stripe-saldo.csv"), undefined)).toEqual({
      format: "stripe_saldo",
      mapping: saldo,
      from: "formato",
    });
    expect(proposeMapping(headersOf("paypal-actividad.csv"), undefined)).toMatchObject({
      format: "paypal_actividad",
      from: "formato",
    });
  });

  it("usa el mapeo guardado para esa pasarela si es del mismo formato y sirve para el archivo", () => {
    const mapping: ColumnMapping = { ...saldo, fixedZone: "America/New_York" };
    expect(proposeMapping(headersOf("stripe-saldo.csv"), { format: "stripe_saldo", mapping })).toEqual({
      format: "stripe_saldo",
      mapping,
      from: "guardado",
    });
  });

  it("si el guardado es de otro formato o ya no sirve, propone el del formato", () => {
    const pagos = presetFor("stripe_pagos")!;
    expect(proposeMapping(headersOf("stripe-saldo.csv"), { format: "stripe_pagos", mapping: pagos })).toEqual({
      format: "stripe_saldo",
      mapping: saldo,
      from: "formato",
    });
    const broken: ColumnMapping = { ...saldo, reference: "columna_que_ya_no_viene" };
    expect(proposeMapping(headersOf("stripe-saldo.csv"), { format: "stripe_saldo", mapping: broken }).from).toBe(
      "formato",
    );
  });

  it("un archivo que no se reconoce se mapea a mano, salvo que haya uno «otro» guardado que le sirva", () => {
    const headers = headersOf("otro.csv");
    const blank = proposeMapping(headers, undefined);
    expect(blank).toMatchObject({ format: "otro", from: "a_mano" });
    expect(blank.mapping).toMatchObject({ reference: "", date: "", gross: "", note: null, fixedZone: "UTC" });

    const mine: ColumnMapping = {
      ...blank.mapping,
      reference: "Referencia",
      date: "Fecha",
      time: "Hora",
      gross: "Importe",
      currency: "Moneda",
      fee: "Comisión",
      decimal: ",",
      dateFormat: "DD/MM/YYYY",
      fixedZone: "Europe/Madrid",
      defaultCurrency: "EUR",
    };
    expect(proposeMapping(headers, { format: "otro", mapping: mine })).toEqual({
      format: "otro",
      mapping: mine,
      from: "guardado",
    });
  });
});

describe("formatConflict", () => {
  it("avisa cuando la pasarela ya se importó con otro formato", () => {
    expect(formatConflict({ format: "stripe_saldo", mapping: saldo }, "stripe_pagos")).toBe("stripe_saldo");
    expect(formatConflict({ format: "stripe_saldo", mapping: saldo }, "stripe_saldo")).toBeNull();
    expect(formatConflict(undefined, "stripe_pagos")).toBeNull();
  });
});

describe("columnas que se ofrecen", () => {
  it("nunca las del comprador (correo, nombre, dirección)", () => {
    expect(isBuyerColumn("customer_email")).toBe(true);
    expect(isBuyerColumn("Nombre cliente")).toBe(true);
    expect(isBuyerColumn("From Email Address")).toBe(true);
    expect(isBuyerColumn("balance_transaction_id")).toBe(false);
    expect(isBuyerColumn("Status")).toBe(false);
    expect(columnChoices(headersOf("otro.csv"))).toEqual([
      "Referencia",
      "Fecha",
      "Hora",
      "Importe",
      "Moneda",
      "Comisión",
      "Concepto",
    ]);
    expect(columnChoices(headersOf("stripe-saldo.csv"))).not.toContain("customer_name");
  });
});

describe("groupSkips", () => {
  it("junta las filas omitidas por motivo, el más frecuente primero", () => {
    expect(
      groupSkips([
        { line: 3, reason: "reembolso" },
        { line: 4, reason: "retiro" },
        { line: 5, reason: "reembolso" },
      ]),
    ).toEqual([
      { reason: "reembolso", lines: [3, 5] },
      { reason: "retiro", lines: [4] },
    ]);
  });
});

describe("chunk", () => {
  it("parte en lotes del tamaño pedido, en orden", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 500)).toEqual([]);
  });
});
