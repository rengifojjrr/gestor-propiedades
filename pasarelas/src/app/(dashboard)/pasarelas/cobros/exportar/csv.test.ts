import { describe, expect, it } from "vitest";
import { CSV_ES, CSV_STD } from "@/lib/pasarelas";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import type { TxListItem } from "@/server/pasarelas/dto";
import { TX_CSV_HEADER, csvFormatOf, txCsv } from "./csv";

/** El cobro E1 del spec tal como lo entrega la lista: 100,00 · comisiones 9,70 · neto 90,30. */
function e1(patch: Partial<TxListItem> = {}): TxListItem {
  return {
    id: "tx-e1",
    occurredOn: "2026-11-13",
    occurredAt: "2026-11-13T15:30:00+00:00",
    companyId: DEMO.companyId,
    channelId: DEMO.channelId,
    gatewayId: DEMO.gatewayId,
    bankAccountId: DEMO.bankAccountId,
    currency: "USD",
    grossOriginal: "100.00",
    refunded: "0.00",
    gross: "100.00",
    fees: "9.70",
    net: "90.30",
    status: "registrado",
    disputeState: null,
    estimatedDepositOn: "2026-11-13",
    estimatedDepositFrom: null,
    depositedOn: null,
    receiptsCount: 0,
    feesPaidBy: "nosotros",
    buyerFees: "0.00",
    schemeId: DEMO.schemeId,
    reference: "pi_demo_1",
    note: null,
    estimatedIsManual: false,
    disputeOpenedOn: null,
    disputeClosedOn: null,
    deletedAt: null,
    updatedAt: "2026-11-13T15:30:00.123456+00:00",
    ...patch,
  };
}

/** Las líneas del CSV, sin el BOM y sin la última (vacía, tras el último salto de línea). */
const lines = (csv: string): string[] => csv.replace(/^﻿/, "").split("\r\n").slice(0, -1);

describe("csvFormatOf", () => {
  it("«estandar» es el formato de siempre; cualquier otra cosa (o nada), el español", () => {
    expect(csvFormatOf("estandar")).toBe(CSV_STD);
    expect(csvFormatOf("es")).toBe(CSV_ES);
    expect(csvFormatOf(null)).toBe(CSV_ES);
    expect(csvFormatOf("otra-cosa")).toBe(CSV_ES);
  });
});

