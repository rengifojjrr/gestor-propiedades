import { describe, expect, test } from "vitest";
import { parseBreakdown } from "./breakdown";
import { DEMO, cfgDemo } from "./demo.fixture";
import { add, sub } from "./money";
import { PayRuleError } from "./rules";
import type { PayRuleCode } from "./rules";
import type { AllocWrite, GatewayCfg, PayConfig, TxFields, TxSnapshot, TxWrite } from "./types";
import {
  PAY_STATE_TEXT,
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
  requireSameRegistration,
} from "./write";
import type { NewTxInput, PayStateCode } from "./write";

// ─── Datos de ejemplo (inventados) ──────────────────────────────────────────────────────────────────────────

/** Viernes 13 de noviembre de 2026, 10:30 de Nueva York. */
const VIERNES_10_30 = "2026-11-13T15:30:00Z";
const VIERNES = "2026-11-13";
const SABADO = "2026-11-14";
const MARTES = "2026-11-17";

/** El cobro E1: 100,00 de Escuela Demo por su canal, con Stripe y «Pago rápido», repartido 50/30/20. */
function inputE1(patch: Partial<NewTxInput> = {}): NewTxInput {
  return {
    id: "tx-e1",
    companyId: DEMO.companyId,
    channelId: DEMO.channelId,
    gatewayId: DEMO.gatewayId,
    extraIds: [DEMO.extraId],
    schemeId: DEMO.schemeId,
    occurredOn: VIERNES,
    occurredAt: VIERNES_10_30,
    currency: "USD",
    grossOriginal: "100.00",
    reference: "ch_demo_0001",
    note: null,
    ...patch,
  };
}

function only<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined || items.length !== 1) throw new Error("Se esperaba exactamente un elemento");
  return item;
}

const stripe = (cfg: PayConfig): GatewayCfg => {
  const gateway = cfg.gateways.find((candidate) => candidate.id === DEMO.gatewayId);
  if (gateway === undefined) throw new Error("La configuración de ejemplo no tiene Stripe");
  return gateway;
};

/** La tarifa nueva de Stripe (3,5 % + 0,30) que rige desde el sábado 14. */
function withTomorrowFee(cfg: PayConfig): PayConfig {
  stripe(cfg).feeVersions.push({ id: "fv-stripe-2", pct: "3.5", fixed: "0.30", effectiveFrom: SABADO, note: null });
  return cfg;
}

/** Una segunda pasarela sin opciones: PayPal (3,49 % + 0,49; un día corrido; devuelve la comisión). */
function withPayPal(cfg: PayConfig): PayConfig {
  cfg.gateways.push({
    id: "gw-paypal",
    name: "PayPal",
    payoutDays: 1,
    payoutDayType: "corridos",
    refundsReturnFee: true,
    disputeFee: "20.00",
    active: true,
    feeVersions: [{ id: "fv-paypal-1", pct: "3.49", fixed: "0.49", effectiveFrom: "2000-01-01", note: null }],
    extras: [],
  });
  return cfg;
}

// ─── Una base de mentira: guarda lo que el plan manda y hace cumplir los mismos cuadres que la base real ────

type Row = { fields: TxFields; allocations: AllocWrite[]; saves: number };
const rows = new WeakMap<TxSnapshot, Row>();

const FIELD_NAMES: (keyof TxFields)[] = [
  "occurredAt",
  "occurredOn",
  "companyId",
  "channelId",
  "gatewayId",
  "currency",
  "grossOriginal",
  "refundedAmount",
  "grossAmount",
  "feesTotal",
  "netAmount",
  "allocBase",
  "allocBaseAmount",
  "breakdown",
  "feeVersionId",
  "schemeId",
  "schemeVersionId",
  "reference",
  "note",
  "status",
  "disputeState",
  "disputeOpenedOn",
  "disputeClosedOn",
  "estimatedDepositOn",
  "estimatedIsManual",
  "depositedOn",
  "bankAccountId",
  "deletedAt",
];

/** Las restricciones y disparadores de `pay_transactions`, más la coherencia entre columnas y desglose. */
function expectRowIsSound({ fields: f, allocations }: Row): void {
  const b = f.breakdown;
  // El desglose sobrevive la ida y vuelta por la base (jsonb) sin perder ni cambiar nada.
  expect(parseBreakdown(JSON.parse(JSON.stringify(b)))).toEqual(b);

  // Las columnas dicen lo mismo que el desglose congelado.
  expect({
    currency: f.currency,
    grossOriginal: f.grossOriginal,
    refundedAmount: f.refundedAmount,
    grossAmount: f.grossAmount,
    feesTotal: f.feesTotal,
    netAmount: f.netAmount,
    allocBase: f.allocBase,
    allocBaseAmount: f.allocBaseAmount,
    feeVersionId: f.feeVersionId,
    schemeId: f.schemeId,
    schemeVersionId: f.schemeVersionId,
    disputeState: f.disputeState,
    failed: f.status === "fallido",
  }).toEqual({
    currency: b.currency,
    grossOriginal: b.state.grossOriginal,
    refundedAmount: b.state.refunded,
    grossAmount: b.gross,
    feesTotal: b.feesTotal,
    netAmount: b.net,
    allocBase: b.alloc.baseKind,
    allocBaseAmount: b.alloc.baseAmount,
    feeVersionId: b.rules.gateway.feeVersionId,
    schemeId: b.rules.scheme?.schemeId ?? null,
    schemeVersionId: b.rules.scheme?.versionId ?? null,
    disputeState: b.state.dispute,
    failed: b.state.failed,
  });
  expect(allocations).toEqual(
    b.alloc.lines.map((line) => ({
      beneficiaryId: line.beneficiaryId,
      amount: line.amount,
      base: b.alloc.baseKind,
      pct: line.pct,
      isRemainder: line.isRemainder,
    })),
  );

  // pay_transactions_net_check, _gross_check, _refund_range, _deposit_check y _scheme_check.
  expect(f.netAmount).toBe(sub(f.grossAmount, f.feesTotal));
  if (f.status === "fallido") {
    expect([f.grossAmount, f.feesTotal, f.allocBaseAmount]).toEqual(["0.00", "0.00", "0.00"]);
  } else {
    expect(f.grossAmount).toBe(sub(f.grossOriginal, f.refundedAmount));
  }
  expect(f.status === "depositado").toBe(f.depositedOn !== null);
  // Spec §5.2.7: una disputa perdida es un reembolso total. La base no lo exige: lo garantizan los planes.
  if (f.disputeState === "perdida") expect(f.refundedAmount).toBe(f.grossOriginal);
  if (f.schemeVersionId === null) expect(f.allocBaseAmount).toBe("0.00");
  else expect(f.allocBase).not.toBeNull();
  // El disparador del reparto: la suma de lo asignado es exactamente la base.
  expect(add(...allocations.map((line) => line.amount))).toBe(f.allocBaseAmount);
}

/** La foto que debe llevar el historial de una fila. */
function photoOf(f: TxFields): Record<string, unknown> {
  return {
    bruto: f.grossAmount,
    comisiones: f.feesTotal,
    neto: f.netAmount,
    reembolsado: f.refundedAmount,
    estado: f.status,
    disputa: f.disputeState,
    pasarela: f.breakdown.rules.gateway.name,
    versionDeEsquema: f.schemeVersionId,
    fechaEstimada: f.estimatedDepositOn,
    depositadoEl: f.depositedOn,
  };
}

/**
 * Hace lo que haría `pay_save_transactions` con la escritura y devuelve el cobro como se leería después.
 * De paso comprueba lo que todo plan debe cumplir: control optimista, solo columnas que cambian, reparto solo
 * cuando cambian los números, el antes y el después del evento y los cuadres de la fila que queda.
 */
function save(write: TxWrite, prev?: TxSnapshot): TxSnapshot {
  const before = prev === undefined ? undefined : rows.get(prev);
  if (before === undefined) {
    expect(write.mode).toBe("insert");
    expect(write.expectedUpdatedAt).toBeNull();
    expect(Object.keys(write.fields).sort()).toEqual([...FIELD_NAMES].sort());
    expect(write.allocations).not.toBeNull();
    expect(write.event.data?.antes).toBeNull();
  } else {
    expect(write.mode).toBe("update");
    expect(write.id).toBe(prev?.id);
    expect(write.expectedUpdatedAt).toBe(prev?.updatedAt);
    for (const name of Object.keys(write.fields) as (keyof TxFields)[]) {
      expect(FIELD_NAMES).toContain(name);
      expect(write.fields[name], `«${name}» va en la escritura sin haber cambiado`).not.toEqual(before.fields[name]);
    }
    // El reparto se reescribe si y solo si cambia el desglose.
    expect(write.allocations !== null).toBe("breakdown" in write.fields);
    expect(write.event.data?.antes).toEqual(photoOf(before.fields));
  }

  const row: Row = {
    fields: { ...before?.fields, ...write.fields } as TxFields,
    allocations: write.allocations ?? before?.allocations ?? [],
    saves: (before?.saves ?? 0) + 1,
  };
  expectRowIsSound(row);
  expect(write.event.data?.despues).toEqual(photoOf(row.fields));
  expect(write.event.summary.length).toBeGreaterThan(0);

  const f = row.fields;
  const tx: TxSnapshot = {
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
    depositedOn: f.depositedOn,
    receiptsCount: 0,
    schemeId: f.schemeId,
    reference: f.reference,
    note: f.note,
    estimatedIsManual: f.estimatedIsManual,
    disputeOpenedOn: f.disputeOpenedOn,
    disputeClosedOn: f.disputeClosedOn,
    deletedAt: f.deletedAt,
    updatedAt: `2026-11-13T16:00:0${row.saves}Z`,
    // Como vuelve de la base: otra copia, pasada por JSON.
    breakdown: parseBreakdown(JSON.parse(JSON.stringify(f.breakdown))),
  };
  rows.set(tx, row);
  return tx;
}

/** E1 ya guardado (con los cambios que se pidan en lo que se registra). */
function savedE1(patch: Partial<NewTxInput> = {}, cfg: PayConfig = cfgDemo()): TxSnapshot {
  return save(planCreate(cfg, inputE1(patch)));
}

/** E1 con la disputa perdida: todo reembolsado (100,00) y la disputa cobrada (15,00). */
function lostE1(): TxSnapshot {
  const tx = savedE1();
  const opened = save(planDispute(tx, { action: "abrir", on: "2026-11-16" }), tx);
  return save(planDispute(opened, { action: "perder", on: "2026-11-20" }), opened);
}

const shares = (write: TxWrite): string[] | undefined => write.allocations?.map((line) => line.amount);
const fieldNames = (write: TxWrite): string[] => Object.keys(write.fields).sort();
const lineKinds = (write: TxWrite): string[] | undefined => write.fields.breakdown?.lines.map((line) => line.kind);

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Se esperaba un error y no lo hubo");
}

