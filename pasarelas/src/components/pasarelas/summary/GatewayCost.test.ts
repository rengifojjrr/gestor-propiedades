import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/pasarelas/stats";
import type { LeanTx, Money } from "@/lib/pasarelas/types";
import { GatewayCost } from "./GatewayCost";

const HOY = "2026-11-09";
const NAMES: Record<string, string> = { "pas-stripe": "Stripe", "pas-paypal": "PayPal" };

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

/** 60,00 por PayPal cuya comisión (2,04) pagó el comprador. */
const paypalDelComprador = tx("p1", {
  gatewayId: "pas-paypal",
  ...monto("60.00", "2.04", "57.96"),
  feesPaidBy: "comprador",
  buyerFees: "2.04",
});
/** E7: 1040 por Stripe cuya comisión (30,46) pagó el comprador. */
const stripeDelComprador = tx("c1", { ...monto("1040.00", "30.46", "1009.54"), feesPaidBy: "comprador", buyerFees: "30.46" });
/** E4: un cobro propio de 100,00 por Stripe reembolsado del todo; la pasarela se quedó su comisión (3,20). */
const reembolsadoPropio = tx("n2", { refunded: "100.00", gross: "0.00", fees: "3.20", net: "-3.20" });

/** El texto del resumen del gráfico y las filas de su tabla, como los ve la persona. */
function view(rows: readonly LeanTx[]): { summary: string; header: string[]; body: string[][] } {
  const usd = summarize(rows, HOY).USD;
  if (usd === undefined) throw new Error("Faltan los totales en USD");
  const markup = renderToStaticMarkup(
    createElement(GatewayCost, { summary: usd, currency: "USD", nameOf: (id: string) => NAMES[id] ?? id }),
  );
  const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const summary = plain(/<figcaption[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(markup)?.[1] ?? "");
  const tableMarkup = /<table[\s\S]*<\/table>/.exec(markup)?.[0] ?? "";
  const cells = (row: string) => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((cell) => plain(cell[1] ?? ""));
  const [header = [], ...body] = [...tableMarkup.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((row) => cells(row[1] ?? ""));
  return { summary, header, body };
}

describe("GatewayCost", () => {
  it("sin compradores, lo de siempre: comisiones sobre el bruto", () => {
    const paypal = tx("p2", { gatewayId: "pas-paypal", ...monto("100.00", "3.40", "96.60") });
    expect(view([tx("n1"), paypal])).toEqual({
      summary: "La más cara es Stripe: se lleva el 9,7 % del bruto ( $9,70 ); la más barata, PayPal, el 3,4 % .",
      header: ["Pasarela", "Bruto", "Comisiones", "Costo efectivo"],
      body: [
        ["Stripe", "$100,00", "$9,70", "9,7 %"],
        ["PayPal", "$100,00", "$3,40", "3,4 %"],
      ],
    });
  });

  it("una pasarela cuyas comisiones pagaron todas los compradores cuesta 0 % de lo facturado, y dice por qué", () => {
    expect(view([tx("n1"), paypalDelComprador])).toEqual({
      summary:
        "La más cara es Stripe: se lleva el 9,7 % de lo facturado ( $9,70 ); la más barata, PayPal, el 0 % . " +
        "Las comisiones de PayPal las pagaron los compradores: al negocio no le costó nada. " +
        "Solo cuentan las comisiones que pagó el negocio.",
      header: ["Pasarela", "Facturado", "Comisiones", "Costo efectivo"],
      body: [
        ["Stripe", "$100,00", "$9,70", "9,7 %"],
        ["PayPal", "$57,96", "$0,00", "0 % las pagaron los compradores"],
      ],
    });
  });

  it("no dice «todo se reembolsó» de una pasarela a la que le quedó bruto: su costo es sobre lo facturado", () => {
    // Stripe: un cobro propio reembolsado del todo (el negocio pagó los 3,20 que retuvo) y E7 del comprador.
    const { summary, body } = view([reembolsadoPropio, stripeDelComprador]);
    expect(summary).toBe(
      "Las comisiones de Stripe se llevaron el 0,32 % de lo facturado ( $3,20 ). " +
        "Solo cuentan las comisiones que pagó el negocio.",
    );
    expect(summary).not.toContain("reembols");
    expect(body).toEqual([["Stripe", "$1.009,54", "$3,20", "0,32 %"]]);
  });

  it("sin venta pero con bruto: no hay %, y no se dice que todo se reembolsó", () => {
    // 1040 con 1039,90 reembolsados: quedan 0,10 y la comisión del comprador sobre ellos es la fija (0,30).
    const casiTodo = tx("x", {
      feesPaidBy: "comprador",
      grossOriginal: "1040.00",
      refunded: "1039.90",
      gross: "0.10",
      fees: "30.46",
      buyerFees: "0.30",
      net: "-30.36",
    });
    const { summary, body } = view([casiTodo]);
    expect(summary).toBe(
      "Ninguna pasarela tiene un costo efectivo que comparar. Stripe no tiene venta en el período: sin costo " +
        "efectivo, no se dibuja.",
    );
    expect(body).toEqual([["Stripe", "-$0,20", "$30,16", "Sin venta"]]);
  });

  it("sin bruto en el período (todo reembolsado): lo de siempre", () => {
    expect(view([reembolsadoPropio])).toEqual({
      summary: "Ninguna pasarela tiene bruto en el período: no hay costo efectivo que comparar.",
      header: ["Pasarela", "Bruto", "Comisiones", "Costo efectivo"],
      body: [["Stripe", "$0,00", "$3,20", "Sin bruto"]],
    });
    const paypal = tx("p2", { gatewayId: "pas-paypal", ...monto("100.00", "3.40", "96.60") });
    expect(view([reembolsadoPropio, paypal]).summary).toBe(
      "Las comisiones de PayPal se llevaron el 3,4 % del bruto ( $3,40 ). Stripe no tiene bruto en el período " +
        "(todo se reembolsó): sin costo efectivo, no se dibuja.",
    );
  });
});
