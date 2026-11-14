import { describe, expect, test } from "vitest";
import { parseBreakdown } from "@/lib/pasarelas/breakdown";
import { displayStatus, isPending } from "@/lib/pasarelas/status";
import { DEMO, cfgDemo } from "@/lib/pasarelas/demo.fixture";
import {
  PayStateError,
  planCreate,
  planDeposit,
  planDispute,
  planEdit,
  planEstimated,
  planFail,
  planRecalc,
  planRefund,
  planRefundTotal,
  planReopen,
  planRestore,
  planRevertDeposit,
  planTransit,
  planTrash,
} from "@/lib/pasarelas/write";
import type { TxFields, TxSnapshot, TxWrite } from "@/lib/pasarelas/types";
import { TX_ACTIONS, allowedActions, primaryAction, refundedInFull, type TxAction } from "./allowed";

/*
 * El ayudante decide qué acciones enseña el detalle de un cobro. Tiene que decir lo mismo que el motor: para cada
 * estado al que se llega con los planes de `write.ts`, una acción se ofrece si y solo si su plan la acepta (no lanza
 * `PayStateError`) y cambia algo.
 */

const cfg = cfgDemo();
const TODAY = "2026-11-20";

/** El cobro tal como queda guardado tras una escritura (la base devuelve otra copia del desglose). */
function apply(write: TxWrite, prev?: TxSnapshot): TxSnapshot {
  const f = { ...(prev === undefined ? {} : columnsOf(prev)), ...write.fields } as TxFields;
  return {
    id: write.id,
    occurredAt: f.occurredAt,
    occurredOn: f.occurredOn,
    companyId: f.companyId,
    channelId: f.channelId,
    gatewayId: f.gatewayId,
    bankAccountId: f.bankAccountId,
    currency: f.currency,
    grossOriginal: f.grossOriginal,
    refunded: f.refundedAmount,
    gross: f.grossAmount,
    fees: f.feesTotal,
    net: f.netAmount,
    status: f.status,
    disputeState: f.disputeState,
    estimatedDepositOn: f.estimatedDepositOn,
    estimatedDepositFrom: f.estimatedDepositFrom,
    depositedOn: f.depositedOn,
    receiptsCount: 0,
    feesPaidBy: "nosotros",
    buyerFees: f.buyerFees,
    retention: f.retentionAmount,
    schemeId: f.schemeId,
    reference: f.reference,
    note: f.note,
    estimatedIsManual: f.estimatedIsManual,
    disputeOpenedOn: f.disputeOpenedOn,
    disputeClosedOn: f.disputeClosedOn,
    deletedAt: f.deletedAt,
    updatedAt: `2026-11-20T12:00:00Z`,
    breakdown: parseBreakdown(JSON.parse(JSON.stringify(f.breakdown))),
  };
}

function columnsOf(tx: TxSnapshot): TxFields {
  const b = tx.breakdown;
  return {
    occurredAt: tx.occurredAt,
    occurredOn: tx.occurredOn,
    companyId: tx.companyId,
    channelId: tx.channelId,
    gatewayId: tx.gatewayId,
    currency: tx.currency,
    grossOriginal: tx.grossOriginal,
    refundedAmount: tx.refunded,
    grossAmount: tx.gross,
    feesTotal: tx.fees,
    netAmount: tx.net,
    allocBase: b.alloc.baseKind,
    allocBaseAmount: b.alloc.baseAmount,
    breakdown: b,
    feeVersionId: b.rules.gateway.feeVersionId,
    schemeId: tx.schemeId,
    schemeVersionId: b.rules.scheme?.versionId ?? null,
    reference: tx.reference,
    note: tx.note,
    status: tx.status,
    disputeState: tx.disputeState,
    disputeOpenedOn: tx.disputeOpenedOn,
    disputeClosedOn: tx.disputeClosedOn,
    estimatedDepositOn: tx.estimatedDepositOn,
    estimatedDepositFrom: tx.estimatedDepositFrom,
    estimatedIsManual: tx.estimatedIsManual,
    depositedOn: tx.depositedOn,
    bankAccountId: tx.bankAccountId,
    deletedAt: tx.deletedAt,
    feesPaidBy: tx.feesPaidBy,
    buyerFees: tx.buyerFees,
    retentionAmount: tx.retention,
  };
}

/** E1 recién registrado: 100,00 de Escuela Demo por Stripe con «Pago rápido», repartido 50/30/20. */
const e1 = apply(
  planCreate(cfg, {
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
  }),
);