function expectStateError(fn: () => unknown, code: PayStateCode): void {
  const error = caught(fn);
  expect(error).toBeInstanceOf(PayStateError);
  expect((error as PayStateError).code).toBe(code);
}

function expectRuleError(fn: () => unknown, code: PayRuleCode): void {
  const error = caught(fn);
  expect(error).toBeInstanceOf(PayRuleError);
  expect((error as PayRuleError).code).toBe(code);
}

// ─── PayStateError ──────────────────────────────────────────────────────────────────────────────────────────

describe("PayStateError", () => {
  test("es un Error con su código y el mensaje en español de ese código", () => {
    const error = new PayStateError("en_papelera");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("PayStateError");
    expect(error.code).toBe("en_papelera");
    expect(error.message).toBe(PAY_STATE_TEXT.en_papelera);
  });

  test("cada código tiene su texto, y ninguno se repite", () => {
    const texts = Object.values(PAY_STATE_TEXT);
    expect(texts.length).toBeGreaterThan(10);
    expect(texts.every((text) => text.length > 10)).toBe(true);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

// ─── requireSameRegistration ────────────────────────────────────────────────────────────────────────────────

describe("requireSameRegistration", () => {
  test("el mismo envío otra vez (el mismo instante escrito de otra forma, las opciones en otro orden) pasa", () => {
    const tx = savedE1({ extraIds: [DEMO.extraId] });
    expect(() => requireSameRegistration(tx, inputE1())).not.toThrow();
    const sameInstant = inputE1({ occurredAt: "2026-11-13T10:30:00-05:00", note: "Otra nota", status: "en_transito" });
    expect(() => requireSameRegistration(tx, sameInstant)).not.toThrow();
  });

  test.each<[string, Partial<NewTxInput>]>([
    ["monto", { grossOriginal: "150.00" }],
    ["moneda", { currency: "EUR" }],
    ["fecha", { occurredAt: "2026-11-13T15:31:00Z" }],
    ["empresa", { companyId: "co-otra" }],
    ["pasarela", { gatewayId: "gw-otra" }],
    ["canal", { channelId: null }],
    ["opciones", { extraIds: [] }],
    ["esquema", { schemeId: null }],
    ["referencia", { reference: "ch_demo_otra" }],
  ])("con otro dato (%s) no es el mismo envío: lo dice", (_label, patch) => {
    const tx = savedE1();
    expectStateError(() => requireSameRegistration(tx, inputE1(patch)), "ya_registrado");
  });
});

// ─── planCreate ─────────────────────────────────────────────────────────────────────────────────────────────

describe("planCreate", () => {
  test("E1 el viernes 13 a las 10:30 de Nueva York: todas las columnas, el reparto y el evento", () => {
    const write = planCreate(cfgDemo(), inputE1());
    expect(write.mode).toBe("insert");
    expect(write.id).toBe("tx-e1");
    expect(write.expectedUpdatedAt).toBeNull();
    expect({ ...write.fields, breakdown: null }).toEqual({
      occurredAt: VIERNES_10_30,
      occurredOn: VIERNES,
      companyId: DEMO.companyId,
      channelId: DEMO.channelId,
      gatewayId: DEMO.gatewayId,
      currency: "USD",
      grossOriginal: "100.00",
      refundedAmount: "0.00",
      grossAmount: "100.00",
      feesTotal: "9.70",
      netAmount: "90.30",
      allocBase: "neto",
      allocBaseAmount: "90.30",
      breakdown: null,
      feeVersionId: DEMO.feeVersionId,
      schemeId: DEMO.schemeId,
      schemeVersionId: DEMO.schemeVersionId,
      reference: "ch_demo_0001",
      note: null,
      status: "registrado",
      disputeState: null,
      disputeOpenedOn: null,
      disputeClosedOn: null,
      // Pago rápido: 0 días, cae el mismo viernes.
      estimatedDepositOn: VIERNES,
      estimatedIsManual: false,
      depositedOn: null,
      bankAccountId: DEMO.bankAccountId,
      deletedAt: null,
    });
    expect(write.fields.breakdown?.lines.map((line) => [line.kind, line.amount])).toEqual([
      ["pasarela", "3.20"],
      ["opcion", "1.50"],
      ["plataforma", "5.00"],
    ]);
    expect(write.fields.breakdown?.state).toEqual({
      grossOriginal: "100.00",
      refunded: "0.00",
      dispute: null,
      failed: false,
    });
    expect(write.allocations).toEqual([
      { beneficiaryId: DEMO.beneficiaryIds.a, amount: "45.15", base: "neto", pct: "50", isRemainder: false },
      { beneficiaryId: DEMO.beneficiaryIds.b, amount: "27.09", base: "neto", pct: "30", isRemainder: false },
      { beneficiaryId: DEMO.beneficiaryIds.c, amount: "18.06", base: "neto", pct: "20", isRemainder: false },
    ]);
    expect(write.event).toEqual({
      kind: "creado",
      summary: "Cobro de $100,00 por Stripe",
      data: {
        antes: null,
        despues: {
          bruto: "100.00",
          comisiones: "9.70",
          neto: "90.30",
          reembolsado: "0.00",
          estado: "registrado",
          disputa: null,
          pasarela: "Stripe",
          versionDeEsquema: DEMO.schemeVersionId,
          fechaEstimada: VIERNES,
          depositadoEl: null,
        },
      },
    });
    save(write);
  });

  test("sin «Pago rápido»: dos días hábiles después del viernes es el martes 17", () => {
    const write = planCreate(cfgDemo(), inputE1({ extraIds: [] }));
    expect(write.fields.estimatedDepositOn).toBe(MARTES);
    expect([write.fields.feesTotal, write.fields.netAmount]).toEqual(["8.20", "91.80"]);
    expect(shares(write)).toEqual(["45.90", "27.54", "18.36"]);
    save(write);
  });

  test("la fecha del cobro es la de Nueva York: a las 22:30 del viernes en UTC ya es sábado", () => {
    const write = planCreate(cfgDemo(), inputE1({ occurredAt: "2026-11-14T03:30:00Z" }));
    expect(write.fields.occurredOn).toBe(VIERNES);
    expect(write.fields.occurredAt).toBe("2026-11-14T03:30:00Z");
  });

  test("si la fecha que llega no es la de ese instante en Nueva York, no se guarda", () => {
    expectStateError(() => planCreate(cfgDemo(), inputE1({ occurredOn: SABADO })), "fecha_inconsistente");
    const lateFriday = inputE1({ occurredAt: "2026-11-14T03:30:00Z", occurredOn: SABADO });
    expectStateError(() => planCreate(cfgDemo(), lateFriday), "fecha_inconsistente");
  });

  test("«vigente desde mañana»: el cobro del 13 paga 3,20 a la pasarela y el del 14, 3,80", () => {
    const cfg = withTomorrowFee(cfgDemo());
    const friday = planCreate(cfg, inputE1());
    expect(only(friday.fields.breakdown?.lines.filter((line) => line.kind === "pasarela") ?? []).amount).toBe("3.20");
    expect(friday.fields.feeVersionId).toBe(DEMO.feeVersionId);

    const saturday = planCreate(cfg, inputE1({ occurredAt: "2026-11-14T15:30:00Z", occurredOn: SABADO }));
    expect(only(saturday.fields.breakdown?.lines.filter((line) => line.kind === "pasarela") ?? []).amount).toBe("3.80");
    expect(saturday.fields.feeVersionId).toBe("fv-stripe-2");
    expect([saturday.fields.feesTotal, saturday.fields.netAmount]).toEqual(["10.30", "89.70"]);
    save(saturday);
  });

  describe("estado inicial", () => {
    test("en tránsito", () => {
      const write = planCreate(cfgDemo(), inputE1({ status: "en_transito" }));
      expect([write.fields.status, write.fields.depositedOn]).toEqual(["en_transito", null]);
      save(write);
    });

    test("depositado, con su fecha", () => {
      const write = planCreate(cfgDemo(), inputE1({ status: "depositado", depositedOn: "2026-11-16" }));
      expect([write.fields.status, write.fields.depositedOn]).toEqual(["depositado", "2026-11-16"]);
      expect(write.event.data?.despues).toMatchObject({ estado: "depositado", depositadoEl: "2026-11-16" });
      save(write);
    });

    test("depositado sin fecha de depósito no se puede", () => {
      expectStateError(() => planCreate(cfgDemo(), inputE1({ status: "depositado" })), "falta_fecha_deposito");
      const withNull = inputE1({ status: "depositado", depositedOn: null });
      expectStateError(() => planCreate(cfgDemo(), withNull), "falta_fecha_deposito");
    });

    test("depositado antes del día del cobro no se puede; el mismo día, sí", () => {
      const early = inputE1({ status: "depositado", depositedOn: "2026-11-12" });
      expectStateError(() => planCreate(cfgDemo(), early), "deposito_antes_del_cobro");
      const sameDay = planCreate(cfgDemo(), inputE1({ status: "depositado", depositedOn: VIERNES }));
      expect(sameDay.fields.depositedOn).toBe(VIERNES);
    });

    test("una fecha de depósito sin el estado «depositado» no se guarda", () => {
      const write = planCreate(cfgDemo(), inputE1({ depositedOn: "2026-11-16" }));
      expect([write.fields.status, write.fields.depositedOn]).toEqual(["registrado", null]);
      save(write);
    });
  });

  describe("cuenta destino", () => {
    test("la que se elige al registrar manda sobre la de la cuenta de la pasarela", () => {
      expect(planCreate(cfgDemo(), inputE1({ bankAccountId: "ba-otra" })).fields.bankAccountId).toBe("ba-otra");
    });

    test("si no se elige (o llega vacía), la de la cuenta de la pasarela de esa empresa", () => {
      expect(planCreate(cfgDemo(), inputE1({ bankAccountId: null })).fields.bankAccountId).toBe(DEMO.bankAccountId);
    });

    test("si la empresa no tiene cuenta en esa pasarela, ninguna", () => {
      const cfg = cfgDemo();
      cfg.companyGateways = [];
      expect(planCreate(cfg, inputE1()).fields.bankAccountId).toBeNull();
    });
  });

  describe("fecha estimada", () => {
    test("la que se escribe a mano manda y queda marcada como manual", () => {
      const write = planCreate(cfgDemo(), inputE1({ estimatedDepositOn: "2026-11-20" }));
      expect([write.fields.estimatedDepositOn, write.fields.estimatedIsManual]).toEqual(["2026-11-20", true]);
    });

    test("vacía es automática", () => {
      const write = planCreate(cfgDemo(), inputE1({ estimatedDepositOn: null }));
      expect([write.fields.estimatedDepositOn, write.fields.estimatedIsManual]).toEqual([VIERNES, false]);
    });

    test("cuenta los feriados de la configuración: miércoles 25 + 2 hábiles, con Acción de Gracias, es el lunes 30", () => {
      const input = inputE1({ extraIds: [], occurredAt: "2026-11-25T15:30:00Z", occurredOn: "2026-11-25" });
      expect(planCreate(cfgDemo(), input).fields.estimatedDepositOn).toBe("2026-11-30");
      const noHolidays: PayConfig = { ...cfgDemo(), holidays: [] };
      expect(planCreate(noHolidays, input).fields.estimatedDepositOn).toBe("2026-11-27");
    });

    test("los días de la cuenta de la pasarela de esa empresa mandan sobre los de la pasarela", () => {
      const cfg = cfgDemo();
      only(cfg.companyGateways).payoutDaysOverride = 1;
      expect(planCreate(cfg, inputE1({ extraIds: [] })).fields.estimatedDepositOn).toBe("2026-11-16");
    });
  });

  test("sin esquema no hay reparto: base nula, cero y lista vacía", () => {
    const write = planCreate(cfgDemo(), inputE1({ schemeId: null }));
    expect(write.fields).toMatchObject({
      allocBase: null,
      allocBaseAmount: "0.00",
      schemeId: null,
      schemeVersionId: null,
      netAmount: "90.30",
    });
    expect(write.allocations).toEqual([]);
    expect(write.event.data?.despues).toMatchObject({ versionDeEsquema: null });
    save(write);
  });

  test("un cobro importado: evento «importado» y la comisión que informó la pasarela", () => {
    const write = planCreate(cfgDemo(), inputE1({ feeOverride: "3.41" }), "importado");
    expect(write.event.kind).toBe("importado");
    expect(write.event.summary).toBe("Cobro de $100,00 por Stripe");
    expect(write.fields.breakdown?.rules.gateway.feeOverride).toBe("3.41");
    expect([write.fields.feesTotal, write.fields.netAmount]).toEqual(["9.91", "90.09"]);
    save(write);
  });

  test("el resumen usa la moneda del cobro", () => {
    const write = planCreate(cfgDemo(), inputE1({ currency: "EUR", grossOriginal: "1234.56" }));
    expect(write.event.summary).toBe("Cobro de €1.234,56 por Stripe");
    expect(write.fields.currency).toBe("EUR");
    save(write);
  });

  test("lo que no existe en la configuración se rechaza con el error de reglas", () => {
    expectRuleError(() => planCreate(cfgDemo(), inputE1({ gatewayId: "gw-fantasma" })), "pasarela");
    expectRuleError(() => planCreate(cfgDemo(), inputE1({ channelId: "ch-fantasma" })), "canal");
  });

  test("un monto que no es mayor que cero no se calcula", () => {
    expect(() => planCreate(cfgDemo(), inputE1({ grossOriginal: "0.00" }))).toThrow(RangeError);
    expect(() => planCreate(cfgDemo(), inputE1({ grossOriginal: "100" }))).toThrow(RangeError);
  });
});

// ─── planEdit ───────────────────────────────────────────────────────────────────────────────────────────────

describe("planEdit", () => {
  test("solo el monto: las reglas quedan idénticas aunque la configuración ya sea otra", () => {
    const tx = savedE1();
    // Desde que se registró cambió todo: la tarifa de siempre, la opción, el canal y el reparto.
    const cfg = cfgDemo();
    only(stripe(cfg).feeVersions).pct = "9";
    only(stripe(cfg).extras).pct = "9";
    only(cfg.channels).platformFeePct = "9";
    only(only(cfg.schemes).versions).base = "bruto";

    const write = planEdit(cfg, tx, { grossOriginal: "200.00" });
    expect(write.fields.breakdown?.rules).toEqual(tx.breakdown.rules);
    expect(fieldNames(write)).toEqual([
      "allocBaseAmount",
      "breakdown",
      "feesTotal",
      "grossAmount",
      "grossOriginal",
      "netAmount",
    ]);
    expect(write.fields).toMatchObject({
      grossOriginal: "200.00",
      grossAmount: "200.00",
      feesTotal: "19.10",
      netAmount: "180.90",
      allocBaseAmount: "180.90",
    });
    expect(shares(write)).toEqual(["90.45", "54.27", "36.18"]);
    expect(write.event.kind).toBe("editado");
    expect(write.event.summary).toBe("Editado: monto");
    save(write, tx);
  });

  test("otro monto en un cobro con la comisión informada: esa comisión era de otro monto y se descarta", () => {
    const tx = savedE1({ feeOverride: "3.41" });
    const write = planEdit(cfgDemo(), tx, { grossOriginal: "200.00" });
    const gateway = write.fields.breakdown?.rules.gateway;
    expect(gateway !== undefined && "feeOverride" in gateway).toBe(false);
    // Vale la tarifa congelada en el cobro: 2,9 % + 0,30 de 200,00.
    expect(write.fields.breakdown?.lines[0]).toMatchObject({ kind: "pasarela", baseKind: "bruto", amount: "6.10" });
    save(write, tx);
    // Si el monto no cambia, la comisión informada se queda: otro día con la misma tarifa no toca el desglose.
    const moved = planEdit(cfgDemo(), tx, { occurredAt: "2026-11-16T15:30:00Z" });
    expect(moved.fields.breakdown).toBeUndefined();
    expect(tx.breakdown.rules.gateway.feeOverride).toBe("3.41");
  });

  test("cambiar de pasarela trae su tarifa, y la fecha estimada se vuelve a calcular", () => {
    const cfg = withPayPal(cfgDemo());
    const tx = savedE1();
    const write = planEdit(cfg, tx, { gatewayId: "gw-paypal", extraIds: [] });
    expect(write.fields.breakdown?.rules.gateway).toEqual({
      id: "gw-paypal",
      name: "PayPal",
      feeVersionId: "fv-paypal-1",
      pct: "3.49",
      fixed: "0.49",
      refundsReturnFee: true,
      disputeFee: "20.00",
    });
    // Lo que no cambió sigue congelado.
    expect(write.fields.breakdown?.rules.platform).toEqual(tx.breakdown.rules.platform);
    expect(write.fields.breakdown?.rules.scheme).toEqual(tx.breakdown.rules.scheme);
    expect(write.fields).toMatchObject({
      gatewayId: "gw-paypal",
      feeVersionId: "fv-paypal-1",
      feesTotal: "8.98",
      netAmount: "91.02",
      // PayPal: un día corrido.
      estimatedDepositOn: SABADO,
    });
    expect(shares(write)).toEqual(["45.51", "27.31", "18.20"]);
    expect(write.event.summary).toBe("Editado: pasarela, opciones");
    expect(write.event.data).toMatchObject({ antes: { pasarela: "Stripe" }, despues: { pasarela: "PayPal" } });
    save(write, tx);
  });

  test("cambiar de pasarela vuelve a poner la cuenta destino por defecto, salvo que la edición diga otra", () => {
    const tx = savedE1();
    expect(tx.bankAccountId).toBe(DEMO.bankAccountId);

    // La empresa no tiene cuenta de PayPal: no hay cuenta destino por defecto.
    const bare = planEdit(withPayPal(cfgDemo()), tx, { gatewayId: "gw-paypal", extraIds: [] });
    expect(bare.fields.bankAccountId).toBeNull();
    expect(bare.event.summary).toBe("Editado: pasarela, opciones");
    save(bare, tx);

    // Con su cuenta de PayPal, que cae en otra cuenta destino: esa.
    const cfg = withPayPal(cfgDemo());
    cfg.bankAccounts.push({ id: "ba-paypal", alias: "Cuenta de PayPal", last4: "1111", currency: "USD", active: true });
    cfg.companyGateways.push({
      id: "cg-escuela-paypal",
      companyId: DEMO.companyId,
      gatewayId: "gw-paypal",
      bankAccountId: "ba-paypal",
      payoutDaysOverride: null,
      defaultExtraIds: null,
      active: true,
    });
    const moved = planEdit(cfg, tx, { gatewayId: "gw-paypal", extraIds: [] });
    expect(moved.fields.bankAccountId).toBe("ba-paypal");
    save(moved, tx);

    // Dicha en la edición (aunque sea la misma de antes): no se toca.
    const kept = planEdit(cfg, tx, { gatewayId: "gw-paypal", extraIds: [], bankAccountId: DEMO.bankAccountId });
    expect("bankAccountId" in kept.fields).toBe(false);
    save(kept, tx);
  });

  test("sin cambiar de empresa ni de pasarela, la cuenta destino elegida a mano se conserva", () => {
    const tx = savedE1({ bankAccountId: "ba-otra" });
    const write = planEdit(cfgDemo(), tx, { extraIds: [], occurredAt: "2026-11-16T15:30:00Z" });
    expect("bankAccountId" in write.fields).toBe(false);
    expect(save(write, tx).bankAccountId).toBe("ba-otra");
  });

  test("cambiar de pasarela sin decir qué opciones lleva no se adivina: las viejas no son de la nueva", () => {
    expectRuleError(() => planEdit(withPayPal(cfgDemo()), savedE1(), { gatewayId: "gw-paypal" }), "opcion");
  });

  test("cambiar de pasarela un cobro sin opciones: basta la pasarela, y la fecha estimada es la suya", () => {
    const tx = savedE1({ extraIds: [] });
    expect(tx.estimatedDepositOn).toBe(MARTES);
    const write = planEdit(withPayPal(cfgDemo()), tx, { gatewayId: "gw-paypal" });
    expect(write.fields).toMatchObject({ gatewayId: "gw-paypal", feesTotal: "8.98", estimatedDepositOn: SABADO });
    expect(write.event.summary).toBe("Editado: pasarela");
    save(write, tx);
  });

  test("referencia, nota y cuenta destino: solo esas columnas, y el reparto no se toca", () => {
    const tx = savedE1();
    const write = planEdit(cfgDemo(), tx, {
      reference: "ch_demo_0002",
      note: "Pagó en dos partes",
      bankAccountId: null,
    });
    expect(write.fields).toEqual({ reference: "ch_demo_0002", note: "Pagó en dos partes", bankAccountId: null });
    expect(write.allocations).toBeNull();
    expect(write.event.summary).toBe("Editado: referencia, nota, cuenta destino");
    save(write, tx);

    const onlyNote = planEdit(cfgDemo(), tx, { note: "Otra nota", reference: "ch_demo_0001" });
    expect(onlyNote.fields).toEqual({ note: "Otra nota" });
    expect(onlyNote.event.summary).toBe("Editado: nota");
  });

  test("lo congelado no se vuelve a calcular si no cambia nada que entre en el cálculo", () => {
    // Un cobro guardado con números que el cálculo de hoy no daría (como si la fórmula hubiera sido otra).
    const e1 = savedE1();
    const old: TxSnapshot = {
      ...e1,
      fees: "9.00",
      net: "91.00",
      breakdown: { ...e1.breakdown, feesTotal: "9.00", net: "91.00" },
    };
    const write = planEdit(cfgDemo(), old, { note: "Solo la nota", occurredAt: "2026-11-13T20:00:00Z" });
    expect(write.fields).toEqual({ note: "Solo la nota", occurredAt: "2026-11-13T20:00:00Z" });
    expect(write.allocations).toBeNull();
    expect(write.event.data).toMatchObject({ antes: { comisiones: "9.00" }, despues: { comisiones: "9.00" } });
  });

  test("otra hora del mismo día: cambia el instante y nada más", () => {
    const tx = savedE1();
    const write = planEdit(withTomorrowFee(cfgDemo()), tx, { occurredAt: "2026-11-13T20:00:00Z" });
    expect(write.fields).toEqual({ occurredAt: "2026-11-13T20:00:00Z" });
    expect(write.allocations).toBeNull();
    expect(write.event.summary).toBe("Editado: fecha");
    save(write, tx);
  });

  test("otro día: fecha nueva, la tarifa y la fecha estimada de ese día", () => {
    const cfg = withTomorrowFee(cfgDemo());
    const tx = savedE1({ extraIds: [] }, cfg);
    const write = planEdit(cfg, tx, { occurredAt: "2026-11-16T15:30:00Z" });
    expect(write.fields).toMatchObject({
      occurredAt: "2026-11-16T15:30:00Z",
      occurredOn: "2026-11-16",
      feeVersionId: "fv-stripe-2",
      feesTotal: "8.80",
      netAmount: "91.20",
      estimatedDepositOn: "2026-11-18",
    });
    expect(write.fields.breakdown?.rules.gateway).toEqual({
      ...tx.breakdown.rules.gateway,
      feeVersionId: "fv-stripe-2",
      pct: "3.5",
    });
    expect(write.event.summary).toBe("Editado: fecha");
    save(write, tx);
  });

  test("otro día sin que cambie ninguna versión: se mueven las fechas y los números quedan como estaban", () => {
    const tx = savedE1({ extraIds: [] });
    const write = planEdit(cfgDemo(), tx, { occurredAt: "2026-11-16T15:30:00Z" });
    expect(write.fields).toEqual({
      occurredAt: "2026-11-16T15:30:00Z",
      occurredOn: "2026-11-16",
      estimatedDepositOn: "2026-11-18",
    });
    expect(write.allocations).toBeNull();
    save(write, tx);
  });

  test("una fecha estimada puesta a mano no se pisa al cambiar la fecha, la pasarela o las opciones", () => {
    const cfg = withPayPal(cfgDemo());
    const tx = savedE1({ estimatedDepositOn: "2026-11-20" });
    const moved = planEdit(cfg, tx, { occurredAt: "2026-11-16T15:30:00Z", gatewayId: "gw-paypal", extraIds: [] });
    expect("estimatedDepositOn" in moved.fields).toBe(false);
    expect(moved.event.summary).toBe("Editado: fecha, pasarela, opciones");
    expect(save(moved, tx).estimatedDepositOn).toBe("2026-11-20");
  });

  test("quitar la opción: sin su comisión y con los días de la pasarela", () => {
    const tx = savedE1();
    const write = planEdit(cfgDemo(), tx, { extraIds: [] });
    expect(lineKinds(write)).toEqual(["pasarela", "plataforma"]);
    expect(write.fields).toMatchObject({ feesTotal: "8.20", netAmount: "91.80", estimatedDepositOn: MARTES });
    expect(write.fields.breakdown?.rules.gateway).toEqual(tx.breakdown.rules.gateway);
    expect(write.event.summary).toBe("Editado: opciones");
    save(write, tx);
  });

  test("poner la opción: con su comisión y cae el mismo día", () => {
    const tx = savedE1({ extraIds: [] });
    const write = planEdit(cfgDemo(), tx, { extraIds: [DEMO.extraId] });
    expect(write.fields).toMatchObject({ feesTotal: "9.70", netAmount: "90.30", estimatedDepositOn: VIERNES });
    save(write, tx);
  });

  test("quitar el canal: sin plataforma", () => {
    const tx = savedE1();
    const write = planEdit(cfgDemo(), tx, { channelId: null });
    expect(lineKinds(write)).toEqual(["pasarela", "opcion"]);
    expect(write.fields).toMatchObject({ channelId: null, feesTotal: "4.70", netAmount: "95.30" });
    expect("estimatedDepositOn" in write.fields).toBe(false);
    expect(write.event.summary).toBe("Editado: canal");
    save(write, tx);
  });

  test("quitar el esquema: sin reparto", () => {
    const tx = savedE1();
    const write = planEdit(cfgDemo(), tx, { schemeId: null });
    expect(write.fields).toMatchObject({
      schemeId: null,
      schemeVersionId: null,
      allocBase: null,
      allocBaseAmount: "0.00",
    });
    expect("netAmount" in write.fields).toBe(false);
    expect(write.allocations).toEqual([]);
    expect(write.event.summary).toBe("Editado: esquema");
    save(write, tx);
  });

  test("poner un esquema a un cobro que no tenía", () => {
    const tx = savedE1({ schemeId: null });
    const write = planEdit(cfgDemo(), tx, { schemeId: DEMO.schemeId });
    expect(write.fields).toMatchObject({ schemeId: DEMO.schemeId, schemeVersionId: DEMO.schemeVersionId });
    expect(shares(write)).toEqual(["45.15", "27.09", "18.06"]);
    save(write, tx);
  });

  describe("cambiar de empresa", () => {
    function cfgWithShop(): PayConfig {
      const cfg = cfgDemo();
      cfg.companies.push({
        id: "co-tienda",
        name: "Tienda Demo",
        currency: "USD",
        defaultSchemeId: null,
        active: true,
      });
      cfg.channels.push({
        id: "ch-tienda",
        companyId: "co-tienda",
        name: "Tienda en línea",
        platformFeePct: "2",
        platformFeeFixed: "0.00",
        active: true,
      });
      return cfg;
    }

    test("el canal viejo no es de la empresa nueva: hay que decir cuál", () => {
      expectRuleError(() => planEdit(cfgWithShop(), savedE1(), { companyId: "co-tienda" }), "canal");
    });

    test("con un canal suyo: su plataforma", () => {
      const tx = savedE1();
      const write = planEdit(cfgWithShop(), tx, { companyId: "co-tienda", channelId: "ch-tienda" });
      expect(write.fields).toMatchObject({ companyId: "co-tienda", channelId: "ch-tienda", feesTotal: "6.70" });
      expect(write.event.summary).toBe("Editado: empresa, canal");
      save(write, tx);
    });

    /** «Tienda Demo» con su propia cuenta de Stripe: cae en otra cuenta destino y tarda 5 días hábiles. */
    function cfgWithShopAccount(): PayConfig {
      const cfg = cfgWithShop();
      cfg.bankAccounts.push({
        id: "ba-tienda",
        alias: "Cuenta de la tienda",
        last4: "9876",
        currency: "USD",
        active: true,
      });
      cfg.companyGateways.push({
        id: "cg-tienda-stripe",
        companyId: "co-tienda",
        gatewayId: DEMO.gatewayId,
        bankAccountId: "ba-tienda",
        payoutDaysOverride: 5,
        defaultExtraIds: null,
        active: true,
      });
      return cfg;
    }

    test("un cobro sin canal: cambia la empresa, y la cuenta destino pasa a ser la suya (aquí, ninguna)", () => {
      const tx = savedE1({ channelId: null });
      expect(tx.bankAccountId).toBe(DEMO.bankAccountId);
      // «Tienda Demo» no tiene cuenta de Stripe: no hay cuenta destino por defecto. Con «Pago rápido» cae el mismo
      // día, así que la fecha estimada no se mueve.
      const write = planEdit(cfgWithShop(), tx, { companyId: "co-tienda" });
      expect(write.fields).toEqual({ companyId: "co-tienda", bankAccountId: null });
      expect(write.allocations).toBeNull();
      expect(write.event.summary).toBe("Editado: empresa");
      save(write, tx);
    });

    test("la fecha estimada automática y la cuenta destino son las de la empresa nueva", () => {
      const tx = savedE1({ channelId: null, extraIds: [] });
      expect([tx.estimatedDepositOn, tx.bankAccountId]).toEqual([MARTES, DEMO.bankAccountId]);
      const write = planEdit(cfgWithShopAccount(), tx, { companyId: "co-tienda" });
      // Viernes 13 + 5 días hábiles (los de la cuenta de Stripe de la tienda) = viernes 20.
      expect(write.fields).toEqual({
        companyId: "co-tienda",
        bankAccountId: "ba-tienda",
        estimatedDepositOn: "2026-11-20",
      });
      expect(write.allocations).toBeNull();
      expect(write.event.summary).toBe("Editado: empresa");
      expect(write.event.data).toMatchObject({
        antes: { fechaEstimada: MARTES },
        despues: { fechaEstimada: "2026-11-20" },
      });
      save(write, tx);
    });

    test("una fecha estimada puesta a mano no se pisa al cambiar de empresa; la cuenta destino sí cambia", () => {
      const tx = savedE1({ channelId: null, extraIds: [], estimatedDepositOn: "2026-11-25" });
      const write = planEdit(cfgWithShopAccount(), tx, { companyId: "co-tienda" });
      expect(write.fields).toEqual({ companyId: "co-tienda", bankAccountId: "ba-tienda" });
      expect(save(write, tx).estimatedDepositOn).toBe("2026-11-25");
    });

    test("con la cuenta destino dicha en la edición, manda esa y no la de la empresa nueva", () => {
      const tx = savedE1({ channelId: null });
      const kept = planEdit(cfgWithShopAccount(), tx, { companyId: "co-tienda", bankAccountId: DEMO.bankAccountId });
      expect("bankAccountId" in kept.fields).toBe(false);
      expect(kept.event.summary).toBe("Editado: empresa");
      save(kept, tx);

      const none = planEdit(cfgWithShopAccount(), tx, { companyId: "co-tienda", bankAccountId: null });
      expect(none.fields.bankAccountId).toBeNull();
      expect(none.event.summary).toBe("Editado: empresa, cuenta destino");
      save(none, tx);
    });

    test("a una empresa que no existe, no", () => {
      const tx = savedE1({ channelId: null });
      expectRuleError(() => planEdit(cfgWithShop(), tx, { companyId: "co-fantasma" }), "empresa");
    });
  });

  test("cambiar la moneda: mismo cálculo, otra moneda en la columna y en el desglose", () => {
    const tx = savedE1();
    const write = planEdit(cfgDemo(), tx, { currency: "EUR" });
    expect(fieldNames(write)).toEqual(["breakdown", "currency"]);
    expect(write.fields.currency).toBe("EUR");
    expect(write.fields.breakdown).toEqual({ ...tx.breakdown, currency: "EUR" });
    expect(write.event.summary).toBe("Editado: moneda");
    save(write, tx);
  });

  test("conserva el reembolso y la disputa: el monto nuevo se calcula con ellos", () => {
    let tx = savedE1();
    tx = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
    tx = save(planDispute(tx, { action: "abrir", on: "2026-11-17" }), tx);
    const write = planEdit(cfgDemo(), tx, { grossOriginal: "200.00" });
    expect(write.fields.breakdown?.state).toEqual({
      grossOriginal: "200.00",
      refunded: "40.00",
      dispute: "abierta",
      failed: false,
    });
    expect(write.fields.grossAmount).toBe("160.00");
    expect(lineKinds(write)).toEqual(["pasarela", "reembolso", "opcion", "plataforma", "disputa"]);
    expect("refundedAmount" in write.fields).toBe(false);
    save(write, tx);
  });

  test("con la disputa perdida, subir el monto sube el reembolso total: no queda nada que repartir", () => {
    const tx = lostE1();
    const write = planEdit(cfgDemo(), tx, { grossOriginal: "200.00" });
    expect(write.fields.breakdown?.state).toEqual({
      grossOriginal: "200.00",
      refunded: "200.00",
      dispute: "perdida",
      failed: false,
    });
    expect(fieldNames(write)).toEqual([
      "allocBaseAmount",
      "breakdown",
      "feesTotal",
      "grossOriginal",
      "netAmount",
      "refundedAmount",
    ]);
    // Lo que la pasarela se queda de 200,00 (6,10) más la disputa (15,00): pérdida, repartida 50/30/20.
    expect(write.fields).toMatchObject({
      grossOriginal: "200.00",
      refundedAmount: "200.00",
      feesTotal: "21.10",
      netAmount: "-21.10",
      allocBaseAmount: "-21.10",
    });
    expect(shares(write)).toEqual(["-10.55", "-6.33", "-4.22"]);
    expect(write.event.data).toMatchObject({
      antes: { bruto: "0.00", reembolsado: "100.00", disputa: "perdida" },
      despues: { bruto: "0.00", reembolsado: "200.00", disputa: "perdida" },
    });
    const edited = save(write, tx);
    expect([edited.grossOriginal, edited.refunded, edited.gross]).toEqual(["200.00", "200.00", "0.00"]);
  });

  test("con la disputa perdida, un monto mal tecleado también se corrige hacia abajo", () => {
    const tx = lostE1();
    const write = planEdit(cfgDemo(), tx, { grossOriginal: "50.00" });
    expect(write.fields).toMatchObject({
      grossOriginal: "50.00",
      refundedAmount: "50.00",
      feesTotal: "16.75",
      netAmount: "-16.75",
    });
    expect(shares(write)).toEqual(["-8.38", "-5.02", "-3.35"]);
    const edited = save(write, tx);
    expect([edited.refunded, edited.gross, edited.disputeState]).toEqual(["50.00", "0.00", "perdida"]);
  });

  test("con la disputa perdida, cambiar otra cosa deja el reembolso total como estaba", () => {
    const tx = lostE1();
    const write = planEdit(withPayPal(cfgDemo()), tx, { gatewayId: "gw-paypal", extraIds: [] });
    expect(write.fields.breakdown?.state).toEqual(tx.breakdown.state);
    expect("refundedAmount" in write.fields).toBe(false);
    // PayPal devuelve su comisión al reembolsar: solo queda su costo de disputa.
    expect(write.fields).toMatchObject({ feesTotal: "20.00", netAmount: "-20.00" });
    save(write, tx);
  });

  test("un cobro fallido se puede corregir y sigue fallido, en cero", () => {
    let tx = savedE1();
    tx = save(planFail(tx), tx);
    const write = planEdit(cfgDemo(), tx, { grossOriginal: "200.00" });
    expect(fieldNames(write)).toEqual(["breakdown", "grossOriginal"]);
    expect(write.fields.breakdown?.state.failed).toBe(true);
    expect(shares(write)).toEqual(["0.00", "0.00", "0.00"]);
    expect(save(write, tx).status).toBe("fallido");
  });

  test("el monto no puede bajar de lo ya reembolsado (pero sí igualarlo)", () => {
    let tx = savedE1();
    tx = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
    expectStateError(() => planEdit(cfgDemo(), tx, { grossOriginal: "39.99" }), "reembolso_excede");
    const write = planEdit(cfgDemo(), tx, { grossOriginal: "40.00" });
    expect(write.fields.grossAmount).toBe("0.00");
    save(write, tx);
  });

  test("sin cambios no hay nada que guardar", () => {
    const tx = savedE1();
    expectStateError(() => planEdit(cfgDemo(), tx, {}), "sin_cambios");
    const same = {
      companyId: tx.companyId,
      channelId: tx.channelId,
      gatewayId: tx.gatewayId,
      extraIds: [DEMO.extraId, DEMO.extraId],
      schemeId: tx.schemeId,
      // El mismo instante, escrito como lo devuelve la base.
      occurredAt: "2026-11-13T10:30:00-05:00",
      currency: tx.currency,
      grossOriginal: tx.grossOriginal,
      reference: tx.reference,
      note: tx.note,
      bankAccountId: tx.bankAccountId,
    };
    expectStateError(() => planEdit(cfgDemo(), tx, same), "sin_cambios");
  });

  test("todo a la vez: el resumen lista lo que cambió, siempre en el mismo orden", () => {
    const cfg = withPayPal(cfgDemo());
    cfg.companies.push({ id: "co-tienda", name: "Tienda Demo", currency: "EUR", defaultSchemeId: null, active: true });
    const tx = savedE1();
    const write = planEdit(cfg, tx, {
      bankAccountId: "ba-otra",
      note: "Corregido",
      reference: "pp_demo_0001",
      schemeId: null,
      extraIds: [],
      gatewayId: "gw-paypal",
      channelId: null,
      companyId: "co-tienda",
      occurredAt: "2026-11-16T15:30:00Z",
      currency: "EUR",
      grossOriginal: "50.00",
    });
    expect(write.event.summary).toBe(
      "Editado: monto, moneda, fecha, empresa, canal, pasarela, opciones, esquema, referencia, nota, cuenta destino",
    );
    expect(write.fields).toMatchObject({ companyId: "co-tienda", currency: "EUR", estimatedDepositOn: "2026-11-17" });
    save(write, tx);
  });
});

// ─── Reembolsos ─────────────────────────────────────────────────────────────────────────────────────────────

describe("planRefund", () => {
  test("E5: reembolso parcial de 40,00", () => {
    const tx = savedE1();
    const write = planRefund(tx, { amount: "40.00", on: "2026-11-16", note: "Devolvió un módulo" });
    expect(fieldNames(write)).toEqual([
      "allocBaseAmount",
      "breakdown",
      "feesTotal",
      "grossAmount",
      "netAmount",
      "refundedAmount",
    ]);
    expect(write.fields).toMatchObject({
      refundedAmount: "40.00",
      grossAmount: "60.00",
      feesTotal: "7.10",
      netAmount: "52.90",
      allocBaseAmount: "52.90",
    });
    expect(write.fields.breakdown?.lines.map((line) => [line.kind, line.amount])).toEqual([
      ["pasarela", "2.04"],
      ["reembolso", "1.16"],
      ["opcion", "0.90"],
      ["plataforma", "3.00"],
    ]);
    expect(shares(write)).toEqual(["26.45", "15.87", "10.58"]);
    expect(write.event.kind).toBe("reembolso");
    expect(write.event.summary).toBe("Reembolso de $40,00");
    expect(write.event.data).toMatchObject({
      antes: { bruto: "100.00", reembolsado: "0.00", neto: "90.30" },
      despues: { bruto: "60.00", reembolsado: "40.00", neto: "52.90" },
      monto: "40.00",
      fecha: "2026-11-16",
      nota: "Devolvió un módulo",
    });
    save(write, tx);
  });

  test("40 y después 60 suman el total (E4); un tercero ya no cabe", () => {
    let tx = savedE1();
    tx = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
    const second = planRefund(tx, { amount: "60.00", on: "2026-11-17", note: null });
    expect(second.fields).toMatchObject({
      refundedAmount: "100.00",
      grossAmount: "0.00",
      feesTotal: "3.20",
      netAmount: "-3.20",
    });
    expect(shares(second)).toEqual(["-1.60", "-0.96", "-0.64"]);
    expect(second.event.summary).toBe("Reembolso de $60,00");
    expect(second.event.data).toMatchObject({ monto: "60.00", fecha: "2026-11-17", nota: null });
    tx = save(second, tx);

    expectStateError(() => planRefund(tx, { amount: "0.01", on: "2026-11-18" }), "reembolso_excede");
  });

  test("sin nota, la nota del evento es nula", () => {
    const write = planRefund(savedE1(), { amount: "40.00", on: "2026-11-16" });
    expect(write.event.data).toMatchObject({ nota: null });
  });

  test("más que lo cobrado, de una sola vez, tampoco", () => {
    expectStateError(() => planRefund(savedE1(), { amount: "100.01", on: "2026-11-16" }), "reembolso_excede");
  });

  test("el monto tiene que ser mayor que cero y venir con dos decimales", () => {
    const tx = savedE1();
    for (const amount of ["0.00", "-5.00", "40", "40.005", "cuarenta"]) {
      expectStateError(() => planRefund(tx, { amount, on: "2026-11-16" }), "monto_invalido");
    }
  });

  test("un cobro fallido no se reembolsa", () => {
    let tx = savedE1();
    tx = save(planFail(tx), tx);
    expectStateError(() => planRefund(tx, { amount: "40.00", on: "2026-11-16" }), "fallido");
  });

  test("un cobro ya depositado sí se puede reembolsar, y sigue depositado", () => {
    let tx = savedE1();
    tx = save(planDeposit(tx, VIERNES), tx);
    tx = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
    expect([tx.status, tx.depositedOn, tx.refunded]).toEqual(["depositado", VIERNES, "40.00"]);
  });
});

describe("planRefundTotal", () => {
  test("corrige el total reembolsado en vez de sumarle", () => {
    let tx = savedE1();
    tx = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
    const write = planRefundTotal(tx, "25.00");
    expect(write.fields).toMatchObject({ refundedAmount: "25.00", grossAmount: "75.00" });
    expect(write.event.kind).toBe("reembolso");
    expect(write.event.summary).toBe("Reembolso corregido a $25,00");
    expect(write.event.data).toMatchObject({ antes: { reembolsado: "40.00" }, despues: { reembolsado: "25.00" } });
    save(write, tx);
  });

  test("a cero: el cobro vuelve a ser E1", () => {
    let tx = savedE1();
    const original = tx.breakdown;
    tx = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
    const write = planRefundTotal(tx, "0.00");
    expect(write.fields.breakdown).toEqual(original);
    expect(shares(write)).toEqual(["45.15", "27.09", "18.06"]);
    save(write, tx);
  });

  test("al total: reembolso completo", () => {
    const tx = savedE1();
    const write = planRefundTotal(tx, "100.00");
    expect(write.fields).toMatchObject({ refundedAmount: "100.00", grossAmount: "0.00", netAmount: "-3.20" });
    save(write, tx);
  });

  test("ni más que lo cobrado, ni negativo, ni sin dos decimales", () => {
    const tx = savedE1();
    expectStateError(() => planRefundTotal(tx, "100.01"), "reembolso_excede");
    expectStateError(() => planRefundTotal(tx, "-0.01"), "monto_invalido");
    expectStateError(() => planRefundTotal(tx, "25"), "monto_invalido");
  });

  test("un cobro fallido no se reembolsa", () => {
    let tx = savedE1();
    tx = save(planFail(tx), tx);
    expectStateError(() => planRefundTotal(tx, "25.00"), "fallido");
  });

  test("con la disputa perdida el reembolso es total: no se corrige a menos, ni a cero, ni a más", () => {
    const tx = lostE1();
    for (const total of ["25.00", "0.00", "99.99", "100.01"]) {
      expectStateError(() => planRefundTotal(tx, total), "disputa_perdida");
    }
    // Sigue pudiendo decirse lo que ya es: todo reembolsado, sin nada que cambiar.
    const write = planRefundTotal(tx, "100.00");
    expect(write.fields).toEqual({});
    expect(write.allocations).toBeNull();
    save(write, tx);
  });

  test("con la disputa perdida tampoco se le suma un reembolso: ya está todo reembolsado", () => {
    expectStateError(() => planRefund(lostE1(), { amount: "0.01", on: "2026-11-21" }), "reembolso_excede");
  });

  test("con la disputa abierta o ganada el reembolso se sigue corrigiendo", () => {
    let tx = savedE1();
    tx = save(planDispute(tx, { action: "abrir", on: "2026-11-16" }), tx);
    tx = save(planRefundTotal(tx, "25.00"), tx);
    tx = save(planDispute(tx, { action: "ganar", on: "2026-11-20" }), tx);
    tx = save(planRefundTotal(tx, "0.00"), tx);
    expect([tx.refunded, tx.gross, tx.disputeState]).toEqual(["0.00", "100.00", "ganada"]);
  });
});

// ─── Disputas ───────────────────────────────────────────────────────────────────────────────────────────────

describe("planDispute", () => {
  const open = (tx: TxSnapshot): TxSnapshot => save(planDispute(tx, { action: "abrir", on: "2026-11-16" }), tx);

  test("E6, abrir: la disputa cuesta 15,00 mientras está abierta", () => {
    const tx = savedE1();
    const write = planDispute(tx, { action: "abrir", on: "2026-11-16" });
    expect(fieldNames(write)).toEqual([
      "allocBaseAmount",
      "breakdown",
      "disputeOpenedOn",
      "disputeState",
      "feesTotal",
      "netAmount",
    ]);
    expect(write.fields).toMatchObject({
      disputeState: "abierta",
      disputeOpenedOn: "2026-11-16",
      feesTotal: "24.70",
      netAmount: "75.30",
    });
    expect(shares(write)).toEqual(["37.65", "22.59", "15.06"]);
    expect(write.event).toMatchObject({
      kind: "disputa_abierta",
      summary: "Disputa abierta",
      data: { antes: { disputa: null }, despues: { disputa: "abierta" }, fecha: "2026-11-16" },
    });
    save(write, tx);
  });

  test("E6, ganar: vuelve a E1 y queda la fecha de cierre", () => {
    const e1 = savedE1();
    const tx = open(e1);
    const write = planDispute(tx, { action: "ganar", on: "2026-11-20" });
    expect(write.fields).toMatchObject({
      disputeState: "ganada",
      disputeClosedOn: "2026-11-20",
      feesTotal: "9.70",
      netAmount: "90.30",
    });
    expect("disputeOpenedOn" in write.fields).toBe(false);
    expect(write.fields.breakdown?.lines).toEqual(e1.breakdown.lines);
    expect(shares(write)).toEqual(["45.15", "27.09", "18.06"]);
    expect(write.event).toMatchObject({
      kind: "disputa_ganada",
      summary: "Disputa ganada",
      data: { fecha: "2026-11-20" },
    });
    save(write, tx);
  });

  test("perder: reembolso total, la línea de la disputa y la fecha de cierre", () => {
    const tx = open(savedE1());
    const write = planDispute(tx, { action: "perder", on: "2026-11-20" });
    expect(write.fields).toMatchObject({
      disputeState: "perdida",
      disputeClosedOn: "2026-11-20",
      refundedAmount: "100.00",
      grossAmount: "0.00",
      feesTotal: "18.20",
      netAmount: "-18.20",
    });
    expect(write.fields.refundedAmount).toBe(tx.grossOriginal);
    expect(
      write.fields.breakdown?.lines.filter((line) => line.amount !== "0.00").map((line) => [line.kind, line.amount]),
    ).toEqual([
      ["reembolso", "3.20"],
      ["disputa", "15.00"],
    ]);
    expect(shares(write)).toEqual(["-9.10", "-5.46", "-3.64"]);
    expect(write.event).toMatchObject({
      kind: "disputa_perdida",
      summary: "Disputa perdida",
      data: { fecha: "2026-11-20" },
    });
    save(write, tx);
  });

  test("perder un cobro con reembolso parcial: el reembolso pasa a ser total", () => {
    let tx = savedE1();
    tx = save(planRefund(tx, { amount: "40.00", on: "2026-11-15" }), tx);
    tx = open(tx);
    const lost = save(planDispute(tx, { action: "perder", on: "2026-11-20" }), tx);
    expect([lost.refunded, lost.gross]).toEqual(["100.00", "0.00"]);
  });

  test("anular: como si no hubiera habido disputa", () => {
    const e1 = savedE1();
    const tx = open(e1);
    const write = planDispute(tx, { action: "anular", on: "2026-11-20" });
    expect(write.fields).toMatchObject({ disputeState: null, disputeOpenedOn: null, feesTotal: "9.70" });
    expect("disputeClosedOn" in write.fields).toBe(false);
    expect(write.fields.breakdown).toEqual(e1.breakdown);
    expect(write.event).toMatchObject({
      kind: "disputa_anulada",
      summary: "Disputa anulada",
      data: { fecha: "2026-11-20" },
    });
    const annulled = save(write, tx);
    expect([annulled.disputeState, annulled.disputeOpenedOn, annulled.disputeClosedOn]).toEqual([null, null, null]);
  });

  test("una disputa ganada se puede volver a abrir: fecha de apertura nueva y sin fecha de cierre", () => {
    let tx = open(savedE1());
    tx = save(planDispute(tx, { action: "ganar", on: "2026-11-20" }), tx);
    const write = planDispute(tx, { action: "abrir", on: "2026-11-25" });
    expect(write.fields).toMatchObject({
      disputeState: "abierta",
      disputeOpenedOn: "2026-11-25",
      disputeClosedOn: null,
      feesTotal: "24.70",
    });
    save(write, tx);
  });

  test("abrir solo desde «sin disputa» o «ganada»", () => {
    const opened = open(savedE1());
    expectStateError(() => planDispute(opened, { action: "abrir", on: "2026-11-21" }), "disputa_existente");
    const lost = save(planDispute(opened, { action: "perder", on: "2026-11-20" }), opened);
    expectStateError(() => planDispute(lost, { action: "abrir", on: "2026-11-21" }), "disputa_existente");
  });

  test("ganar, perder y anular solo desde «abierta»", () => {
    const none = savedE1();
    const opened = open(savedE1());
    const won = save(planDispute(opened, { action: "ganar", on: "2026-11-20" }), opened);
    const lost = save(planDispute(opened, { action: "perder", on: "2026-11-20" }), opened);
    for (const tx of [none, won, lost]) {
      for (const action of ["ganar", "perder", "anular"] as const) {
        expectStateError(() => planDispute(tx, { action, on: "2026-11-21" }), "sin_disputa_abierta");
      }
    }
  });

  test("un cobro fallido no se disputa", () => {
    let tx = savedE1();
    tx = save(planFail(tx), tx);
    expectStateError(() => planDispute(tx, { action: "abrir", on: "2026-11-16" }), "fallido");
  });
});

// ─── Fallido y reabrir ──────────────────────────────────────────────────────────────────────────────────────

describe("planFail", () => {
  test("todo a cero: bruto vigente, comisiones, neto, base y cada línea del reparto", () => {
    const tx = savedE1();
    const write = planFail(tx);
    expect(fieldNames(write)).toEqual([
      "allocBaseAmount",
      "breakdown",
      "feesTotal",
      "grossAmount",
      "netAmount",
      "status",
    ]);
    expect(write.fields).toMatchObject({
      status: "fallido",
      grossAmount: "0.00",
      feesTotal: "0.00",
      netAmount: "0.00",
      allocBaseAmount: "0.00",
    });
    expect(write.fields.breakdown?.lines).toEqual([]);
    expect(write.fields.breakdown?.state.failed).toBe(true);
    expect(write.allocations?.map((line) => [line.beneficiaryId, line.amount])).toEqual([
      [DEMO.beneficiaryIds.a, "0.00"],
      [DEMO.beneficiaryIds.b, "0.00"],
      [DEMO.beneficiaryIds.c, "0.00"],
    ]);
    expect(write.event).toMatchObject({ kind: "fallido", summary: "Marcado como fallido" });
    const failed = save(write, tx);
    // Lo cobrado no se pierde: hace falta para reabrir.
    expect(failed.grossOriginal).toBe("100.00");
  });

  test("también desde «en tránsito»", () => {
    let tx = savedE1();
    tx = save(planTransit(tx), tx);
    expect(save(planFail(tx), tx).status).toBe("fallido");
  });

  test("no con depósito, ni con reembolso, ni con disputa (aunque esté ganada), ni dos veces", () => {
    const e1 = savedE1();
    expectStateError(() => planFail(save(planDeposit(e1, VIERNES), e1)), "depositado");
    expectStateError(() => planFail(save(planRefund(e1, { amount: "0.01", on: VIERNES }), e1)), "con_reembolso");
    const disputed = save(planDispute(e1, { action: "abrir", on: VIERNES }), e1);
    expectStateError(() => planFail(disputed), "con_disputa");
    const won = save(planDispute(disputed, { action: "ganar", on: SABADO }), disputed);
    expectStateError(() => planFail(won), "con_disputa");
    expectStateError(() => planFail(save(planFail(e1), e1)), "fallido");
  });
});

describe("planReopen", () => {
  test("un fallido vuelve a «registrado» con los números de antes", () => {
    const e1 = savedE1();
    const failed = save(planFail(e1), e1);
    const write = planReopen(failed);
    expect(write.fields).toMatchObject({
      status: "registrado",
      grossAmount: "100.00",
      feesTotal: "9.70",
      netAmount: "90.30",
      allocBaseAmount: "90.30",
    });
    expect(write.fields.breakdown).toEqual(e1.breakdown);
    expect(shares(write)).toEqual(["45.15", "27.09", "18.06"]);
    expect(write.event).toMatchObject({ kind: "reabierto", summary: "Reabierto" });
    save(write, failed);
  });

  test("solo se reabre un fallido", () => {
    const e1 = savedE1();
    expectStateError(() => planReopen(e1), "no_fallido");
    expectStateError(() => planReopen(save(planTransit(e1), e1)), "no_fallido");
    expectStateError(() => planReopen(save(planDeposit(e1, VIERNES), e1)), "no_fallido");
  });
});

// ─── El camino del dinero: en tránsito, depositado, revertir ────────────────────────────────────────────────

describe("planTransit", () => {
  test("de «registrado» a «en tránsito», sin tocar números ni reparto", () => {
    const tx = savedE1();
    const write = planTransit(tx);
    expect(write.fields).toEqual({ status: "en_transito" });
    expect(write.allocations).toBeNull();
    expect(write.event).toMatchObject({
      kind: "en_transito",
      summary: "En tránsito",
      data: { antes: { estado: "registrado" }, despues: { estado: "en_transito" } },
    });
    save(write, tx);
  });

  test("solo desde «registrado»", () => {
    const e1 = savedE1();
    expectStateError(() => planTransit(save(planTransit(e1), e1)), "en_transito");
    expectStateError(() => planTransit(save(planDeposit(e1, VIERNES), e1)), "depositado");
    expectStateError(() => planTransit(save(planFail(e1), e1)), "fallido");
  });
});

describe("planDeposit", () => {
  test("desde «registrado»: depositado, con su fecha, y el reparto no se toca", () => {
    const tx = savedE1();
    const write = planDeposit(tx, VIERNES);
    expect(write.fields).toEqual({ status: "depositado", depositedOn: VIERNES });
    expect(write.allocations).toBeNull();
    expect(write.event).toMatchObject({
      kind: "depositado",
      summary: "Depositado el vie 13 nov 2026",
      data: {
        antes: { estado: "registrado", depositadoEl: null },
        despues: { estado: "depositado", depositadoEl: VIERNES },
      },
    });
    save(write, tx);
  });

  test("desde «en tránsito»", () => {
    let tx = savedE1();
    tx = save(planTransit(tx), tx);
    const write = planDeposit(tx, MARTES);
    expect(write.fields).toEqual({ status: "depositado", depositedOn: MARTES });
    save(write, tx);
  });

  test("si ya está depositado, cambia la fecha", () => {
    let tx = savedE1();
    tx = save(planDeposit(tx, VIERNES), tx);
    const write = planDeposit(tx, MARTES);
    expect(write.fields).toEqual({ depositedOn: MARTES });
    expect(write.event.summary).toBe("Depositado el mar 17 nov 2026");
    save(write, tx);
  });

  test("un fallido no se deposita", () => {
    const e1 = savedE1();
    expectStateError(() => planDeposit(save(planFail(e1), e1), VIERNES), "fallido");
  });

  test("la fecha del depósito no puede ser anterior a la del cobro", () => {
    expectStateError(() => planDeposit(savedE1(), "2026-11-12"), "deposito_antes_del_cobro");
    expectStateError(() => planDeposit(savedE1(), "2026-11-12", { onlyPending: true }), "deposito_antes_del_cobro");
  });

  describe("solo lo que está por caer (el lote)", () => {
    const pendingOnly = { onlyPending: true };

    test("registrado o en tránsito: se deposita igual que sin la marca", () => {
      const tx = savedE1();
      expect(planDeposit(tx, MARTES, pendingOnly).fields).toEqual({ status: "depositado", depositedOn: MARTES });
      const moving = save(planTransit(tx), tx);
      expect(planDeposit(moving, MARTES, pendingOnly).fields).toEqual({ status: "depositado", depositedOn: MARTES });
    });

    test("con un reembolso parcial sigue por caer", () => {
      const tx = savedE1();
      const partial = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
      expect(planDeposit(partial, MARTES, pendingOnly).fields).toEqual({ status: "depositado", depositedOn: MARTES });
    });

    test("uno ya depositado se salta: su fecha real no se pisa", () => {
      const tx = savedE1();
      const deposited = save(planDeposit(tx, VIERNES), tx);
      expectStateError(() => planDeposit(deposited, MARTES, pendingOnly), "depositado");
    });

    test("con la disputa abierta o reembolsado del todo no está por caer", () => {
      const tx = savedE1();
      const disputed = save(planDispute(tx, { action: "abrir", on: "2026-11-16" }), tx);
      expectStateError(() => planDeposit(disputed, MARTES, pendingOnly), "no_por_caer");
      const refunded = save(planRefund(tx, { amount: "100.00", on: "2026-11-16" }), tx);
      expectStateError(() => planDeposit(refunded, MARTES, pendingOnly), "no_por_caer");
      // Sin la marca (el detalle de un cobro), se puede.
      expect(planDeposit(disputed, MARTES).fields).toEqual({ status: "depositado", depositedOn: MARTES });
    });

    test("un fallido o uno en la papelera, igual que sin la marca", () => {
      const e1 = savedE1();
      expectStateError(() => planDeposit(save(planFail(e1), e1), VIERNES, pendingOnly), "fallido");
      const trashed = save(planTrash(e1, "2026-11-14T12:00:00Z"), e1);
      expectStateError(() => planDeposit(trashed, VIERNES, pendingOnly), "en_papelera");
    });
  });

  test("una fecha que no existe no se guarda", () => {
    expect(() => planDeposit(savedE1(), "2026-02-30")).toThrow(RangeError);
  });
});

describe("planRevertDeposit", () => {
  test("de «depositado» a «en tránsito», sin fecha de depósito", () => {
    let tx = savedE1();
    tx = save(planDeposit(tx, VIERNES), tx);
    const write = planRevertDeposit(tx);
    expect(write.fields).toEqual({ status: "en_transito", depositedOn: null });
    expect(write.allocations).toBeNull();
    expect(write.event).toMatchObject({ kind: "deposito_revertido", summary: "Depósito revertido" });
    save(write, tx);
  });

  test("solo si está depositado", () => {
    const e1 = savedE1();
    expectStateError(() => planRevertDeposit(e1), "no_depositado");
    expectStateError(() => planRevertDeposit(save(planTransit(e1), e1)), "no_depositado");
    expectStateError(() => planRevertDeposit(save(planFail(e1), e1)), "no_depositado");
  });
});

// ─── Fecha estimada ─────────────────────────────────────────────────────────────────────────────────────────

describe("planEstimated", () => {
  test("con fecha: esa, y queda marcada como manual", () => {
    const tx = savedE1();
    const write = planEstimated(cfgDemo(), tx, MARTES);
    expect(write.fields).toEqual({ estimatedDepositOn: MARTES, estimatedIsManual: true });
    expect(write.allocations).toBeNull();
    expect(write.event).toMatchObject({
      kind: "fecha_estimada",
      summary: "Fecha estimada: mar 17 nov 2026",
      data: { antes: { fechaEstimada: VIERNES }, despues: { fechaEstimada: MARTES } },
    });
    save(write, tx);
  });

  test("con null: vuelve a la automática, con las opciones congeladas en el cobro", () => {
    // La opción «Pago rápido» ya no está en la configuración, pero el cobro la lleva congelada: 0 días.
    const cfg = cfgDemo();
    stripe(cfg).extras = [];
    const tx = savedE1({ estimatedDepositOn: "2026-11-20" });
    const write = planEstimated(cfg, tx, null);
    expect(write.fields).toEqual({ estimatedDepositOn: VIERNES, estimatedIsManual: false });
    expect(write.event).toMatchObject({ kind: "fecha_estimada", summary: "Fecha estimada automática" });
    save(write, tx);
  });

  test("la automática de un cobro sin opciones: los días de la cuenta de esa empresa o los de la pasarela", () => {
    const tx = savedE1({ extraIds: [], estimatedDepositOn: "2026-11-20" });
    expect(planEstimated(cfgDemo(), tx, null).fields.estimatedDepositOn).toBe(MARTES);
    const cfg = cfgDemo();
    only(cfg.companyGateways).payoutDaysOverride = 1;
    expect(planEstimated(cfg, tx, null).fields.estimatedDepositOn).toBe("2026-11-16");
  });

  test("una fecha que no existe no se guarda", () => {
    expect(() => planEstimated(cfgDemo(), savedE1(), "2026-02-30")).toThrow(RangeError);
  });
});

// ─── Recalcular ─────────────────────────────────────────────────────────────────────────────────────────────

describe("planRecalc", () => {
  test("«vigente desde mañana», con la tarifa de hoy: el cobro del 13 pasa a pagar 3,80 y el antes y después lo dice", () => {
    const cfg = withTomorrowFee(cfgDemo());
    const tx = savedE1({}, cfg);
    const { write, changes } = planRecalc(cfg, tx, "hoy", "2026-11-20");
    expect(only(write.fields.breakdown?.lines.filter((line) => line.kind === "pasarela") ?? []).amount).toBe("3.80");
    expect(write.fields).toMatchObject({
      feeVersionId: "fv-stripe-2",
      feesTotal: "10.30",
      netAmount: "89.70",
      allocBaseAmount: "89.70",
    });
    expect(shares(write)).toEqual(["44.85", "26.91", "17.94"]);
    expect(changes).toEqual([
      { key: `line:pasarela:${DEMO.gatewayId}`, label: "Stripe", before: "3.20", after: "3.80" },
      { key: "feesTotal", label: "Comisiones", before: "9.70", after: "10.30" },
      { key: "net", label: "Neto", before: "90.30", after: "89.70" },
      { key: `alloc:${DEMO.beneficiaryIds.a}`, label: "Grupo A", before: "45.15", after: "44.85" },
      { key: `alloc:${DEMO.beneficiaryIds.b}`, label: "Grupo B", before: "27.09", after: "26.91" },
      { key: `alloc:${DEMO.beneficiaryIds.c}`, label: "Grupo C", before: "18.06", after: "17.94" },
    ]);
    expect(write.event).toMatchObject({ kind: "recalculado", summary: "Recalculado con la tarifa de hoy" });
    save(write, tx);
  });

  test("con la tarifa de la fecha del cobro no cambia nada: no hay nada que escribir", () => {
    const cfg = withTomorrowFee(cfgDemo());
    const tx = savedE1({}, cfg);
    const { write, changes } = planRecalc(cfg, tx, "fecha_del_cobro", "2026-11-20");
    expect(changes).toEqual([]);
    expect(write.fields).toEqual({});
    expect(write.allocations).toBeNull();
    expect(write.event.summary).toBe("Recalculado con la tarifa de la fecha del cobro");
  });

  test("la tarifa de la fecha del cobro según la configuración de ahora: una tarifa corregida sí lo cambia", () => {
    const tx = savedE1();
    const cfg = cfgDemo();
    stripe(cfg).feeVersions = [
      { id: "fv-stripe-corregida", pct: "3.5", fixed: "0.30", effectiveFrom: "2000-01-01", note: null },
    ];
    const { write, changes } = planRecalc(cfg, tx, "fecha_del_cobro", "2026-11-20");
    expect(write.fields).toMatchObject({ feeVersionId: "fv-stripe-corregida", feesTotal: "10.30" });
    expect(changes.map((row) => row.key)).toContain("feesTotal");
    save(write, tx);
  });

  test("hoy también elige la versión del esquema de hoy", () => {
    const cfg = cfgDemo();
    const tx = savedE1({}, cfg);
    only(cfg.schemes).versions.push({
      id: "sv-socios-2",
      version: 2,
      base: "neto",
      remainderBeneficiaryId: DEMO.beneficiaryIds.c,
      effectiveFrom: SABADO,
      lines: [{ beneficiaryId: DEMO.beneficiaryIds.a, pct: "60" }],
    });
    const { write } = planRecalc(cfg, tx, "hoy", "2026-11-20");
    expect(write.fields.schemeVersionId).toBe("sv-socios-2");
    expect(write.allocations).toEqual([
      { beneficiaryId: DEMO.beneficiaryIds.a, amount: "54.18", base: "neto", pct: "60", isRemainder: false },
      { beneficiaryId: DEMO.beneficiaryIds.c, amount: "36.12", base: "neto", pct: "40", isRemainder: true },
    ]);
    expect(planRecalc(cfg, tx, "fecha_del_cobro", "2026-11-20").changes).toEqual([]);
    save(write, tx);
  });

  test("conserva el estado: un reembolso parcial se recalcula con la tarifa nueva", () => {
    const cfg = withTomorrowFee(cfgDemo());
    let tx = savedE1({}, cfg);
    tx = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
    const { write } = planRecalc(cfg, tx, "hoy", "2026-11-20");
    expect(write.fields.breakdown?.state).toEqual(tx.breakdown.state);
    // 60 × 3,5 % + 0,30 = 2,40; lo retenido sigue siendo la comisión original nueva (3,80).
    expect(write.fields.breakdown?.lines.map((line) => [line.kind, line.amount])).toEqual([
      ["pasarela", "2.40"],
      ["reembolso", "1.40"],
      ["opcion", "0.90"],
      ["plataforma", "3.00"],
    ]);
    expect("refundedAmount" in write.fields).toBe(false);
    save(write, tx);
  });

  test("la comisión informada se descarta: se calcula desde la configuración", () => {
    const tx = savedE1({ feeOverride: "3.41" });
    const { write, changes } = planRecalc(cfgDemo(), tx, "fecha_del_cobro", "2026-11-20");
    expect("feeOverride" in (write.fields.breakdown?.rules.gateway ?? {})).toBe(false);
    expect(write.fields.feesTotal).toBe("9.70");
    expect(changes[0]).toEqual({
      key: `line:pasarela:${DEMO.gatewayId}`,
      label: "Stripe",
      before: "3.41",
      after: "3.20",
    });
    save(write, tx);
  });

  test("una opción que ya no existe en la configuración se omite", () => {
    const tx = savedE1();
    const cfg = cfgDemo();
    stripe(cfg).extras = [];
    const { write, changes } = planRecalc(cfg, tx, "hoy", "2026-11-20");
    expect(write.fields.breakdown?.rules.extras).toEqual([]);
    expect(lineKinds(write)).toEqual(["pasarela", "plataforma"]);
    expect(changes[0]).toEqual({
      key: `line:opcion:${DEMO.extraId}`,
      label: "Pago rápido",
      before: "1.50",
      after: "—",
    });
    // Sin «Pago rápido» el dinero ya no cae el mismo día.
    expect(write.fields.estimatedDepositOn).toBe(MARTES);
    save(write, tx);
  });

  test("la fecha estimada se recalcula con las reglas nuevas, salvo que esté puesta a mano", () => {
    const cfg = cfgDemo();
    only(stripe(cfg).extras).payoutDaysOverride = 1;
    const auto = savedE1();
    const recalculated = planRecalc(cfg, auto, "hoy", "2026-11-20");
    expect(recalculated.changes).toEqual([]);
    expect(recalculated.write.fields.estimatedDepositOn).toBe("2026-11-16");
    save(recalculated.write, auto);

    const manual = savedE1({ estimatedDepositOn: "2026-11-20" });
    expect("estimatedDepositOn" in planRecalc(cfg, manual, "hoy", "2026-11-20").write.fields).toBe(false);
  });

  test("un cobro fallido no se recalcula", () => {
    const e1 = savedE1();
    expectStateError(() => planRecalc(cfgDemo(), save(planFail(e1), e1), "hoy", "2026-11-20"), "fallido");
  });

  test("si la pasarela ya no existe en la configuración, no hay con qué recalcular", () => {
    const empty: PayConfig = { ...cfgDemo(), gateways: [] };
    expectRuleError(() => planRecalc(empty, savedE1(), "hoy", "2026-11-20"), "pasarela");
  });
});

// ─── Papelera ───────────────────────────────────────────────────────────────────────────────────────────────

describe("papelera", () => {
  const AHORA = "2026-11-18T14:00:00.000Z";
  const trashed = (tx: TxSnapshot = savedE1()): TxSnapshot => save(planTrash(tx, AHORA), tx);

  test("planTrash: marca el instante y no toca nada más", () => {
    const tx = savedE1();
    const write = planTrash(tx, AHORA);
    expect(write.fields).toEqual({ deletedAt: AHORA });
    expect(write.allocations).toBeNull();
    expect(write.event).toMatchObject({ kind: "a_papelera", summary: "A la papelera" });
    expect(save(write, tx).deletedAt).toBe(AHORA);
  });

  test("planRestore: lo saca de la papelera", () => {
    const tx = trashed();
    const write = planRestore(tx);
    expect(write.fields).toEqual({ deletedAt: null });
    expect(write.allocations).toBeNull();
    expect(write.event).toMatchObject({ kind: "restaurado", summary: "Restaurado" });
    expect(save(write, tx).deletedAt).toBeNull();
  });

  test("no se manda a la papelera dos veces, ni se restaura lo que no está en ella", () => {
    expectStateError(() => planTrash(trashed(), AHORA), "en_papelera");
    expectStateError(() => planRestore(savedE1()), "no_en_papelera");
  });

  test("un cobro en la papelera solo admite restaurarse", () => {
    const e1 = savedE1();
    const tx = trashed(e1);
    const failed = trashed(save(planFail(e1), e1));
    const deposited = trashed(save(planDeposit(e1, VIERNES), e1));
    const disputed = trashed(save(planDispute(e1, { action: "abrir", on: VIERNES }), e1));
    const cfg = cfgDemo();
    const plans: (() => unknown)[] = [
      () => planEdit(cfg, tx, { note: "Otra nota" }),
      () => planRefund(tx, { amount: "40.00", on: VIERNES }),
      () => planRefundTotal(tx, "40.00"),
      () => planDispute(tx, { action: "abrir", on: VIERNES }),
      () => planDispute(disputed, { action: "ganar", on: VIERNES }),
      () => planFail(tx),
      () => planReopen(failed),
      () => planTransit(tx),
      () => planDeposit(tx, VIERNES),
      () => planRevertDeposit(deposited),
      () => planEstimated(cfg, tx, MARTES),
      () => planEstimated(cfg, tx, null),
      () => planRecalc(cfg, tx, "hoy", "2026-11-20"),
      () => planTrash(tx, AHORA),
    ];
    for (const plan of plans) expectStateError(plan, "en_papelera");
  });
});

// ─── El desglose de todo plan sobrevive la base ─────────────────────────────────────────────────────────────

describe("ida y vuelta por la base", () => {
  test("todo desglose que sale de un plan pasa por parseBreakdown tal cual, venga como venga la configuración", () => {
    // Una configuración «sucia»: porcentajes con ceros de relleno y montos sin sus dos decimales.
    const cfg = withPayPal(withTomorrowFee(cfgDemo()));
    const gateway = stripe(cfg);
    gateway.disputeFee = "15";
    for (const version of gateway.feeVersions) Object.assign(version, { pct: `${version.pct}00`, fixed: "0.3" });
    Object.assign(only(gateway.extras), { pct: "1.5000", fixed: "0" });
    Object.assign(only(cfg.channels), { platformFeePct: "5.0000", platformFeeFixed: "0" });
    for (const line of only(only(cfg.schemes).versions).lines) line.pct = `${line.pct}.0000`;

    const created = planCreate(cfg, inputE1({ feeOverride: "3.2" }), "importado");
    const tx = save(created);
    const refunded = save(planRefund(tx, { amount: "40.00", on: "2026-11-16" }), tx);
    const opened = save(planDispute(tx, { action: "abrir", on: "2026-11-16" }), tx);
    const failed = save(planFail(tx), tx);
    const writes: TxWrite[] = [
      created,
      planCreate(cfg, inputE1({ schemeId: null, channelId: null, extraIds: [] })),
      planEdit(cfg, tx, { grossOriginal: "33.33" }),
      planEdit(cfg, tx, { gatewayId: "gw-paypal", extraIds: [] }),
      planEdit(cfg, tx, { occurredAt: "2026-11-16T15:30:00Z" }),
      planRefund(tx, { amount: "40.00", on: "2026-11-16" }),
      planRefundTotal(refunded, "100.00"),
      planDispute(tx, { action: "abrir", on: "2026-11-16" }),
      planDispute(opened, { action: "ganar", on: "2026-11-20" }),
      planDispute(opened, { action: "perder", on: "2026-11-20" }),
      planDispute(opened, { action: "anular", on: "2026-11-20" }),
      planFail(tx),
      planReopen(failed),
      planRecalc(cfg, tx, "hoy", "2026-11-20").write,
      planRecalc(cfg, refunded, "fecha_del_cobro", "2026-11-20").write,
    ];
    for (const write of writes) {
      const b = write.fields.breakdown;
      expect(b, write.event.summary).toBeDefined();
      expect(parseBreakdown(JSON.parse(JSON.stringify(b))), write.event.summary).toEqual(b);
    }
  });
});