describe("txCsv", () => {
  it("en español: BOM, punto y coma, coma decimal en el dinero y en el porcentaje, y los nombres resueltos", () => {
    const csv = txCsv([e1()], cfgDemo(), CSV_ES);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines(csv)).toEqual([
      TX_CSV_HEADER.join(";"),
      "2026-11-13;Escuela Demo;Escuela de marketing;Stripe;pi_demo_1;USD;100,00;0,00;100,00;9,70;9,7;90,30;Registrado;2026-11-13;;;Cuenta principal;0;;2026-11-13;Nosotros;0,00",
    ]);
  });

  it("estándar: sin BOM, coma entre columnas y punto decimal", () => {
    const csv = txCsv([e1()], cfgDemo(), CSV_STD);
    expect(csv.startsWith("﻿")).toBe(false);
    expect(lines(csv)[1]).toBe(
      "2026-11-13,Escuela Demo,Escuela de marketing,Stripe,pi_demo_1,USD,100.00,0.00,100.00,9.70,9.7,90.30,Registrado,2026-11-13,,,Cuenta principal,0,,2026-11-13,Nosotros,0.00",
    );
  });

  it("encabezado: qué es cada columna, sin datos de compradores", () => {
    expect(TX_CSV_HEADER).toEqual([
      "Fecha",
      "Empresa",
      "Canal",
      "Pasarela",
      "Referencia",
      "Moneda",
      "Bruto original",
      "Reembolsado",
      "Bruto",
      "Comisiones",
      "% de comisiones",
      "Neto",
      "Estado",
      "Fecha estimada",
      "Fecha del depósito",
      "Días hasta el depósito",
      "Cuenta destino",
      "Comprobantes",
      "Nota",
      "Fecha estimada (desde)",
      "Comisión pagada por",
      "Comisiones pagadas por los compradores",
    ]);
  });

  it("quién pagó la comisión y cuánto pagaron los compradores, al final", () => {
    // E8b: 1040 que pagó el comprador, con 520 reembolsados: el comprador pagó 15,38 de los 30,46 de comisiones.
    const e8b = e1({
      id: "tx-c",
      feesPaidBy: "comprador",
      grossOriginal: "1040.00",
      refunded: "520.00",
      gross: "520.00",
      fees: "30.46",
      net: "489.54",
      buyerFees: "15.38",
    });
    const rows = lines(txCsv([e1(), e8b], cfgDemo(), CSV_ES)).slice(1);
    expect(rows.map((row) => row.split(";").slice(20))).toEqual([
      ["Nosotros", "0,00"],
      ["El comprador", "15,38"],
    ]);
  });

  it("una ventana de depósito: «Fecha estimada» es la más tardía y «Fecha estimada (desde)», la más temprana", () => {
    const row = lines(
      txCsv([e1({ estimatedDepositFrom: "2026-11-16", estimatedDepositOn: "2026-11-18" })], cfgDemo(), CSV_ES),
    )[1];
    const cells = row?.split(";") ?? [];
    expect([cells[13], cells[19]]).toEqual(["2026-11-18", "2026-11-16"]);
  });

  it("un depositado lleva su fecha y los días de calendario que tardó", () => {
    const row = lines(
      txCsv([e1({ status: "depositado", depositedOn: "2026-11-17", receiptsCount: 2 })], cfgDemo(), CSV_ES),
    )[1];
    expect(row?.split(";").slice(12)).toEqual([
      "Depositado",
      "2026-11-13",
      "2026-11-17",
      "4",
      "Cuenta principal",
      "2",
      "",
      "2026-11-13",
      "Nosotros",
      "0,00",
    ]);
  });

  it("el estado es el visible del motor: en disputa, reembolsado del todo o fallido", () => {
    const states = [
      e1({ disputeState: "abierta" }),
      e1({ refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20" }),
      e1({ status: "fallido", gross: "0.00", fees: "0.00", net: "0.00" }),
    ];
    const rows = lines(txCsv(states, cfgDemo(), CSV_ES)).slice(1);
    expect(rows.map((row) => row.split(";")[12])).toEqual(["En disputa", "Reembolsado", "Fallido"]);
    // Sin bruto vigente, el porcentaje de comisiones no existe: la celda va vacía. Los negativos, tal cual.
    expect(rows[1]?.split(";").slice(6, 12)).toEqual(["100,00", "100,00", "0,00", "3,20", "", "-3,20"]);
  });

  it("lo que no tiene valor va vacío: sin canal, sin referencia, sin cuenta y sin fecha estimada", () => {
    const row = lines(
      txCsv(
        [e1({ channelId: null, reference: null, bankAccountId: null, estimatedDepositOn: null })],
        cfgDemo(),
        CSV_ES,
      ),
    )[1];
    const cells = row?.split(";") ?? [];
    expect([cells[2], cells[4], cells[13], cells[16], cells[19]]).toEqual(["", "", "", "", ""]);
  });

  it("cada moneda con sus montos: nunca se mezclan ni se convierten", () => {
    const rows = lines(txCsv([e1(), e1({ id: "tx-mx", currency: "MXN", reference: "mx_1" })], cfgDemo(), CSV_ES));
    expect(rows.slice(1).map((row) => row.split(";").slice(4, 7))).toEqual([
      ["pi_demo_1", "USD", "100,00"],
      ["mx_1", "MXN", "100,00"],
    ]);
  });

  it("una nota o una referencia que parece fórmula sale como texto", () => {
    const row = lines(txCsv([e1({ reference: "=1+1", note: "@SUMA(A1)" })], cfgDemo(), CSV_ES))[1];
    expect(row?.split(";")[4]).toBe("'=1+1");
    expect(row?.split(";")[18]).toBe("'@SUMA(A1)");
  });

  it("sin cobros, solo el encabezado", () => {
    expect(lines(txCsv([], cfgDemo(), CSV_STD))).toEqual([TX_CSV_HEADER.join(",")]);
  });
});
