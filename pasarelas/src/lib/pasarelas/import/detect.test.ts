import { describe, expect, test } from "vitest";
import { detectFormat, type ImportFormat } from "./detect";
import { validateMapping } from "./mapping";
import { presetFor } from "./presets";

/** Encabezados tal como salen de cada pasarela (ver las fuentes al inicio de `presets.ts`). */
const STRIPE_SALDO = [
  "balance_transaction_id",
  "created_utc",
  "available_on_utc",
  "currency",
  "gross",
  "fee",
  "net",
  "reporting_category",
  "description",
];
const STRIPE_PAGOS = [
  "id",
  "Created date (UTC)",
  "Amount",
  "Amount Refunded",
  "Currency",
  "Captured",
  "Converted Amount",
  "Converted Amount Refunded",
  "Converted Currency",
  "Fee",
  "Status",
  "Description",
  "Customer Email",
];
const PAYPAL = [
  "Date",
  "Time",
  "TimeZone",
  "Name",
  "Type",
  "Status",
  "Currency",
  "Gross",
  "Fee",
  "Net",
  "From Email Address",
  "To Email Address",
  "Transaction ID",
  "Reference Txn ID",
  "Receipt ID",
];

const CASOS: [ImportFormat, string[]][] = [
  ["stripe_saldo", STRIPE_SALDO],
  ["stripe_pagos", STRIPE_PAGOS],
  ["paypal_actividad", PAYPAL],
];

describe("detectFormat", () => {
  test.each(CASOS)("reconoce %s por sus encabezados", (formato, encabezados) => {
    expect(detectFormat(encabezados)).toBe(formato);
  });

  test.each(CASOS)("%s: sin distinguir mayúsculas, espacios alrededor ni la marca BOM, y en cualquier orden", (formato, encabezados) => {
    const revueltos = encabezados.map((h, i) => (i % 2 === 0 ? `  ${h.toUpperCase()} ` : h.toLowerCase())).reverse();
    revueltos[0] = `﻿${revueltos[0]}`;
    expect(detectFormat(revueltos)).toBe(formato);
  });

  test.each(CASOS)("%s: le sobran columnas y sigue siendo el mismo formato", (formato, encabezados) => {
    expect(detectFormat([...encabezados, "Columna inventada", "Otra más"])).toBe(formato);
  });

  test.each(CASOS)("%s: si falta una columna que el formato necesita, no se reconoce", (formato, encabezados) => {
    const preset = presetFor(formato);
    expect(preset).not.toBeNull();
    for (const necesaria of [preset!.reference, preset!.date, preset!.gross]) {
      expect(detectFormat(encabezados.filter((h) => h !== necesaria))).toBe("otro");
    }
  });

  test("lo que no se reconoce es «otro»", () => {
    expect(detectFormat([])).toBe("otro");
    expect(detectFormat(["Referencia", "Fecha", "Importe"])).toBe("otro");
    // Parecido pero no igual: «Created (UTC)» no es «Created date (UTC)».
    expect(detectFormat(STRIPE_PAGOS.map((h) => (h === "Created date (UTC)" ? "Created (UTC)" : h)))).toBe("otro");
  });

  test.each(CASOS)("%s: lo que se reconoce se puede importar con su mapeo por defecto, sin tocar nada", (formato, encabezados) => {
    expect(validateMapping(encabezados, presetFor(formato)!)).toEqual([]);
  });
});
