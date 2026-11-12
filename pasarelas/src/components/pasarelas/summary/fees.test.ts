import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/pasarelas/stats";
import type { LeanTx, Money } from "@/lib/pasarelas/types";
import { feesHint } from "./fees";

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
  fees: "3.20",
  net: "96.80",
  status: "registrado",
  disputeState: null,
  estimatedDepositOn: null,
  estimatedDepositFrom: null,
  depositedOn: null,
  receiptsCount: 0,
  feesPaidBy: "nosotros",
  ...patch,
});

/** Los tres montos de un cobro sin reembolso. */
const monto = (gross: Money, fees: Money, net: Money) => ({ grossOriginal: gross, gross, fees, net });

/** E7: 1040 por algo de 1000, la comisión (30,46) la pagó el comprador. */
const delComprador = tx("c1", { ...monto("1040.00", "30.46", "1009.54"), feesPaidBy: "comprador" });
/** E4: un cobro propio de 100,00 reembolsado del todo; la pasarela se quedó su comisión (3,20). */
const reembolsadoPropio = tx("n1", { refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20" });

/** Los totales en USD de esos cobros, como los arma el Resumen. */
function totals(rows: readonly LeanTx[]) {
  const usd = summarize(rows, HOY).USD;
  if (usd === undefined) throw new Error("Faltan los totales en USD");
  return usd.totals;
}

/** El texto que ve la persona (sin etiquetas); "" si no hay aclaración. */
const hint = (rows: readonly LeanTx[]) =>
  renderToStaticMarkup(createElement(Fragment, null, feesHint(totals(rows))))
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("feesHint", () => {
  it("sin cobros del comprador: el % de siempre, del bruto", () => {
    expect(hint([tx("n1")])).toBe("3,2 % del bruto");
  });

  it("con cobros del comprador: el % es del bruto en que las pagamos", () => {
    expect(hint([tx("n1"), delComprador])).toBe("3,2 % del bruto en que las pagamos");
  });

  it("todas las comisiones las pagaron los compradores: lo dice", () => {
    expect(hint([delComprador])).toBe("Todas las pagaron los compradores");
  });

  it("un reembolso total propio y un cobro del comprador: el negocio sí pagó comisiones, no lo niega", () => {
    const sums = totals([reembolsadoPropio, delComprador]);
    // Sin bruto propio no hay %, pero el negocio pagó los 3,20 que retuvo la pasarela.
    expect(sums).toMatchObject({ fees: "3.20", buyerFees: "30.46", feePct: null });
    expect(hint([reembolsadoPropio, delComprador])).toBe("");
  });

  it("sin bruto propio y sin compradores: nada que aclarar", () => {
    expect(hint([reembolsadoPropio])).toBe("");
  });
});
