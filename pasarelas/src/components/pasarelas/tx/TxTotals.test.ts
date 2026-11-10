import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { totalsOf, type LeanTx } from "@/lib/pasarelas";
import { TxTotals } from "./TxTotals";

function lean(patch: Partial<LeanTx>): LeanTx {
  return {
    id: "tx",
    occurredOn: "2026-11-13",
    companyId: "co",
    channelId: null,
    gatewayId: "gw",
    bankAccountId: null,
    currency: "USD",
    grossOriginal: "100.00",
    refunded: "0.00",
    gross: "100.00",
    fees: "9.70",
    net: "90.30",
    status: "registrado",
    disputeState: null,
    estimatedDepositOn: null,
    estimatedDepositFrom: null,
    depositedOn: null,
    receiptsCount: 0,
    ...patch,
  };
}

const text = (rows: LeanTx[]) =>
  renderToStaticMarkup(createElement(TxTotals, { totals: totalsOf(rows) }))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("TxTotals", () => {
  it("una caja por moneda, con sus cobros, bruto, comisiones y neto: nunca se suman monedas distintas", () => {
    const shown = text([
      lean({ id: "a" }),
      lean({ id: "b" }),
      lean({ id: "c", currency: "MXN", gross: "250.00", fees: "10.00", net: "240.00" }),
    ]);
    expect(shown).toContain("MXN · 1 cobro Bruto 250,00 MXN Comisiones 10,00 MXN Neto 240,00 MXN");
    expect(shown).toContain("USD · 2 cobros Bruto $200,00 Comisiones $19,40 Neto $180,60");
    // Ni 450 ni 420,60: lo de una moneda no se suma con lo de otra.
    expect(shown).not.toMatch(/450|420,60/);
  });

  it("las monedas salen por su código, en orden", () => {
    const shown = text([lean({ id: "u" }), lean({ id: "e", currency: "EUR" }), lean({ id: "m", currency: "MXN" })]);
    expect(shown.indexOf("EUR ·")).toBeLessThan(shown.indexOf("MXN ·"));
    expect(shown.indexOf("MXN ·")).toBeLessThan(shown.indexOf("USD ·"));
  });

  it("dice que son los totales de todo el filtro, sin los fallidos", () => {
    const shown = text([lean({ id: "a" }), lean({ id: "f", status: "fallido", gross: "0.00", fees: "0.00", net: "0.00" })]);
    expect(shown).toContain("Totales del filtro");
    expect(shown).toContain("USD · 1 cobro");
  });

  it("sin cobros que cuenten, no pinta nada", () => {
    expect(text([])).toBe("");
    expect(text([lean({ status: "fallido", gross: "0.00", fees: "0.00", net: "0.00" })])).toBe("");
  });
});
