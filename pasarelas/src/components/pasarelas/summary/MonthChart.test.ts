import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/pasarelas/stats";
import type { LeanTx, Money } from "@/lib/pasarelas/types";
import { monthRows } from "@/server/pasarelas/queries/summary";
import { MonthChart } from "./MonthChart";

const HOY = "2026-11-09";

/** Un cobro de 100,00 por Stripe, con la comisión a cargo del negocio; cada prueba cambia lo que le importa. */
const tx = (id: string, patch: Partial<LeanTx> = {}): LeanTx => ({
  id,
  occurredOn: HOY,
  companyId: "emp-tienda",
  channelId: null,
  gatewayId: "pas-stripe",
  bankAccountId: "cta-a",
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
  feesPaidBy: "nosotros",
  buyerFees: "0.00",
  retention: "0.00",
  ...patch,
});

/** Los tres montos de un cobro sin reembolso. */
const monto = (gross: Money, fees: Money, net: Money) => ({ grossOriginal: gross, gross, fees, net });

/** E7: 1040 por algo de 1000; la comisión (30,46) la pagó el comprador. */
const delComprador = tx("c1", { ...monto("1040.00", "30.46", "1009.54"), feesPaidBy: "comprador", buyerFees: "30.46" });

/** La tabla «Bruto y neto por mes» de esos cobros (de octubre a noviembre), como la arma el Resumen. */
function table(rows: readonly LeanTx[]): { header: string[]; body: string[][] } {
  const usd = summarize(rows, HOY).USD;
  if (usd === undefined) throw new Error("Faltan los totales en USD");
  const months = monthRows({ from: "2026-10-01", to: HOY }, usd.byMonth);
  const markup = renderToStaticMarkup(createElement(MonthChart, { months, totals: usd.totals, currency: "USD" }));
  const tableMarkup = /<table[\s\S]*<\/table>/.exec(markup)?.[0] ?? "";
  const cells = (row: string) =>
    [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => (cell[1] ?? "").replace(/<[^>]+>/g, "").trim());
  const [header = [], ...body] = [...tableMarkup.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => cells(row[1] ?? ""));
  return { header, body };
}

describe("MonthChart: la tabla «Bruto y neto por mes»", () => {
  it("sin comisiones de compradores, como siempre: Bruto − Comisiones = Neto", () => {
    expect(table([tx("n1")])).toEqual({
      header: ["Mes", "Bruto", "Comisiones", "Neto", "Cobros"],
      body: [
        ["oct 2026", "$0,00", "$0,00", "$0,00", "0"],
        ["nov 2026", "$100,00", "$9,70", "$90,30", "1"],
      ],
    });
  });

  it("con comisiones de compradores suma su columna: Bruto − Comisiones − De los compradores = Neto", () => {
    expect(table([tx("n1"), delComprador])).toEqual({
      header: ["Mes", "Bruto", "Comisiones", "De los compradores", "Neto", "Cobros"],
      body: [
        ["oct 2026", "$0,00", "$0,00", "$0,00", "$0,00", "0"],
        // 1140,00 − 9,70 − 30,46 = 1099,84
        ["nov 2026", "$1.140,00", "$9,70", "$30,46", "$1.099,84", "2"],
      ],
    });
  });
});