const then = (tx: TxSnapshot, plan: (tx: TxSnapshot) => TxWrite): TxSnapshot => apply(plan(tx), tx);
const NOW = "2026-11-20T12:00:00Z";

const transit = then(e1, planTransit);
const deposited = then(transit, (tx) => planDeposit(tx, "2026-11-16"));
const failed = then(e1, planFail);
const partial = then(e1, (tx) => planRefund(tx, { amount: "40.00", on: "2026-11-15" }));
const full = then(e1, (tx) => planRefund(tx, { amount: "100.00", on: "2026-11-15" }));
const disputed = then(e1, (tx) => planDispute(tx, { action: "abrir", on: "2026-11-16" }));
const won = then(disputed, (tx) => planDispute(tx, { action: "ganar", on: "2026-11-18" }));
const lost = then(disputed, (tx) => planDispute(tx, { action: "perder", on: "2026-11-18" }));

/** Cada estado al que se llega con los planes del motor. */
const STATES: Record<string, TxSnapshot> = {
  registrado: e1,
  "con la fecha estimada a mano": then(e1, (tx) => planEstimated(cfg, tx, "2026-11-25")),
  "en tránsito": transit,
  depositado: deposited,
  "depositado con reembolso parcial": then(deposited, (tx) => planRefund(tx, { amount: "40.00", on: "2026-11-17" })),
  "depositado con la disputa abierta": then(deposited, (tx) => planDispute(tx, { action: "abrir", on: "2026-11-17" })),
  fallido: failed,
  "con reembolso parcial": partial,
  "reembolsado del todo": full,
  "en tránsito y reembolsado del todo": then(transit, (tx) => planRefund(tx, { amount: "100.00", on: "2026-11-15" })),
  "depositado y reembolsado del todo": then(deposited, (tx) => planRefund(tx, { amount: "100.00", on: "2026-11-17" })),
  "con la disputa abierta": disputed,
  "con la disputa ganada": won,
  "con la disputa perdida": lost,
  "en la papelera": then(e1, (tx) => planTrash(tx, NOW)),
  "fallido en la papelera": then(failed, (tx) => planTrash(tx, NOW)),
  "con reembolso parcial en la papelera": then(partial, (tx) => planTrash(tx, NOW)),
};

/** ¿El motor acepta el plan? Un plan que no cambia nada tampoco es una acción que ofrecer. */
function accepts(plan: () => TxWrite, needsChange = true): boolean {
  try {
    const write = plan();
    return !needsChange || Object.keys(write.fields).length > 0;
  } catch (error) {
    if (error instanceof PayStateError) return false;
    throw error;
  }
}

/** Lo que dice el motor de cada acción del detalle, con una entrada válida de ejemplo. */
const ENGINE: Record<TxAction, (tx: TxSnapshot) => boolean> = {
  editar: (tx) => accepts(() => planEdit(cfg, tx, { note: "Otra nota" })),
  fecha_estimada: (tx) => accepts(() => planEstimated(cfg, tx, "2027-01-04")),
  fecha_automatica: (tx) => accepts(() => planEstimated(cfg, tx, null)),
  en_transito: (tx) => accepts(() => planTransit(tx)),
  depositado: (tx) => accepts(() => planDeposit(tx, "2027-01-05")),
  revertir_deposito: (tx) => accepts(() => planRevertDeposit(tx)),
  reembolso: (tx) => accepts(() => planRefund(tx, { amount: "0.01", on: TODAY })),
  corregir_reembolso: (tx) => accepts(() => planRefundTotal(tx, "0.00")),
  abrir_disputa: (tx) => accepts(() => planDispute(tx, { action: "abrir", on: TODAY })),
  resolver_disputa: (tx) => {
    const each = (["ganar", "perder", "anular"] as const).map((action) =>
      accepts(() => planDispute(tx, { action, on: TODAY })),
    );
    // Las tres salidas de una disputa abierta valen en los mismos estados: si no, una sola acción no basta.
    expect(new Set(each).size).toBe(1);
    return each[0] ?? false;
  },
  fallido: (tx) => accepts(() => planFail(tx)),
  reabrir: (tx) => accepts(() => planReopen(tx)),
  // Recalcular se ofrece aunque las cifras queden iguales: lo dice su vista previa.
  recalcular: (tx) => accepts(() => planRecalc(cfg, tx, "hoy", TODAY).write, false),
  papelera: (tx) => accepts(() => planTrash(tx, NOW)),
  restaurar: (tx) => accepts(() => planRestore(tx)),
};

