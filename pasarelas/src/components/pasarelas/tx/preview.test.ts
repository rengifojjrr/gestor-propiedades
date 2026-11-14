import { describe, expect, test } from "vitest";
import { parseBreakdown } from "@/lib/pasarelas/breakdown";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import { planCreate, planDispute, planRefund, planRefundTotal } from "@/lib/pasarelas/write";
import type { TxSnapshot, TxWrite } from "@/lib/pasarelas/types";
import { previewChange } from "./preview";

/** E1 guardado: 100,00 por Stripe con «Pago rápido» y el canal al 5 %, repartido 50/30/20; disputa a 15,00. */
function savedE1(): TxSnapshot {
  const { fields: f } = planCreate(cfgDemo(), {
    id: "tx-e1",
    companyId: DEMO.companyId,
    channelId: DEMO.channelId,
    gatewayId: DEMO.gatewayId,
    extraIds: [DEMO.extraId],
    schemeId: DEMO.schemeId,
    occurredOn: "2026-11-13",
    occurredAt: "2026-11-13T15:30:00Z",
    currency: "USD",
    grossOriginal: "100.00",
    reference: null,
    note: null,
  });
  const b = parseBreakdown(JSON.parse(JSON.stringify(f.breakdown)));
  return {
    id: "tx-e1",
    occurredAt: "2026-11-13T15:30:00Z",
    occurredOn: "2026-11-13",
    companyId: DEMO.companyId,
    channelId: DEMO.channelId,
    gatewayId: DEMO.gatewayId,
    bankAccountId: DEMO.bankAccountId,
    currency: "USD",
    grossOriginal: b.state.grossOriginal,
    refunded: b.state.refunded,
    gross: b.gross,
    fees: b.feesTotal,
    net: b.net,
    status: "registrado",
    disputeState: null,
    estimatedDepositOn: "2026-11-13",
    estimatedDepositFrom: null,
    depositedOn: null,
    receiptsCount: 0,
    feesPaidBy: "nosotros",
    buyerFees: "0.00",
    retention: "0.00",
    schemeId: DEMO.schemeId,
    reference: null,
    note: null,
    estimatedIsManual: false,
    disputeOpenedOn: null,
    disputeClosedOn: null,
    deletedAt: null,
    updatedAt: "2026-11-13T15:31:00Z",
    breakdown: b,
  };
}

/** El cobro con un cambio ya guardado: el desglose nuevo (otra copia, como la devuelve la base) y sus columnas. */
function applied(tx: TxSnapshot, plan: (tx: TxSnapshot) => TxWrite): TxSnapshot {
  const { breakdown } = plan(tx).fields;
  if (breakdown === undefined) throw new Error("El plan no cambió el desglose.");
  const b = parseBreakdown(JSON.parse(JSON.stringify(breakdown)));
  return { ...tx, refunded: b.state.refunded, gross: b.gross, fees: b.feesTotal, net: b.net, breakdown: b };
}

/** Las filas del antes y el después como «concepto: antes → después», fáciles de leer en la prueba. */
const rows = (result: ReturnType<typeof previewChange>): string[] => {
  if (!result.ok) throw new Error(result.error);
  return result.changes.map((row) => `${row.label}: ${row.before} → ${row.after}`);
};

describe("previewChange", () => {
  test("E5: el reembolso parcial de 40,00 sobre E1, fila por fila", () => {
    const tx = savedE1();
    expect(rows(previewChange(tx, (t) => planRefund(t, { amount: "40.00", on: "2026-11-15" })))).toEqual([
      "Bruto: 100.00 → 60.00",
      "Stripe: 3.20 → 2.04",
      "Costo del reembolso: — → 1.16",
      "Pago rápido: 1.50 → 0.90",
      "Escuela de marketing: 5.00 → 3.00",
      "Comisiones: 9.70 → 7.10",
      "Neto: 90.30 → 52.90",
      "Grupo A: 45.15 → 26.45",
      "Grupo B: 27.09 → 15.87",
      "Grupo C: 18.06 → 10.58",
    ]);
  });

  test("E6: abrir la disputa suma su costo, el congelado en el desglose", () => {
    const tx = savedE1();
    expect(rows(previewChange(tx, (t) => planDispute(t, { action: "abrir", on: "2026-11-16" })))).toEqual([
      "Costo de disputa: — → 15.00",
      "Comisiones: 9.70 → 24.70",
      "Neto: 90.30 → 75.30",
      "Grupo A: 45.15 → 37.65",
      "Grupo B: 27.09 → 22.59",
      "Grupo C: 18.06 → 15.06",
    ]);
  });

  test("corregir el total reembolsado de E1 de 40,00 a 30,00 reemplaza lo reembolsado, no le suma", () => {
    const refunded = applied(savedE1(), (t) => planRefund(t, { amount: "40.00", on: "2026-11-15" }));
    expect(rows(previewChange(refunded, (t) => planRefundTotal(t, "30.00")))).toEqual([
      "Bruto: 60.00 → 70.00",
      "Stripe: 2.04 → 2.33",
      "Costo del reembolso: 1.16 → 0.87",
      "Pago rápido: 0.90 → 1.05",
      "Escuela de marketing: 3.00 → 3.50",
      "Comisiones: 7.10 → 7.75",
      "Neto: 52.90 → 62.25",
      "Grupo A: 26.45 → 31.13",
      "Grupo B: 15.87 → 18.67",
      "Grupo C: 10.58 → 12.45",
    ]);
  });

  test("lo que no cambia ningún número no tiene filas", () => {
    const tx = savedE1();
    expect(previewChange(tx, (t) => planRefundTotal(t, "0.00"))).toEqual({ ok: true, changes: [] });
  });

  test("lo que el motor no acepta llega como su mensaje", () => {
    const tx = savedE1();
    expect(previewChange(tx, (t) => planRefund(t, { amount: "100.01", on: "2026-11-15" }))).toEqual({
      ok: false,
      error: "Lo reembolsado no puede pasar de lo cobrado.",
    });
    expect(previewChange(tx, (t) => planDispute(t, { action: "ganar", on: "2026-11-16" }))).toEqual({
      ok: false,
      error: "El cobro no tiene una disputa abierta.",
    });
  });

  test("cualquier otro error sigue su camino", () => {
    const tx = savedE1();
    expect(() =>
      previewChange(tx, () => {
        throw new TypeError("otra cosa");
      }),
    ).toThrow(TypeError);
  });
});
