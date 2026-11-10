import { describe, expect, test } from "vitest";
import { planCreate, planDeposit, planRefund, planRevertDeposit } from "@/lib/pasarelas";
import type { TxSnapshot, TxWrite } from "@/lib/pasarelas";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import { toRpcItem } from "./tx-save";

/** El alta del cobro E1 del spec, planeada por el motor. */
function createE1(): TxWrite {
  return planCreate(cfgDemo(), {
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
    reference: "ch_demo_0001",
    note: null,
  });
}

/** E1 como se leería de la base después de guardarlo. */
function savedE1(): TxSnapshot {
  const { fields } = createE1();
  if (fields.breakdown === undefined) throw new Error("El plan de alta no trae desglose");
  return {
    id: "tx-e1",
    occurredOn: "2026-11-13",
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
    occurredAt: "2026-11-13T15:30:00+00:00",
    schemeId: DEMO.schemeId,
    reference: "ch_demo_0001",
    note: null,
    estimatedIsManual: false,
    disputeOpenedOn: null,
    disputeClosedOn: null,
    deletedAt: null,
    updatedAt: "2026-11-13T15:31:07.847283+00:00",
    breakdown: fields.breakdown,
  };
}

/** Dónde hay un `number` dentro de un valor: «tx.breakdown.v». */
function numberPaths(value: unknown, path = ""): string[] {
  if (typeof value === "number") return [path];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => numberPaths(child, path === "" ? key : `${path}.${key}`));
}

describe("toRpcItem", () => {
  test("un alta: todas las columnas con su nombre de la base, el dinero como texto, el reparto y el evento", () => {
    const write = createE1();
    const item = toRpcItem(write);

    expect(item.mode).toBe("insert");
    expect(item.expected_updated_at).toBeNull();
    expect(item.tx).toEqual({
      id: "tx-e1",
      occurred_at: "2026-11-13T15:30:00Z",
      occurred_on: "2026-11-13",
      company_id: DEMO.companyId,
      channel_id: DEMO.channelId,
      gateway_id: DEMO.gatewayId,
      currency: "USD",
      gross_original: "100.00",
      refunded_amount: "0.00",
      gross_amount: "100.00",
      fees_total: "9.70",
      net_amount: "90.30",
      alloc_base: "neto",
      alloc_base_amount: "90.30",
      breakdown: write.fields.breakdown,
      fee_version_id: DEMO.feeVersionId,
      scheme_id: DEMO.schemeId,
      scheme_version_id: DEMO.schemeVersionId,
      reference: "ch_demo_0001",
      note: null,
      status: "registrado",
      dispute_state: null,
      dispute_opened_on: null,
      dispute_closed_on: null,
      estimated_deposit_on: "2026-11-13",
      estimated_deposit_from: null,
      estimated_is_manual: false,
      deposited_on: null,
      bank_account_id: DEMO.bankAccountId,
      deleted_at: null,
    });
    expect(item.allocations).toEqual([
      { beneficiary_id: DEMO.beneficiaryIds.a, amount: "45.15", base: "neto", pct: "50", is_remainder: false },
      { beneficiary_id: DEMO.beneficiaryIds.b, amount: "27.09", base: "neto", pct: "30", is_remainder: false },
      { beneficiary_id: DEMO.beneficiaryIds.c, amount: "18.06", base: "neto", pct: "20", is_remainder: false },
    ]);
    expect(item.event).toEqual(write.event);
    // Ni un monto ni un porcentaje viajan como number: los únicos números son la versión del desglose y unos días.
    expect(numberPaths(item).sort()).toEqual(["tx.breakdown.rules.extras.0.payoutDaysOverride", "tx.breakdown.v"]);
  });

  test("un cambio que no toca los números: solo sus columnas, el control optimista y sin reparto", () => {
    const tx = savedE1();
    const item = toRpcItem(planDeposit(tx, "2026-11-17"));

    expect(item).toEqual({
      mode: "update",
      tx: { id: "tx-e1", status: "depositado", deposited_on: "2026-11-17" },
      // Tal cual se leyó, con sus microsegundos.
      expected_updated_at: "2026-11-13T15:31:07.847283+00:00",
      // null = «no toques el reparto» (una lista vacía lo borraría).
      allocations: null,
      event: expect.objectContaining({ kind: "depositado", summary: "Depositado el mar 17 nov 2026" }) as unknown,
    });
  });

  test("una columna que se vacía viaja con null, no desaparece", () => {
    const deposited = { ...savedE1(), status: "depositado" as const, depositedOn: "2026-11-17" };
    const item = toRpcItem(planRevertDeposit(deposited));

    expect(item.tx).toEqual({ id: "tx-e1", status: "en_transito", deposited_on: null });
    expect(JSON.parse(JSON.stringify(item.tx))).toEqual({ id: "tx-e1", status: "en_transito", deposited_on: null });
  });

  test("un cambio que mueve los números lleva el reparto nuevo", () => {
    const item = toRpcItem(planRefund(savedE1(), { amount: "40.00", on: "2026-11-16" }));

    expect(Object.keys(item.tx).sort()).toEqual([
      "alloc_base_amount",
      "breakdown",
      "fees_total",
      "gross_amount",
      "id",
      "net_amount",
      "refunded_amount",
    ]);
    expect(item.tx).toMatchObject({ refunded_amount: "40.00", gross_amount: "60.00", net_amount: "52.90" });
    expect(item.allocations?.map((line) => line.amount)).toEqual(["26.45", "15.87", "10.58"]);
  });
});
