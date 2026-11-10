import { describe, expect, test } from "vitest";
import { planCreate } from "@/lib/pasarelas";
import type { Breakdown } from "@/lib/pasarelas";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import type { Json } from "@/lib/supabase/types";
import * as dto from "./dto";
import {
  toLeanTx,
  toPayConfig,
  toTxDetail,
  toTxListItem,
  toTxSnapshot,
  type ConfigRows,
  type LeanTxRow,
  type TxListRow,
  type TxRow,
} from "./dto";

/** El desglose del cobro E1 del spec, calculado por el motor. */
function breakdownE1(): Breakdown {
  const write = planCreate(cfgDemo(), {
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
  if (write.fields.breakdown === undefined) throw new Error("El plan de alta no trae desglose");
  return write.fields.breakdown;
}

/** La fila mínima de E1 tal como llega de PostgREST con las columnas de `LEAN_TX_COLUMNS`. */
function leanRow(patch: Partial<LeanTxRow> = {}): LeanTxRow {
  return {
    id: "tx-e1",
    occurred_on: "2026-11-13",
    company_id: DEMO.companyId,
    channel_id: DEMO.channelId,
    gateway_id: DEMO.gatewayId,
    bank_account_id: DEMO.bankAccountId,
    currency: "USD",
    gross_original: "100.00",
    refunded_amount: "0.00",
    gross_amount: "100.00",
    fees_total: "9.70",
    net_amount: "90.30",
    status: "registrado",
    dispute_state: null,
    estimated_deposit_on: "2026-11-13",
    deposited_on: null,
    receipts_count: 0,
    ...patch,
  };
}

function listRow(patch: Partial<TxListRow> = {}): TxListRow {
  return {
    ...leanRow(),
    occurred_at: "2026-11-13T15:30:00+00:00",
    scheme_id: DEMO.schemeId,
    reference: "ch_demo_0001",
    note: null,
    estimated_is_manual: false,
    dispute_opened_on: null,
    dispute_closed_on: null,
    deleted_at: null,
    updated_at: "2026-11-13T15:31:07.847283+00:00",
    ...patch,
  };
}

/** El desglose como vuelve de la base: otra copia, pasada por JSON. */
const asJson = (b: Breakdown): Json => JSON.parse(JSON.stringify(b)) as Json;

const txRow = (patch: Partial<TxRow> = {}): TxRow => ({ ...listRow(), breakdown: asJson(breakdownE1()), ...patch });

describe("las listas de columnas", () => {
  test("todo numeric de dinero o de porcentaje se pide como texto", () => {
    const lists = Object.entries(dto).flatMap(([name, value]): [string, string][] =>
      name.endsWith("_COLUMNS") && typeof value === "string" ? [[name, value]] : [],
    );
    expect(lists.length).toBeGreaterThanOrEqual(15);
    const decimal =
      /^(pct|fixed|platform_fee_pct|platform_fee_fixed|dispute_fee|amount|gross_original|refunded_amount|gross_amount|fees_total|net_amount|alloc_base_amount)$/;
    for (const [name, list] of lists) {
      for (const column of list.split(",").map((part) => part.trim())) {
        expect(column, `${name}: «${column}» sin ::text`).not.toMatch(decimal);
        expect(column, `${name}: nada de select *`).not.toBe("*");
      }
    }
    expect(dto.LEAN_TX_COLUMNS).toContain("net_amount::text");
    expect(dto.TX_COLUMNS).toContain("breakdown");
    expect(dto.TX_LIST_COLUMNS).not.toContain("breakdown");
  });
});

describe("toLeanTx", () => {
  test("la fila de E1, con los nombres del motor", () => {
    expect(toLeanTx(leanRow())).toEqual({
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
      depositedOn: null,
      receiptsCount: 0,
    });
  });

  test("los montos salen canónicos, vengan como vengan escritos", () => {
    const lean = toLeanTx(
      leanRow({ gross_original: "100", fees_total: "9.7", net_amount: "-3.2", refunded_amount: "0" }),
    );
    expect([lean.grossOriginal, lean.fees, lean.net, lean.refunded]).toEqual(["100.00", "9.70", "-3.20", "0.00"]);
  });

  test("un number que se cuela (una columna sin ::text) se lee por su texto, sin aritmética", () => {
    const row = leanRow({ net_amount: 90.3 as unknown as string, gross_amount: 100 as unknown as string });
    const lean = toLeanTx(row);
    expect([lean.net, lean.gross]).toEqual(["90.30", "100.00"]);
  });

  test("lo que no es un decimal finito no pasa por monto", () => {
    expect(() => toLeanTx(leanRow({ net_amount: "1e21" }))).toThrow(RangeError);
    expect(() => toLeanTx(leanRow({ net_amount: null as unknown as string }))).toThrow(RangeError);
    expect(() => toLeanTx(leanRow({ gross_amount: Number.NaN as unknown as string }))).toThrow(RangeError);
  });

  test("un estado o una disputa que el motor no conoce no se cuelan como si fueran válidos", () => {
    expect(() => toLeanTx(leanRow({ status: "congelado" }))).toThrow("Estado del cobro desconocido: «congelado»");
    expect(() => toLeanTx(leanRow({ dispute_state: "en_revision" }))).toThrow("Estado de la disputa desconocido");
    expect(
      toLeanTx(leanRow({ status: "depositado", dispute_state: "ganada", deposited_on: "2026-11-16" })),
    ).toMatchObject({
      status: "depositado",
      disputeState: "ganada",
      depositedOn: "2026-11-16",
    });
  });
});

describe("toTxListItem", () => {
  test("la fila mínima más lo que pinta la lista; el instante y updated_at van tal cual, sin retocar", () => {
    const item = toTxListItem(listRow({ note: "Pagó en dos partes", deleted_at: "2026-11-14T10:00:00.123456+00:00" }));
    expect(item).toEqual({
      ...toLeanTx(leanRow()),
      occurredAt: "2026-11-13T15:30:00+00:00",
      schemeId: DEMO.schemeId,
      reference: "ch_demo_0001",
      note: "Pagó en dos partes",
      estimatedIsManual: false,
      disputeOpenedOn: null,
      disputeClosedOn: null,
      deletedAt: "2026-11-14T10:00:00.123456+00:00",
      // Con sus microsegundos: es lo que compara el control optimista de la base.
      updatedAt: "2026-11-13T15:31:07.847283+00:00",
    });
    expect("breakdown" in item).toBe(false);
  });
});

describe("toTxSnapshot", () => {
  test("lo de la lista más el desglose congelado, validado", () => {
    const snapshot = toTxSnapshot(txRow());
    expect(snapshot).toEqual({ ...toTxListItem(listRow()), breakdown: breakdownE1() });
    expect(snapshot.breakdown.net).toBe("90.30");
  });

  test("un desglose que no tiene la forma de la versión 1 no pasa", () => {
    expect(() => toTxSnapshot(txRow({ breakdown: { v: 1, currency: "USD", net: "90.30" } }))).toThrow();
    expect(() => toTxSnapshot(txRow({ breakdown: { ...(asJson(breakdownE1()) as object), net: 90.3 } }))).toThrow();
  });
});

describe("toTxDetail", () => {
  const allocations = [
    { beneficiary_id: DEMO.beneficiaryIds.c, amount: "18.06", pct: "20.0000", is_remainder: false },
    { beneficiary_id: DEMO.beneficiaryIds.a, amount: "45.15", pct: "50.0000", is_remainder: false },
    { beneficiary_id: DEMO.beneficiaryIds.b, amount: "27.09", pct: "30.0000", is_remainder: false },
  ];

  test("el reparto sale en el orden del desglose, con porcentajes normalizados", () => {
    const detail = toTxDetail(txRow(), allocations, [], []);
    expect(detail.allocations).toEqual([
      { beneficiaryId: DEMO.beneficiaryIds.a, amount: "45.15", pct: "50", isRemainder: false },
      { beneficiaryId: DEMO.beneficiaryIds.b, amount: "27.09", pct: "30", isRemainder: false },
      { beneficiaryId: DEMO.beneficiaryIds.c, amount: "18.06", pct: "20", isRemainder: false },
    ]);
    expect(detail.breakdown).toEqual(breakdownE1());
    expect(detail.id).toBe("tx-e1");
  });

  test("un beneficiario que el desglose no trae va al final, sin perderse", () => {
    const extra = { beneficiary_id: "ben-z", amount: "0.00", pct: "0.0000", is_remainder: true };
    const detail = toTxDetail(txRow(), [extra, ...allocations], [], []);
    expect(detail.allocations.map((line) => line.beneficiaryId)).toEqual([
      DEMO.beneficiaryIds.a,
      DEMO.beneficiaryIds.b,
      DEMO.beneficiaryIds.c,
      "ben-z",
    ]);
    expect(detail.allocations.at(-1)).toEqual({ beneficiaryId: "ben-z", amount: "0.00", pct: "0", isRemainder: true });
  });

  test("comprobantes y eventos, con los nombres del motor", () => {
    const receipts = [
      {
        id: "rc-1",
        path: "user-1/tx-e1/recibo.png",
        mime: "image/png",
        size_bytes: 2048,
        created_at: "2026-11-13T15:32:00+00:00",
      },
    ];
    const events = [
      {
        id: "ev-2",
        at: "2026-11-14T09:00:00+00:00",
        kind: "depositado",
        summary: "Depositado el lun 16 nov 2026",
        data: { antes: { estado: "registrado" }, despues: { estado: "depositado" } },
      },
      {
        id: "ev-1",
        at: "2026-11-13T15:31:00+00:00",
        kind: "creado",
        summary: "Cobro de $100,00 por Stripe",
        data: null,
      },
    ];
    const detail = toTxDetail(txRow(), [], receipts, events);
    expect(detail.receipts).toEqual([
      {
        id: "rc-1",
        path: "user-1/tx-e1/recibo.png",
        mime: "image/png",
        sizeBytes: 2048,
        createdAt: "2026-11-13T15:32:00+00:00",
      },
    ]);
    // El nombre original del archivo no existe: ni se lee ni viaja al navegador.
    expect(detail.receipts[0]).not.toHaveProperty("originalName");
    expect(detail.events).toEqual([
      {
        id: "ev-2",
        at: "2026-11-14T09:00:00+00:00",
        kind: "depositado",
        summary: "Depositado el lun 16 nov 2026",
        data: { antes: { estado: "registrado" }, despues: { estado: "depositado" } },
      },
      {
        id: "ev-1",
        at: "2026-11-13T15:31:00+00:00",
        kind: "creado",
        summary: "Cobro de $100,00 por Stripe",
        data: null,
      },
    ]);
  });

  test("un evento de un tipo desconocido no pasa, y sus datos solo valen si son un objeto", () => {
    const event = { id: "ev-1", at: "2026-11-13T15:31:00+00:00", kind: "creado", summary: "Cobro", data: null };
    expect(() => toTxDetail(txRow(), [], [], [{ ...event, kind: "exportado" }])).toThrow("Tipo de evento desconocido");
    expect(toTxDetail(txRow(), [], [], [{ ...event, data: ["suelto"] }]).events[0]?.data).toBeNull();
    expect(toTxDetail(txRow(), [], [], [{ ...event, data: "suelto" }]).events[0]?.data).toBeNull();
  });
});

describe("toSettlement", () => {
  const row = {
    id: "st-1",
    beneficiary_id: DEMO.beneficiaryIds.a,
    paid_on: "2026-11-14",
    currency: "USD",
    amount: "45.15",
    method: "Transferencia",
    receipt_path: "user-1/st-1/recibo.pdf",
    receipt_mime: "application/pdf",
    receipt_size: 2048,
    note: "Liquidación de noviembre",
  };

  test("la liquidación con los nombres del motor y el monto canónico", () => {
    expect(dto.toSettlement(row)).toEqual({
      id: "st-1",
      beneficiaryId: DEMO.beneficiaryIds.a,
      paidOn: "2026-11-14",
      currency: "USD",
      amount: "45.15",
      method: "Transferencia",
      receiptPath: "user-1/st-1/recibo.pdf",
      receiptMime: "application/pdf",
      receiptSize: 2048,
      note: "Liquidación de noviembre",
    });
  });

  test("una devolución del beneficiario es un monto negativo; sin comprobante, todo lo suyo es null", () => {
    const refund = {
      ...row,
      amount: "-3.2",
      method: null,
      receipt_path: null,
      receipt_mime: null,
      receipt_size: null,
      note: null,
    };
    expect(dto.toSettlement(refund)).toMatchObject({
      amount: "-3.20",
      method: null,
      receiptPath: null,
      receiptMime: null,
      receiptSize: null,
      note: null,
    });
    expect(dto.SETTLEMENT_COLUMNS).toContain("amount::text");
  });
});

describe("toPayConfig", () => {
  /** Las filas de la configuración de ejemplo del motor, como las devuelve la base (numeric como texto con relleno). */
  function rows(): ConfigRows {
    return {
      companies: [
        { id: "co-tienda", name: "Tienda Demo", currency: "EUR", default_scheme_id: null, active: false },
        { id: DEMO.companyId, name: "Escuela Demo", currency: "USD", default_scheme_id: DEMO.schemeId, active: true },
      ],
      channels: [
        {
          id: DEMO.channelId,
          company_id: DEMO.companyId,
          name: "Escuela de marketing",
          platform_fee_pct: "5.0000",
          platform_fee_fixed: "0.00",
          active: true,
        },
      ],
      gateways: [
        {
          id: DEMO.gatewayId,
          name: "Stripe",
          payout_days: 2,
          payout_day_type: "habiles",
          refunds_return_fee: false,
          dispute_fee: "15.00",
          active: true,
        },
        {
          id: "gw-paypal",
          name: "PayPal",
          payout_days: 1,
          payout_day_type: "corridos",
          refunds_return_fee: true,
          dispute_fee: "20.00",
          active: false,
        },
      ],
      feeVersions: [
        {
          id: DEMO.feeVersionId,
          gateway_id: DEMO.gatewayId,
          pct: "2.9000",
          fixed: "0.30",
          effective_from: "2000-01-01",
          note: null,
        },
        {
          id: "fv-stripe-2",
          gateway_id: DEMO.gatewayId,
          pct: "3.5000",
          fixed: "0.30",
          effective_from: "2026-11-14",
          note: "Sube",
        },
        {
          id: "fv-paypal-1",
          gateway_id: "gw-paypal",
          pct: "3.4900",
          fixed: "0.49",
          effective_from: "2000-01-01",
          note: null,
        },
      ],
      extras: [
        {
          id: DEMO.extraId,
          gateway_id: DEMO.gatewayId,
          name: "Pago rápido",
          pct: "1.5000",
          fixed: "0.00",
          base: "bruto",
          default_on: true,
          payout_days_override: 0,
          active: true,
          sort: 0,
        },
        {
          id: "ex-seguro",
          gateway_id: DEMO.gatewayId,
          name: "Seguro",
          pct: "0.0000",
          fixed: "1.00",
          base: "despues_de_comision",
          default_on: false,
          payout_days_override: null,
          active: false,
          sort: 1,
        },
      ],
      companyGateways: [
        {
          id: "cg-escuela-stripe",
          company_id: DEMO.companyId,
          gateway_id: DEMO.gatewayId,
          bank_account_id: DEMO.bankAccountId,
          payout_days_override: null,
          default_extra_ids: null,
          active: true,
        },
        {
          id: "cg-tienda-stripe",
          company_id: "co-tienda",
          gateway_id: DEMO.gatewayId,
          bank_account_id: null,
          payout_days_override: 5,
          default_extra_ids: [DEMO.extraId],
          active: true,
        },
      ],
      bankAccounts: [
        { id: DEMO.bankAccountId, alias: "Cuenta principal", last4: "4321", currency: "USD", active: true },
      ],
      beneficiaries: [
        { id: DEMO.beneficiaryIds.a, name: "Grupo A", kind: "persona", active: true },
        { id: DEMO.beneficiaryIds.b, name: "Grupo B", kind: "empresa", active: true },
        { id: DEMO.beneficiaryIds.c, name: "Grupo C", kind: "cartera", active: false },
      ],
      schemes: [
        { id: DEMO.schemeId, name: "Reparto 50/30/20", active: true },
        { id: "sch-vacio", name: "Sin versiones", active: false },
      ],
      schemeVersions: [
        {
          id: DEMO.schemeVersionId,
          scheme_id: DEMO.schemeId,
          version: 1,
          base: "neto",
          remainder_beneficiary_id: null,
          effective_from: "2000-01-01",
        },
        {
          id: "sv-socios-2",
          scheme_id: DEMO.schemeId,
          version: 2,
          base: "bruto",
          remainder_beneficiary_id: DEMO.beneficiaryIds.c,
          effective_from: "2026-12-01",
        },
      ],
      schemeLines: [
        { scheme_version_id: DEMO.schemeVersionId, beneficiary_id: DEMO.beneficiaryIds.a, pct: "50.0000", sort: 0 },
        { scheme_version_id: DEMO.schemeVersionId, beneficiary_id: DEMO.beneficiaryIds.b, pct: "30.0000", sort: 1 },
        { scheme_version_id: "sv-socios-2", beneficiary_id: DEMO.beneficiaryIds.a, pct: "33.3333", sort: 0 },
        { scheme_version_id: DEMO.schemeVersionId, beneficiary_id: DEMO.beneficiaryIds.c, pct: "20.0000", sort: 2 },
      ],
      holidays: [{ day: "2026-11-26" }, { day: "2026-12-25" }],
    };
  }

  test("arma la forma exacta de PayConfig: cada hijo con su padre, en el orden en que llega, con lo inactivo", () => {
    expect(toPayConfig(rows())).toEqual({
      companies: [
        { id: "co-tienda", name: "Tienda Demo", currency: "EUR", defaultSchemeId: null, active: false },
        { id: DEMO.companyId, name: "Escuela Demo", currency: "USD", defaultSchemeId: DEMO.schemeId, active: true },
      ],
      channels: [
        {
          id: DEMO.channelId,
          companyId: DEMO.companyId,
          name: "Escuela de marketing",
          platformFeePct: "5",
          platformFeeFixed: "0.00",
          active: true,
        },
      ],
      gateways: [
        {
          id: DEMO.gatewayId,
          name: "Stripe",
          payoutDays: 2,
          payoutDayType: "habiles",
          refundsReturnFee: false,
          disputeFee: "15.00",
          active: true,
          feeVersions: [
            { id: DEMO.feeVersionId, pct: "2.9", fixed: "0.30", effectiveFrom: "2000-01-01", note: null },
            { id: "fv-stripe-2", pct: "3.5", fixed: "0.30", effectiveFrom: "2026-11-14", note: "Sube" },
          ],
          extras: [
            {
              id: DEMO.extraId,
              name: "Pago rápido",
              pct: "1.5",
              fixed: "0.00",
              base: "bruto",
              payoutDaysOverride: 0,
              defaultOn: true,
              active: true,
              sort: 0,
            },
            {
              id: "ex-seguro",
              name: "Seguro",
              pct: "0",
              fixed: "1.00",
              base: "despues_de_comision",
              payoutDaysOverride: null,
              defaultOn: false,
              active: false,
              sort: 1,
            },
          ],
        },
        {
          id: "gw-paypal",
          name: "PayPal",
          payoutDays: 1,
          payoutDayType: "corridos",
          refundsReturnFee: true,
          disputeFee: "20.00",
          active: false,
          feeVersions: [{ id: "fv-paypal-1", pct: "3.49", fixed: "0.49", effectiveFrom: "2000-01-01", note: null }],
          extras: [],
        },
      ],
      companyGateways: [
        {
          id: "cg-escuela-stripe",
          companyId: DEMO.companyId,
          gatewayId: DEMO.gatewayId,
          bankAccountId: DEMO.bankAccountId,
          payoutDaysOverride: null,
          defaultExtraIds: null,
          active: true,
        },
        {
          id: "cg-tienda-stripe",
          companyId: "co-tienda",
          gatewayId: DEMO.gatewayId,
          bankAccountId: null,
          payoutDaysOverride: 5,
          defaultExtraIds: [DEMO.extraId],
          active: true,
        },
      ],
      bankAccounts: [
        { id: DEMO.bankAccountId, alias: "Cuenta principal", last4: "4321", currency: "USD", active: true },
      ],
      beneficiaries: [
        { id: DEMO.beneficiaryIds.a, name: "Grupo A", kind: "persona", active: true },
        { id: DEMO.beneficiaryIds.b, name: "Grupo B", kind: "empresa", active: true },
        { id: DEMO.beneficiaryIds.c, name: "Grupo C", kind: "cartera", active: false },
      ],
      schemes: [
        {
          id: DEMO.schemeId,
          name: "Reparto 50/30/20",
          active: true,
          versions: [
            {
              id: DEMO.schemeVersionId,
              version: 1,
              base: "neto",
              remainderBeneficiaryId: null,
              effectiveFrom: "2000-01-01",
              lines: [
                { beneficiaryId: DEMO.beneficiaryIds.a, pct: "50" },
                { beneficiaryId: DEMO.beneficiaryIds.b, pct: "30" },
                { beneficiaryId: DEMO.beneficiaryIds.c, pct: "20" },
              ],
            },
            {
              id: "sv-socios-2",
              version: 2,
              base: "bruto",
              remainderBeneficiaryId: DEMO.beneficiaryIds.c,
              effectiveFrom: "2026-12-01",
              lines: [{ beneficiaryId: DEMO.beneficiaryIds.a, pct: "33.3333" }],
            },
          ],
        },
        { id: "sch-vacio", name: "Sin versiones", active: false, versions: [] },
      ],
      holidays: ["2026-11-26", "2026-12-25"],
    });
  });

  test("con la configuración de ejemplo del motor da exactamente esa configuración", () => {
    const cfg = cfgDemo();
    const fromRows = toPayConfig({
      ...rows(),
      companies: rows().companies.slice(1),
      gateways: rows().gateways.slice(0, 1),
      feeVersions: rows().feeVersions.slice(0, 1),
      extras: rows().extras.slice(0, 1),
      companyGateways: rows().companyGateways.slice(0, 1),
      beneficiaries: rows().beneficiaries.map((row) => ({ ...row, kind: "persona", active: true })),
      schemes: rows().schemes.slice(0, 1),
      schemeVersions: rows().schemeVersions.slice(0, 1),
      schemeLines: rows().schemeLines.filter((line) => line.scheme_version_id === DEMO.schemeVersionId),
      holidays: cfg.holidays.map((day) => ({ day })),
    });
    expect(fromRows).toEqual(cfg);
  });

  test("valores que el motor no conoce no se cuelan", () => {
    const bad = (patch: (r: ConfigRows) => void) => () => {
      const r = rows();
      patch(r);
      return toPayConfig(r);
    };
    expect(bad((r) => ((r.gateways[0] as { payout_day_type: string }).payout_day_type = "lunares"))).toThrow(
      "Tipo de días desconocido",
    );
    expect(bad((r) => ((r.extras[0] as { base: string }).base = "neto"))).toThrow("Base de la opción desconocida");
    expect(bad((r) => ((r.schemeVersions[0] as { base: string }).base = "todo"))).toThrow(
      "Base del reparto desconocida",
    );
    expect(bad((r) => ((r.beneficiaries[0] as { kind: string }).kind = "robot"))).toThrow(
      "Tipo de beneficiario desconocido",
    );
    expect(bad((r) => ((r.channels[0] as { platform_fee_pct: string }).platform_fee_pct = "cinco"))).toThrow(
      RangeError,
    );
  });
});
