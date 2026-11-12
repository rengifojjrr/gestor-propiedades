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
  buyerFees: "0.00",
  ...patch,
});

/** Los tres montos de un cobro sin reembolso. */
const monto = (gross: Money, fees: Money, net: Money) => ({ grossOriginal: gross, gross, fees, net });

/** E7: 1040 por algo de 1000, la comisión (30,46) la pagó el comprador. */
const delComprador = tx("c1", {
  ...monto("1040.00", "30.46", "1009.54"),
  feesPaidBy: "comprador",
  buyerFees: "30.46",
});
/** E4: un cobro propio de 100,00 reembolsado del todo; la pasarela se quedó su comisión (3,20). */
const reembolsadoPropio = tx("n1", { refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20" });
/** E8a: E7 reembolsado del todo. El comprador no pagó nada; los 30,46 que se quedó la pasarela, el negocio. */
const e8a = tx("e8a", {
  feesPaidBy: "comprador",
  grossOriginal: "1040.00",
  refunded: "1040.00",
  gross: "0.00",
  fees: "30.46",
  net: "-30.46",
});

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

  it("con cobros del comprador: el % de las comisiones del negocio es de lo facturado", () => {
    // 3,20 ÷ (100,00 + 1009,54) = 0,288… %
    expect(hint([tx("n1"), delComprador])).toBe("0,29 % de lo facturado");
  });

  it("todas las comisiones las pagaron los compradores: al negocio le costó 0 %, y dice por qué", () => {
    expect(hint([delComprador])).toBe("0 % de lo facturado: todas las pagaron los compradores");
  });

  it("un reembolso total propio y un cobro del comprador: lo que retuvo la pasarela cuenta, sobre lo facturado", () => {
    const sums = totals([reembolsadoPropio, delComprador]);
    expect(sums).toMatchObject({ fees: "3.20", buyerFees: "30.46", sale: "1009.54", feePct: "0.32" });
    expect(hint([reembolsadoPropio, delComprador])).toBe("0,32 % de lo facturado");
  });

  it("sin venta (todo reembolsado) no hay %, y lo dice, pague quien pague", () => {
    expect(totals([reembolsadoPropio])).toMatchObject({ gross: "0.00", fees: "3.20", feePct: null });
    expect(hint([reembolsadoPropio])).toBe("Sin venta en el período: no hay %");
    // E8a: los 30,46 son del negocio y los compradores no pagaron nada: no hay %, y no dice que los pagaron ellos.
    expect(totals([e8a])).toMatchObject({ gross: "0.00", fees: "30.46", buyerFees: "0.00", feePct: null });
    expect(hint([e8a])).toBe("Sin venta en el período: no hay %");
  });

  it("sin nada cobrado ni comisiones no hay nada que aclarar", () => {
    const nada = { gross: "0.00", fees: "0.00", buyerFees: "0.00", feePct: null } as const;
    expect(renderToStaticMarkup(createElement(Fragment, null, feesHint(nada)))).toBe("");
  });
});
