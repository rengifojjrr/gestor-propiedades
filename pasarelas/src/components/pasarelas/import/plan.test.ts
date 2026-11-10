import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { presetFor, type ColumnMapping, type ImportRow } from "@/lib/pasarelas";
import type { ImportPreview } from "@/server/pasarelas/ops/import";
import {
  chunk,
  columnChoices,
  formatConflict,
  groupSkips,
  isBuyerColumn,
  mergePreviews,
  planReview,
  proposeMapping,
  reviewState,
  schemeText,
} from "./plan";

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

  it("en el informe de saldo de Stripe con source_id, la referencia es source_id (el id del cobro)", () => {
    const headers = headersOf("stripe-saldo-fuente.csv");
    expect(proposeMapping(headers, undefined)).toEqual({
      format: "stripe_saldo",
      mapping: { ...saldo, reference: "source_id" },
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

/** Una fila ya convertida: 100,00 USD el día que se diga. */
const row = (line: number, reference: string, occurredOn = "2026-11-02"): ImportRow => ({
  line,
  reference,
  occurredAt: `${occurredOn}T15:00:00.000Z`,
  occurredOn,
  grossOriginal: "100.00",
  currency: "USD",
  reportedFee: null,
  note: null,
});

const part = (extra: Partial<ImportPreview>): ImportPreview => ({
  today: "2026-11-10",
  estimates: [],
  existing: [],
  manual: [],
  scheme: { kind: "activo", name: "Reparto 50/30/20" },
  ...extra,
});

describe("mergePreviews", () => {
  it("junta las vistas previas de cada lote; un cobro a mano que salió en dos lotes cuenta una vez", () => {
    const manual = { id: "m1", reference: null, currency: "USD", grossOriginal: "100.00", occurredOn: "2026-11-02" };
    const merged = mergePreviews([
      part({
        estimates: [{ line: 2, estimatedDepositOn: "2026-11-04" }],
        existing: [{ reference: "a", trashed: false }],
        manual: [manual],
      }),
      part({
        estimates: [{ line: 3, estimatedDepositOn: "2026-11-12" }],
        existing: [{ reference: "b", trashed: true }],
        manual: [manual],
      }),
    ]);
    expect(merged).toEqual({
      today: "2026-11-10",
      estimates: new Map([
        [2, "2026-11-04"],
        [3, "2026-11-12"],
      ]),
      existing: [
        { reference: "a", trashed: false },
        { reference: "b", trashed: true },
      ],
      manual: [manual],
      scheme: { kind: "activo", name: "Reparto 50/30/20" },
    });
  });
});

describe("planReview", () => {
  const rows = [row(2, "ch_1"), row(3, "ch_2"), row(4, "ch_3", "2026-11-09"), row(5, "ch_4", "2026-11-12")];
  const manual = { id: "m1", reference: null, currency: "USD", grossOriginal: "100.00", occurredOn: "2026-11-12" };
  const preview = mergePreviews([
    part({
      estimates: [
        { line: 2, estimatedDepositOn: "2026-11-04" },
        { line: 3, estimatedDepositOn: "2026-11-04" },
        { line: 4, estimatedDepositOn: "2026-11-10" },
        { line: 5, estimatedDepositOn: "2026-11-16" },
      ],
      existing: [{ reference: "ch_1", trashed: true }],
      manual: [manual],
    }),
  ]);

  it("sin confirmar los posibles repetidos, se mandan las demás filas y se dice cuántas quedan fuera", () => {
    const plan = planReview(rows, preview, { includePossible: false });
    expect(plan.check.trashed).toEqual([rows[0]]);
    expect(plan.check.possible).toEqual([{ row: rows[3], match: manual }]);
    // Lo repetido también viaja: el servidor lo salta y lo cuenta.
    expect(plan.send).toEqual([rows[0], rows[1], rows[2]]);
    expect(plan.heldBack).toBe(1);
    // De las que se crean (líneas 3 y 4): una atrasada (estimada el 4) y dos con la fecha hasta hoy.
    expect(plan.deposit).toEqual({ creating: 2, overdue: 1, dueByToday: 2 });
  });

  it("confirmados, los posibles repetidos también se importan", () => {
    const plan = planReview(rows, preview, { includePossible: true });
    expect(plan.send).toEqual(rows);
    expect(plan.heldBack).toBe(0);
    expect(plan.deposit).toEqual({ creating: 3, overdue: 1, dueByToday: 2 });
  });
});

describe("reviewState", () => {
  const rows = [row(2, "ch_1")];
  const preview = mergePreviews([part({ estimates: [{ line: 2, estimatedDepositOn: "2026-11-12" }] })]);

  it("sin filas convertibles no hay nada que buscar: no se queda «buscando», aunque no haya respuesta", () => {
    expect(reviewState([], null, { includePossible: false })).toEqual({ state: "sin_filas" });
    expect(reviewState([], { error: "x" }, { includePossible: false })).toEqual({ state: "sin_filas" });
  });

  it("con filas: buscando hasta que llega la respuesta, el error tal cual, o el plan", () => {
    expect(reviewState(rows, null, { includePossible: false })).toEqual({ state: "cargando" });
    expect(reviewState(rows, { error: "Se perdió la conexión con el servidor." }, { includePossible: false })).toEqual(
      { state: "error", message: "Se perdió la conexión con el servidor." },
    );
    expect(reviewState(rows, { preview }, { includePossible: false })).toEqual({
      state: "listo",
      preview,
      plan: planReview(rows, preview, { includePossible: false }),
    });
  });
});

describe("schemeText", () => {
  it("nombra el esquema que se aplicará o dice por qué no hay reparto", () => {
    expect(schemeText({ kind: "activo", name: "Reparto 50/30/20" }, "Escuela Demo")).toBe(
      "Reparto: «Reparto 50/30/20», el esquema por defecto de Escuela Demo.",
    );
    expect(schemeText({ kind: "desactivado", name: "Reparto 50/30/20" }, "Escuela Demo")).toBe(
      "Sin reparto: el esquema por defecto está desactivado («Reparto 50/30/20»). Si lo vuelves a activar en Repartos, se aplicará a lo que importes después.",
    );
    expect(schemeText({ kind: "ninguno" }, "Escuela Demo")).toBe(
      "Sin reparto: Escuela Demo no tiene esquema por defecto.",
    );
  });
});

describe("chunk", () => {
  it("parte en lotes del tamaño pedido, en orden", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 500)).toEqual([]);
  });
});