describe("allowedActions dice lo mismo que el motor", () => {
  test.each(Object.entries(STATES))("%s", (_name, tx) => {
    const engine = TX_ACTIONS.filter((action) => ENGINE[action](tx));
    expect(allowedActions(tx)).toEqual(engine);
  });

  test("cada estado ofrece algo, y la lista va en el orden de TX_ACTIONS", () => {
    for (const tx of Object.values(STATES)) {
      const allowed = allowedActions(tx);
      expect(allowed.length).toBeGreaterThan(0);
      expect(allowed).toEqual(TX_ACTIONS.filter((action) => allowed.includes(action)));
    }
  });
});

describe("allowedActions, caso por caso", () => {
  test("un cobro recién registrado admite todo menos revertir, corregir, resolver, reabrir y restaurar", () => {
    expect(allowedActions(e1)).toEqual([
      "editar",
      "fecha_estimada",
      "en_transito",
      "depositado",
      "reembolso",
      "abrir_disputa",
      "fallido",
      "recalcular",
      "papelera",
    ]);
  });

  test("en la papelera solo se puede restaurar", () => {
    expect(allowedActions(STATES["en la papelera"] as TxSnapshot)).toEqual(["restaurar"]);
  });

  test("un fallido se edita, se reabre o va a la papelera; no recibe dinero, reembolsos ni disputas", () => {
    expect(allowedActions(failed)).toEqual(["editar", "fecha_estimada", "reabrir", "papelera"]);
  });

  test("con la disputa abierta se resuelve; no se abre otra ni se marca fallido", () => {
    const allowed = allowedActions(disputed);
    expect(allowed).toContain("resolver_disputa");
    expect(allowed).not.toContain("abrir_disputa");
    expect(allowed).not.toContain("fallido");
  });

  test("con la disputa perdida ya no hay reembolso que agregar ni que corregir", () => {
    const allowed = allowedActions(lost);
    expect(allowed).not.toContain("reembolso");
    expect(allowed).not.toContain("corregir_reembolso");
  });
});

describe("primaryAction: la que queda a la vista en el detalle", () => {
  test.each<[string, TxAction]>([
    ["registrado", "depositado"],
    ["en tránsito", "depositado"],
    ["con reembolso parcial", "depositado"],
    // Reembolsado del todo no hay nada que depositar (no está «Por caer»): ni registrado ni ya en tránsito.
    ["reembolsado del todo", "editar"],
    ["en tránsito y reembolsado del todo", "editar"],
    ["depositado y reembolsado del todo", "editar"],
    ["depositado", "editar"],
    ["con la disputa abierta", "resolver_disputa"],
    ["depositado con la disputa abierta", "resolver_disputa"],
    ["fallido", "reabrir"],
    ["en la papelera", "restaurar"],
  ])("%s → %s", (name, action) => {
    const tx = STATES[name] as TxSnapshot;
    expect(primaryAction(tx)).toBe(action);
    expect(allowedActions(tx)).toContain(action);
  });

  test("en todo estado hay una, y es de las que admite", () => {
    for (const tx of Object.values(STATES)) expect(allowedActions(tx)).toContain(primaryAction(tx));
  });
});

describe("refundedInFull: reembolsado del todo (bruto vigente 0)", () => {
  test("con el reembolso total, en cualquier punto del ciclo del dinero; no con uno parcial ni sin reembolso", () => {
    expect(refundedInFull(full)).toBe(true);
    expect(refundedInFull(STATES["en tránsito y reembolsado del todo"] as TxSnapshot)).toBe(true);
    expect(refundedInFull(STATES["depositado y reembolsado del todo"] as TxSnapshot)).toBe(true);
    expect(refundedInFull(lost)).toBe(true);
    expect(refundedInFull(partial)).toBe(false);
    expect(refundedInFull(e1)).toBe(false);
    // Un fallido tiene el bruto vigente en 0, pero no por un reembolso: no se dice reembolsado.
    expect(refundedInFull(failed)).toBe(false);
  });

  test("es lo mismo que el motor llama «Reembolsado» y que deja fuera de «Por caer»", () => {
    for (const tx of [full, STATES["en tránsito y reembolsado del todo"] as TxSnapshot]) {
      expect(displayStatus(tx)).toBe("reembolsado");
      expect(isPending(tx)).toBe(false);
      expect(tx.gross).toBe("0.00");
    }
  });

  test("lo ya depositado antes del reembolso se conserva y se puede revertir", () => {
    const tx = STATES["depositado y reembolsado del todo"] as TxSnapshot;
    expect(tx.status).toBe("depositado");
    expect(allowedActions(tx)).toContain("revertir_deposito");
  });
});
