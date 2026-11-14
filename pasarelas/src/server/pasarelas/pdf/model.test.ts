import { describe, expect, test } from "vitest";
import { buyerFeesOf, compute, recompute, retentionOf } from "@/lib/pasarelas/breakdown";
import { payoutStatus, type BeneficiaryAmount, type PayoutStatus } from "@/lib/pasarelas/payouts";
import type {
  Breakdown,
  GatewayCfg,
  PayConfig,
  RetentionRule,
  Rules,
  SchemeRule,
  State,
  TxSnapshot,
} from "@/lib/pasarelas/types";
import { pdfModel, type PdfRow } from "./model";

/**
 * El modelo del PDF de cobros: lo que se dibuja de cada cobro (siempre de su desglose congelado, como el detalle, con
 * lo ya pagado a cada parte) y los totales por moneda y por parte. Datos inventados: Tienda Demo, Escuela Demo, OTF
 * Demo, Grupos y Titulares.
 */

const gateway = (id: string, name: string): GatewayCfg => ({
  id,
  name,
  payoutDays: 2,
  payoutDaysMax: null,
  payoutDayType: "habiles",
  refundsReturnFee: false,
  disputeFee: "0.00",
  active: true,
  feeVersions: [],
  extras: [],
  retention: { pct: "0", days: 0, recipients: [] },
});

const person = (id: string, name: string) => ({ id, name, kind: "persona" as const, active: true });

const CFG: PayConfig = {
  companies: [
    { id: "co-tienda", name: "Tienda Demo", currency: "USD", defaultSchemeId: null, active: true },
    { id: "co-escuela", name: "Escuela Demo", currency: "USD", defaultSchemeId: null, active: true },
  ],
  channels: [
    {
      id: "ch-linea",
      companyId: "co-escuela",
      name: "Inscripciones en línea",
      platformFeePct: "5",
      platformFeeFixed: "0.00",
      active: true,
    },
  ],
  gateways: [gateway("gw-otf", "OTF Demo"), gateway("gw-stripe", "Stripe")],
  companyGateways: [],
  bankAccounts: [{ id: "ba-principal", alias: "Cuenta principal", last4: "4321", currency: "USD", active: true }],
  beneficiaries: [
    person("ben-ga", "Grupo A"),
    person("ben-gb", "Grupo B"),
    person("ben-gc", "Grupo C"),
    person("ben-ta", "Titular A"),
    person("ben-tb", "Titular B"),
    person("ben-tc", "Titular C"),
  ],
  schemes: [],
  holidays: [],
};

const paid = (grossOriginal: string): State => ({
  grossOriginal,
  refunded: "0.00",
  dispute: null,
  failed: false,
  feesPaidBy: "nosotros",
});
const paidByBuyer = (grossOriginal: string): State => ({ ...paid(grossOriginal), feesPaidBy: "comprador" });

/** OTF Demo retiene el 5 % durante 30 días para Titular A y Titular B, mitad y mitad. */
const OTF_RETENTION: RetentionRule = {
  pct: "5",
  days: 30,
  recipients: [
    { beneficiaryId: "ben-ta", name: "Titular A", pct: "50" },
    { beneficiaryId: "ben-tb", name: "Titular B", pct: "50" },
  ],
};

/** El esquema de E10: Grupo A 60 %, Grupo B 30 %, Titular A 5 % y Titular B 5 %, los titulares sin comisión. */
const SCHEME_E10: SchemeRule = {
  schemeId: "sch-otf",
  versionId: "sv-otf",
  name: "Sobre el neto",
  base: "neto",
  lines: [
    { beneficiaryId: "ben-ga", name: "Grupo A", pct: "60", feeExempt: false },
    { beneficiaryId: "ben-gb", name: "Grupo B", pct: "30", feeExempt: false },
    { beneficiaryId: "ben-ta", name: "Titular A", pct: "5", feeExempt: true },
    { beneficiaryId: "ben-tb", name: "Titular B", pct: "5", feeExempt: true },
  ],
  remainder: null,
};

/** E10: OTF Demo (2,9 % + 0,20; no devuelve la comisión), sin opciones ni plataforma. */
function rulesE10(patch: { retention?: RetentionRule | null; scheme?: SchemeRule | null } = {}): Rules {
  const retention = patch.retention === undefined ? OTF_RETENTION : patch.retention;
  return {
    gateway: {
      id: "gw-otf",
      name: "OTF Demo",
      feeVersionId: "fv-otf",
      pct: "2.9",
      fixed: "0.20",
      refundsReturnFee: false,
      disputeFee: "0.00",
      ...(retention === null ? {} : { retention }),
    },
    extras: [],
    platform: null,
    scheme: patch.scheme === undefined ? SCHEME_E10 : patch.scheme,
  };
}

/** E1: Stripe 2,9 % + 0,30 (disputa 15,00), «Pago rápido» 1,5 % del bruto, el canal al 5 % y 50/30/20 sobre el neto. */
function rulesE1(): Rules {
  return {
    gateway: {
      id: "gw-stripe",
      name: "Stripe",
      feeVersionId: "fv-stripe",
      pct: "2.9",
      fixed: "0.30",
      refundsReturnFee: false,
      disputeFee: "15.00",
    },
    extras: [{ id: "ex-rapido", name: "Pago rápido", pct: "1.5", fixed: "0.00", base: "bruto", payoutDaysOverride: 0 }],
    platform: { channelId: "ch-linea", name: "Inscripciones en línea", pct: "5", fixed: "0.00" },
    scheme: {
      schemeId: "sch-socios",
      versionId: "sv-socios",
      name: "Reparto 50/30/20",
      base: "neto",
      lines: [
        { beneficiaryId: "ben-ga", name: "Grupo A", pct: "50", feeExempt: false },
        { beneficiaryId: "ben-gb", name: "Grupo B", pct: "30", feeExempt: false },
        { beneficiaryId: "ben-gc", name: "Grupo C", pct: "20", feeExempt: false },
      ],
      remainder: null,
    },
  };
}

/** El cobro guardado con ese desglose: las columnas salen del desglose, como las escribe la app. */
function snapshot(b: Breakdown, patch: Partial<TxSnapshot> = {}): TxSnapshot {
  return {
    id: "tx-1",
    // Mediodía del martes 10 de noviembre en Nueva York.
    occurredAt: "2026-11-10T17:00:00Z",
    occurredOn: "2026-11-10",
    companyId: b.rules.platform === null ? "co-tienda" : "co-escuela",
    channelId: b.rules.platform?.channelId ?? null,
    gatewayId: b.rules.gateway.id,
    bankAccountId: "ba-principal",
    currency: b.currency,
    grossOriginal: b.state.grossOriginal,
    refunded: b.state.refunded,
    gross: b.gross,
    fees: b.feesTotal,
    net: b.net,
    status: b.state.failed ? "fallido" : "registrado",
    disputeState: b.state.dispute,
    estimatedDepositOn: "2026-11-12",
    estimatedDepositFrom: null,
    depositedOn: null,
    receiptsCount: 0,
    feesPaidBy: b.state.feesPaidBy,
    buyerFees: buyerFeesOf(b),
    retention: retentionOf(b)?.amount ?? "0.00",
    schemeId: b.rules.scheme?.schemeId ?? null,
    reference: null,
    note: null,
    estimatedIsManual: false,
    disputeOpenedOn: null,
    disputeClosedOn: null,
    deletedAt: null,
    updatedAt: "2026-11-10T17:00:00Z",
    breakdown: b,
    ...patch,
  };
}

/** Las tres de la tarde del martes 10 de noviembre de 2026 en Nueva York. */
const NOW = new Date("2026-11-10T20:00:00Z");

/**
 * Lo que se le debe a cada parte de ese cobro con esos pagos ligados, según el motor (`payoutStatus`), como lo arma
 * `payoutStatuses` con lo que lee de la base: el reparto, lo retenido a cada persona y los pagos.
 */
function statusOf(tx: TxSnapshot, paid: readonly BeneficiaryAmount[] = []): PayoutStatus | null {
  const b = tx.breakdown;
  return payoutStatus({
    counts: tx.status !== "fallido" && tx.deletedAt === null,
    allocations: b.alloc.lines,
    retained: retentionOf(b)?.shares ?? [],
    paid,
  });
}

/** Un pago ligado a un cobro: lo de ese beneficiario en ese cobro. */
const pay = (beneficiaryId: string, amount: string): BeneficiaryAmount => ({ beneficiaryId, amount });

/** Los pagos ligados a cada cobro, por id; un cobro que no está no tiene pagos. */
type Paid = Record<string, BeneficiaryAmount[]>;

const modelOf = (txs: TxSnapshot[], cfg: PayConfig = CFG, paid: Paid = {}) =>
  pdfModel({
    txs,
    cfg,
    scope: "Seleccionados",
    now: NOW,
    payouts: new Map(txs.map((tx) => [tx.id, statusOf(tx, paid[tx.id])])),
  });
const onlyTx = (tx: TxSnapshot, cfg: PayConfig = CFG, paid: BeneficiaryAmount[] = []) => {
  const [first] = modelOf([tx], cfg, { [tx.id]: paid }).transactions;
  if (first === undefined) throw new Error("el cobro no salió en el modelo");
  return first;
};
const notes = (rows: readonly PdfRow[]) => rows.flatMap((row) => (row.kind === "nota" ? [row.text] : []));
const labels = (rows: readonly PdfRow[]) => rows.flatMap((row) => (row.kind === "nota" ? [] : [row.label]));

const e10 = compute(rulesE10(), paid("1000.00"), "USD");
const e1 = compute(rulesE1(), paid("100.00"), "USD");

describe("pdfModel: el encabezado", () => {
  test("lleva lo que abarca y la fecha y hora en que se generó, en Nueva York", () => {
    const model = pdfModel({
      txs: [],
      cfg: CFG,
      scope: "Seleccionados (0)",
      now: new Date("2026-11-14T03:30:00Z"),
      payouts: new Map(),
    });
    expect(model.scope).toBe("Seleccionados (0)");
    // 03:30 en UTC del sábado es todavía viernes por la noche en Nueva York.
    expect(model.generatedAt).toBe("Generado el vie 13 nov 2026, 22:30 (hora de Nueva York)");
    expect(model.transactions).toEqual([]);
    expect(model.totals).toEqual([]);
  });
});

describe("pdfModel: cada cobro, del desglose congelado", () => {
  test("D1: E10 con la retención: comisión 29,20, neto 970,80, retenido 50,00 y llega al banco 920,80", () => {
    const tx = onlyTx(snapshot(e10, { id: "tx-e10", reference: "pi_e10" }));
    expect(tx).toMatchObject({
      id: "tx-e10",
      currency: "USD",
      heading: "Tienda Demo",
      when: "mar 10 nov 2026, 12:00",
      source: "OTF Demo · Ref. pi_e10 · USD",
      status: "Registrado · llega el jue 12 nov",
    });
    expect(tx.breakdown).toEqual({
      title: "Desglose",
      rows: [
        { kind: "monto", label: "Bruto", amount: "1000.00" },
        { kind: "monto", label: "OTF Demo", amount: "29.20", detail: "2,9 % + $0,20 de $1.000,00", indent: true },
        { kind: "monto", label: "Comisiones", amount: "29.20" },
        { kind: "dato", label: "Comisión pagada por", value: "Nosotros" },
        { kind: "monto", label: "Neto", amount: "970.80", strong: true },
        { kind: "monto", label: "Retiene OTF Demo (5 %)", amount: "50.00" },
        { kind: "monto", label: "Titular A", amount: "25.00", indent: true },
        { kind: "monto", label: "Titular B", amount: "25.00", indent: true },
        {
          kind: "nota",
          text: "Se libera hacia el jue 10 dic 2026. La pasarela se lo paga directo a esas personas: no llega al banco.",
        },
        { kind: "monto", label: "Llega al banco", amount: "920.80", strong: true },
      ],
    });
    expect(tx.allocation).toEqual({
      title: "Reparto",
      rows: [
        {
          kind: "nota",
          text: "Titular A y Titular B no pagan comisión: sus partes son el 5 % y el 5 % del bruto. La comisión la pagan los demás.",
        },
        { kind: "monto", label: "Sobre el neto", amount: "970.80" },
        // Sin pagos todavía: a cada parte le falta lo suyo, menos lo que ya recibió de la retención.
        { kind: "monto", label: "Grupo A (60 %)", amount: "580.53", indent: true, detail: "Falta $580,53" },
        { kind: "monto", label: "Grupo B (30 %)", amount: "290.27", indent: true, detail: "Falta $290,27" },
        {
          kind: "monto",
          label: "Titular A (5 %) · no paga comisión",
          amount: "50.00",
          indent: true,
          detail: "ya recibió $25,00 de la retención · Falta $25,00",
        },
        {
          kind: "monto",
          label: "Titular B (5 %) · no paga comisión",
          amount: "50.00",
          indent: true,
          detail: "ya recibió $25,00 de la retención · Falta $25,00",
        },
      ],
    });
  });

  test("sin retención (E1): cada comisión con su cuenta y sin filas de lo retenido; el canal va con la empresa", () => {
    const tx = onlyTx(snapshot(e1));
    expect(tx.heading).toBe("Escuela Demo · Inscripciones en línea");
    expect(tx.source).toBe("Stripe · USD");
    expect(tx.breakdown.rows).toEqual([
      { kind: "monto", label: "Bruto", amount: "100.00" },
      { kind: "monto", label: "Stripe", amount: "3.20", detail: "2,9 % + $0,30 de $100,00", indent: true },
      { kind: "monto", label: "Pago rápido", amount: "1.50", detail: "1,5 % de $100,00", indent: true },
      { kind: "monto", label: "Inscripciones en línea", amount: "5.00", detail: "5 % de $100,00", indent: true },
      { kind: "monto", label: "Comisiones", amount: "9.70" },
      { kind: "dato", label: "Comisión pagada por", value: "Nosotros" },
      { kind: "monto", label: "Neto", amount: "90.30", strong: true },
    ]);
    expect(tx.allocation.rows).toEqual([
      { kind: "monto", label: "Sobre el neto", amount: "90.30" },
      { kind: "monto", label: "Grupo A (50 %)", amount: "45.15", indent: true, detail: "Falta $45,15" },
      { kind: "monto", label: "Grupo B (30 %)", amount: "27.09", indent: true, detail: "Falta $27,09" },
      { kind: "monto", label: "Grupo C (20 %)", amount: "18.06", indent: true, detail: "Falta $18,06" },
    ]);
  });

  test("con reembolso parcial (E5): lo cobrado, lo reembolsado, el bruto vigente y el costo del reembolso", () => {
    const tx = onlyTx(snapshot(recompute(e1, { refunded: "40.00" })));
    expect(tx.status).toBe("Registrado · reembolso parcial · llega el jue 12 nov");
    expect(tx.breakdown.rows).toEqual([
      { kind: "monto", label: "Cobrado", amount: "100.00" },
      { kind: "monto", label: "Reembolsado", amount: "40.00" },
      { kind: "monto", label: "Bruto", amount: "60.00" },
      { kind: "monto", label: "Stripe", amount: "2.04", detail: "2,9 % + $0,30 de $60,00", indent: true },
      { kind: "monto", label: "Costo del reembolso", amount: "1.16", indent: true },
      { kind: "monto", label: "Pago rápido", amount: "0.90", detail: "1,5 % de $60,00", indent: true },
      { kind: "monto", label: "Inscripciones en línea", amount: "3.00", detail: "5 % de $60,00", indent: true },
      { kind: "monto", label: "Comisiones", amount: "7.10" },
      { kind: "dato", label: "Comisión pagada por", value: "Nosotros" },
      { kind: "monto", label: "Neto", amount: "52.90", strong: true },
    ]);
    expect(tx.allocation.rows.slice(1).map((row) => (row.kind === "monto" ? row.amount : null))).toEqual([
      "26.45",
      "15.87",
      "10.58",
    ]);
  });

  test("con reembolso total la pasarela no retiene nada y llega al banco lo mismo que el neto", () => {
    const tx = onlyTx(snapshot(recompute(e10, { refunded: "1000.00" })));
    // Como el detalle: reembolsado del todo, no hay depósito que esperar (no está «Por caer»).
    expect(tx.status).toBe("Reembolsado · no hay depósito");
    expect(tx.breakdown.rows.slice(-3)).toEqual([
      { kind: "monto", label: "Retiene OTF Demo (5 %)", amount: "0.00" },
      { kind: "nota", text: "Sin nada cobrado, no retiene nada." },
      { kind: "monto", label: "Llega al banco", amount: "-29.20", strong: true },
    ]);
    // Lo retenido en 0 no se cuenta como recibido.
    const details = tx.allocation.rows.flatMap((row) => (row.kind === "monto" && row.detail ? [row.detail] : []));
    expect(details.filter((detail) => detail.includes("ya recibió"))).toEqual([]);
  });

  test("una sola parte que no paga comisión se dice en singular", () => {
    const scheme: SchemeRule = {
      ...SCHEME_E10,
      lines: SCHEME_E10.lines.map((line) => ({ ...line, feeExempt: line.beneficiaryId === "ben-ta" })),
    };
    const tx = onlyTx(snapshot(compute(rulesE10({ scheme }), paid("1000.00"), "USD")));
    expect(notes(tx.allocation.rows)).toEqual([
      "Titular A no paga comisión: su parte es el 5 % del bruto. La comisión la pagan los demás.",
    ]);
    expect(labels(tx.allocation.rows)).toContain("Titular A (5 %) · no paga comisión");
    expect(labels(tx.allocation.rows)).toContain("Titular B (5 %)");
  });

  test("la línea «Resto» lleva su marca", () => {
    const rules = rulesE1();
    const scheme = rules.scheme as SchemeRule;
    const withRest: Rules = {
      ...rules,
      scheme: { ...scheme, lines: scheme.lines.slice(0, 2), remainder: { beneficiaryId: "ben-gc", name: "Grupo C" } },
    };
    const tx = onlyTx(snapshot(compute(withRest, paid("100.00"), "USD")));
    expect(labels(tx.allocation.rows)).toEqual([
      "Sobre el neto",
      "Grupo A (50 %)",
      "Grupo B (30 %)",
      "Grupo C (20 %) · Resto",
    ]);
  });

  test("sin esquema el cobro no se reparte", () => {
    const tx = onlyTx(snapshot(compute(rulesE10({ retention: null, scheme: null }), paid("1000.00"), "USD")));
    expect(tx.allocation.rows).toEqual([{ kind: "nota", text: "Este cobro no se reparte." }]);
  });

  test("quien recibe lo retenido sin estar en el reparto: un adelanto que se avisa", () => {
    const retention: RetentionRule = {
      ...OTF_RETENTION,
      recipients: [{ beneficiaryId: "ben-tc", name: "Titular C", pct: "100" }],
    };
    const withScheme = onlyTx(snapshot(compute(rulesE10({ retention }), paid("1000.00"), "USD")));
    expect(notes(withScheme.allocation.rows).at(-1)).toBe(
      "Titular C recibe $50,00 de la retención pero no está en el reparto de este cobro: es un adelanto y su saldo baja.",
    );
    const without = onlyTx(snapshot(compute(rulesE10({ retention, scheme: null }), paid("1000.00"), "USD")));
    expect(notes(without.allocation.rows)).toEqual([
      "Este cobro no se reparte.",
      "Titular C recibe $50,00 de la retención pero no está en el reparto de este cobro: es un adelanto y su saldo baja.",
    ]);
  });

  test("si recibió de la retención más que su parte, se le pagó de más", () => {
    const retention: RetentionRule = { ...OTF_RETENTION, pct: "20" };
    const tx = onlyTx(snapshot(compute(rulesE10({ retention }), paid("1000.00"), "USD")));
    const titular = tx.allocation.rows.find((row) => row.kind === "monto" && row.label.startsWith("Titular A"));
    // Lo de más es lo que el detalle dice «Se le pagó de más»: recibió de la retención más que su parte.
    expect(titular).toMatchObject({
      amount: "50.00",
      detail: "ya recibió $100,00 de la retención · Se le pagó de más $50,00",
    });
  });

  test("la comisión del comprador: «Lo que te queda» y por qué", () => {
    const tx = onlyTx(snapshot(compute(rulesE1(), paidByBuyer("100.00"), "USD")));
    expect(tx.breakdown.rows.slice(-4)).toEqual([
      { kind: "monto", label: "Comisiones", amount: "9.70" },
      { kind: "dato", label: "Comisión pagada por", value: "El comprador" },
      { kind: "monto", label: "Lo que te queda", amount: "90.30", strong: true },
      { kind: "nota", text: "La comisión la pagó el comprador: se le cobró de más para cubrirla." },
    ]);
    expect(notes(tx.allocation.rows)).toEqual(["Se reparte sobre lo que te queda: la comisión la pagó el comprador."]);
  });

  test("la comisión del comprador con una disputa: qué pagó el comprador y qué el negocio", () => {
    const tx = onlyTx(snapshot(compute(rulesE1(), { ...paidByBuyer("100.00"), dispute: "abierta" }, "USD")));
    expect(tx.status).toBe("En disputa · llega el jue 12 nov");
    expect(tx.breakdown.rows.slice(-7)).toEqual([
      { kind: "monto", label: "Costo de disputa", amount: "15.00", indent: true },
      { kind: "monto", label: "Comisiones", amount: "24.70" },
      { kind: "dato", label: "Comisión pagada por", value: "El comprador" },
      { kind: "monto", label: "Pagadas por el comprador", amount: "9.70", indent: true },
      { kind: "monto", label: "Pagadas por el negocio", amount: "15.00", indent: true },
      { kind: "monto", label: "Lo que te queda", amount: "75.30", strong: true },
      {
        kind: "nota",
        text: "El comprador paga las comisiones de lo que sigue pagando; lo que cuesta un reembolso o una disputa lo paga el negocio.",
      },
    ]);
  });

  test("con reembolso total del comprador, el reparto dice cómo se registró el cobro", () => {
    const tx = onlyTx(snapshot(recompute(compute(rulesE1(), paidByBuyer("100.00"), "USD"), { refunded: "100.00" })));
    expect(notes(tx.allocation.rows)).toEqual([
      "Se reparte sobre lo que te queda: el cobro se registró con la comisión a cargo del comprador.",
    ]);
  });

  test("cómo se calculó cada comisión: informada, proporcional, después de la comisión, solo fija y sin costo", () => {
    const base = rulesE1();
    const informed: Rules = { ...base, extras: [], platform: null, gateway: { ...base.gateway, feeOverride: "3.50" } };
    expect(onlyTx(snapshot(compute(informed, paid("100.00"), "USD"))).breakdown.rows[1]).toEqual({
      kind: "monto",
      label: "Stripe",
      amount: "3.50",
      detail: "Informada por la pasarela",
      indent: true,
    });
    const refunded = recompute(compute(informed, paid("100.00"), "USD"), { refunded: "50.00" });
    expect(onlyTx(snapshot(refunded)).breakdown.rows[3]).toMatchObject({
      label: "Stripe",
      amount: "1.75",
      detail: "Proporcional a lo no reembolsado de la comisión informada ($3,50)",
    });

    const extras: Rules["extras"] = [
      { id: "ex-1", name: "Después", pct: "1.5", fixed: "0.00", base: "despues_de_comision", payoutDaysOverride: null },
      { id: "ex-2", name: "Fija", pct: "0", fixed: "0.50", base: "bruto", payoutDaysOverride: null },
      { id: "ex-3", name: "Gratis", pct: "0", fixed: "0.00", base: "bruto", payoutDaysOverride: null },
    ];
    const rows = onlyTx(snapshot(compute({ ...base, extras, platform: null }, paid("100.00"), "USD"))).breakdown.rows;
    expect(rows.slice(2, 5)).toEqual([
      {
        kind: "monto",
        label: "Después",
        amount: "1.45",
        detail: "1,5 % de $96,80 (después de la comisión)",
        indent: true,
      },
      { kind: "monto", label: "Fija", amount: "0.50", detail: "$0,50 de $100,00", indent: true },
      { kind: "monto", label: "Gratis", amount: "0.00", detail: "0 % de $100,00", indent: true },
    ]);
  });

  test("un cobro fallido no tiene comisiones", () => {
    const tx = onlyTx(snapshot(recompute(e1, { failed: true })));
    expect(tx.status).toBe("Fallido · se estimaba el jue 12 nov");
    expect(tx.breakdown.rows).toContainEqual({ kind: "nota", text: "Sin comisiones." });
  });

  test("el estado con la fecha real del depósito, o con la estimada (un día o una ventana)", () => {
    const deposited = { status: "depositado" as const, depositedOn: "2026-11-13" };
    expect(onlyTx(snapshot(e1, deposited)).status).toBe("Depositado el vie 13 nov 2026");
    expect(onlyTx(snapshot(recompute(e1, { refunded: "100.00" }), deposited)).status).toBe(
      "Reembolsado · depositado el vie 13 nov 2026",
    );
    const window = {
      status: "en_transito" as const,
      estimatedDepositFrom: "2026-11-16",
      estimatedDepositOn: "2026-11-18",
    };
    expect(onlyTx(snapshot(e1, window)).status).toBe("En tránsito · llega entre el lun 16 y el mié 18 nov");
    expect(onlyTx(snapshot(e1, { estimatedDepositOn: null })).status).toBe("Registrado");
  });

  test("lo que está por caer con la fecha estimada ya pasada sale atrasado", () => {
    const late = pdfModel({
      txs: [snapshot(e1)],
      cfg: CFG,
      scope: "",
      now: new Date("2026-11-14T15:00:00Z"),
      payouts: new Map(),
    });
    expect(late.transactions[0]?.status).toBe("Registrado · atrasado · llega el jue 12 nov");
  });

  test("los nombres son los de ahora; si ya no existen, los congelados en el desglose", () => {
    const gone: PayConfig = { ...CFG, companies: [], channels: [], gateways: [] };
    const tx = onlyTx(snapshot(e1, { reference: "pi_1" }), gone);
    expect([tx.heading, tx.source]).toEqual(["— · Inscripciones en línea", "Stripe · Ref. pi_1 · USD"]);
    const renamed: PayConfig = {
      ...CFG,
      channels: [{ ...(CFG.channels[0] as PayConfig["channels"][number]), name: "Inscripciones web" }],
      gateways: [gateway("gw-stripe", "Stripe Demo")],
    };
    expect(onlyTx(snapshot(e1), renamed)).toMatchObject({
      heading: "Escuela Demo · Inscripciones web",
      source: "Stripe Demo · USD",
    });
    // Un canal que ya no existe y que no congeló costo de plataforma: no hay nombre que decir.
    expect(onlyTx(snapshot(e10, { channelId: "ch-borrado" })).heading).toBe("Tienda Demo · —");
  });

  test("tres partes sin comisión se nombran con comas y «y»", () => {
    const scheme: SchemeRule = {
      ...SCHEME_E10,
      lines: SCHEME_E10.lines.map((line) => ({ ...line, feeExempt: line.beneficiaryId !== "ben-ga" })),
    };
    const tx = onlyTx(snapshot(compute(rulesE10({ scheme }), paid("1000.00"), "USD")));
    expect(notes(tx.allocation.rows)).toEqual([
      "Grupo B, Titular A y Titular B no pagan comisión: sus partes son el 30 %, el 5 % y el 5 % del bruto. " +
        "La comisión la pagan los demás.",
    ]);
  });
});

describe("pdfModel: lo ya pagado a cada parte, en cada cobro", () => {
  test("una parte pagada, otra a medias y otra pagada de más (hubo un reembolso después de pagarle)", () => {
    // E5: con el reembolso de 40,00 el reparto baja a 26,45 · 15,87 · 10,58; a Grupo C ya se le habían pagado 18,06.
    const tx = onlyTx(snapshot(recompute(e1, { refunded: "40.00" })), CFG, [
      pay("ben-ga", "26.45"),
      pay("ben-gb", "10.00"),
      pay("ben-gc", "18.06"),
    ]);
    expect(tx.allocation.rows).toEqual([
      { kind: "monto", label: "Sobre el neto", amount: "52.90" },
      { kind: "monto", label: "Grupo A (50 %)", amount: "26.45", indent: true, detail: "Pagado" },
      { kind: "monto", label: "Grupo B (30 %)", amount: "15.87", indent: true, detail: "Falta $5,87" },
      { kind: "monto", label: "Grupo C (20 %)", amount: "10.58", indent: true, detail: "Se le pagó de más $7,48" },
    ]);
  });

  test("lo retenido se sigue viendo como ya recibido, y lo que falta cuenta también lo pagado", () => {
    const tx = onlyTx(snapshot(e10), CFG, [pay("ben-ta", "25.00"), pay("ben-ga", "300.00"), pay("ben-ga", "280.53")]);
    const rowOf = (name: string) => tx.allocation.rows.find((row) => row.kind === "monto" && row.label.startsWith(name));
    // Dos pagos a la misma parte se suman.
    expect(rowOf("Grupo A")).toMatchObject({ amount: "580.53", detail: "Pagado" });
    expect(rowOf("Grupo B")).toMatchObject({ amount: "290.27", detail: "Falta $290,27" });
    expect(rowOf("Titular A")).toMatchObject({
      amount: "50.00",
      detail: "ya recibió $25,00 de la retención · Pagado",
    });
    expect(rowOf("Titular B")).toMatchObject({
      amount: "50.00",
      detail: "ya recibió $25,00 de la retención · Falta $25,00",
    });
  });

  test("un pago a quien no está en el reparto de ese cobro (se cambió el esquema después): se le pagó de más", () => {
    const tx = onlyTx(snapshot(e1), CFG, [pay("ben-ta", "10.00")]);
    expect(notes(tx.allocation.rows)).toEqual([
      "Pagos a quien no está en el reparto: Titular A · Se le pagó de más $10,00",
    ]);
    const unshared = snapshot(compute(rulesE10({ retention: null, scheme: null }), paid("1000.00"), "USD"));
    expect(onlyTx(unshared, CFG, [pay("ben-gb", "5.00"), pay("ben-borrado", "1.00")]).allocation.rows).toEqual([
      { kind: "nota", text: "Este cobro no se reparte." },
      { kind: "nota", text: "Pagos a quien no está en el reparto: Grupo B · Se le pagó de más $5,00" },
      {
        kind: "nota",
        text: "Pagos a quien no está en el reparto: Beneficiario que ya no existe · Se le pagó de más $1,00",
      },
    ]);
  });

  test("un fallido no tiene nada pendiente: su reparto no dice lo pagado, como antes", () => {
    const tx = onlyTx(snapshot(recompute(e1, { failed: true })), CFG, [pay("ben-ga", "45.15")]);
    expect(tx.allocation.rows.filter((row) => row.kind === "monto" && row.detail !== undefined)).toEqual([]);
    expect(notes(tx.allocation.rows)).toEqual([]);
  });

  test("sin el estado de pago de un cobro, su reparto no dice lo pagado; lo retenido, sí", () => {
    const model = pdfModel({ txs: [snapshot(e10)], cfg: CFG, scope: "", now: NOW, payouts: new Map() });
    const rows = model.transactions[0]?.allocation.rows ?? [];
    expect(rows.find((row) => row.kind === "monto" && row.label.startsWith("Grupo A"))).not.toHaveProperty("detail");
    expect(rows.find((row) => row.kind === "monto" && row.label.startsWith("Titular A"))).toMatchObject({
      detail: "ya recibió $25,00 de la retención",
    });
  });

  test("reembolsado del todo no hay depósito que esperar, salvo lo ya depositado", () => {
    const full = recompute(e1, { refunded: "100.00" });
    expect(onlyTx(snapshot(full)).status).toBe("Reembolsado · no hay depósito");
    expect(onlyTx(snapshot(full, { status: "en_transito" })).status).toBe("Reembolsado · no hay depósito");
    expect(onlyTx(snapshot(full, { disputeState: "abierta" })).status).toBe("En disputa · no hay depósito");
    expect(onlyTx(snapshot(full, { status: "depositado", depositedOn: "2026-11-13" })).status).toBe(
      "Reembolsado · depositado el vie 13 nov 2026",
    );
  });
});

/** Las columnas de la tabla del reparto por parte. */
const PARTY_COLUMNS = [{ title: "Reparto" }, { title: "Retenido" }, { title: "Pagado" }, { title: "Falta", strong: true }];

/** Lo de una parte en los totales. */
const party = (beneficiaryId: string, name: string, allocated: string, retained: string, paid: string, owed: string) => ({
  beneficiaryId,
  name,
  allocated,
  retained,
  paid,
  owed,
});

describe("pdfModel: los totales por moneda y por parte", () => {
  test("D2: monedas distintas dan un bloque cada una, en el orden en que aparecen; las partes se suman", () => {
    const model = modelOf([
      snapshot(e10, { id: "tx-1" }),
      snapshot(compute(rulesE1(), paid("100.00"), "MXN"), { id: "tx-2" }),
      snapshot(e10, { id: "tx-3" }),
    ]);
    expect(model.transactions.map((tx) => tx.id)).toEqual(["tx-1", "tx-2", "tx-3"]);
    expect(model.totals.map(({ figures: _f, allocation: _a, ...numbers }) => numbers)).toEqual([
      {
        currency: "USD",
        count: 2,
        failed: 0,
        gross: "2000.00",
        fees: "58.40",
        net: "1941.60",
        retention: "100.00",
        payout: "1841.60",
        parties: [
          party("ben-ga", "Grupo A", "1161.06", "0.00", "0.00", "1161.06"),
          party("ben-gb", "Grupo B", "580.54", "0.00", "0.00", "580.54"),
          party("ben-ta", "Titular A", "100.00", "50.00", "0.00", "50.00"),
          party("ben-tb", "Titular B", "100.00", "50.00", "0.00", "50.00"),
        ],
        advances: [],
      },
      {
        currency: "MXN",
        count: 1,
        failed: 0,
        gross: "100.00",
        fees: "9.70",
        net: "90.30",
        retention: "0.00",
        payout: "90.30",
        parties: [
          party("ben-ga", "Grupo A", "45.15", "0.00", "0.00", "45.15"),
          party("ben-gb", "Grupo B", "27.09", "0.00", "0.00", "27.09"),
          party("ben-gc", "Grupo C", "18.06", "0.00", "0.00", "18.06"),
        ],
        advances: [],
      },
    ]);
    const usd = model.totals[0];
    expect(usd?.figures).toEqual({
      title: "Cifras",
      rows: [
        { kind: "dato", label: "Cobros", value: "2" },
        { kind: "monto", label: "Bruto", amount: "2000.00" },
        { kind: "monto", label: "Comisiones", amount: "58.40" },
        { kind: "monto", label: "Neto", amount: "1941.60" },
        { kind: "monto", label: "Retenido", amount: "100.00" },
        { kind: "monto", label: "Llega al banco", amount: "1841.60", strong: true },
      ],
    });
    expect(usd?.allocation).toEqual({
      title: "Reparto por parte",
      columns: PARTY_COLUMNS,
      rows: [
        { label: "Grupo A", amounts: ["1161.06", "0.00", "0.00", "1161.06"] },
        { label: "Grupo B", amounts: ["580.54", "0.00", "0.00", "580.54"] },
        { label: "Titular A", amounts: ["100.00", "50.00", "0.00", "50.00"] },
        { label: "Titular B", amounts: ["100.00", "50.00", "0.00", "50.00"] },
      ],
      notes: [],
    });
  });

  test("por parte: reparto, retenido, pagado y lo que falta; con «falta» negativa, se le pagó de más", () => {
    const [usd] = modelOf(
      [
        snapshot(recompute(e1, { refunded: "40.00" }), { id: "tx-e5" }),
        snapshot(e1, { id: "tx-e1" }),
        snapshot(e10, { id: "tx-e10" }),
        // Un fallido no cuenta, aunque tenga un pago ligado.
        snapshot(recompute(e1, { failed: true }), { id: "tx-fallido" }),
      ],
      CFG,
      {
        "tx-e5": [pay("ben-ga", "26.45"), pay("ben-gb", "10.00"), pay("ben-gc", "18.06")],
        "tx-e1": [pay("ben-gc", "18.06")],
        "tx-e10": [pay("ben-ta", "25.00")],
        "tx-fallido": [pay("ben-gb", "99.00")],
      },
    ).totals;
    expect(usd?.parties).toEqual([
      party("ben-ga", "Grupo A", "652.13", "0.00", "26.45", "625.68"),
      party("ben-gb", "Grupo B", "333.23", "0.00", "10.00", "323.23"),
      party("ben-gc", "Grupo C", "28.64", "0.00", "36.12", "-7.48"),
      party("ben-ta", "Titular A", "50.00", "25.00", "25.00", "0.00"),
      party("ben-tb", "Titular B", "50.00", "25.00", "0.00", "25.00"),
    ]);
    expect(usd?.allocation).toEqual({
      title: "Reparto por parte",
      columns: PARTY_COLUMNS,
      rows: [
        { label: "Grupo A", amounts: ["652.13", "0.00", "26.45", "625.68"] },
        { label: "Grupo B", amounts: ["333.23", "0.00", "10.00", "323.23"] },
        { label: "Grupo C", amounts: ["28.64", "0.00", "36.12", "-7.48"], detail: "Se le pagó de más $7,48" },
        { label: "Titular A", amounts: ["50.00", "25.00", "25.00", "0.00"] },
        { label: "Titular B", amounts: ["50.00", "25.00", "0.00", "25.00"] },
      ],
      notes: [],
    });
  });

  test("quien tiene pagos sin estar en el reparto sale como parte; si ya no existe, se dice", () => {
    const paidOutside = { "tx-1": [pay("ben-ta", "10.00"), pay("ben-x", "1.00")] };
    const [usd] = modelOf([snapshot(e1, { id: "tx-1" })], CFG, paidOutside).totals;
    expect(usd?.allocation.rows.slice(0, 1)).toEqual([
      {
        label: "Beneficiario que ya no existe",
        amounts: ["0.00", "0.00", "1.00", "-1.00"],
        detail: "Se le pagó de más $1,00",
      },
    ]);
    expect(usd?.allocation.rows.at(-1)).toEqual({
      label: "Titular A",
      amounts: ["0.00", "0.00", "10.00", "-10.00"],
      detail: "Se le pagó de más $10,00",
    });
  });

  test("con retención y sin ella: sin retención, lo retenido es 0 y llega al banco el neto", () => {
    const [usd] = modelOf([snapshot(e1)]).totals;
    expect(usd).toMatchObject({ net: "90.30", retention: "0.00", payout: "90.30" });
    const [withIt] = modelOf([snapshot(e10)]).totals;
    expect(withIt).toMatchObject({ net: "970.80", retention: "50.00", payout: "920.80" });
  });

  test("con reembolso: los totales son del bruto vigente y de las comisiones que quedaron", () => {
    const refunded = snapshot(recompute(e1, { refunded: "40.00" }), { id: "tx-1" });
    const [usd] = modelOf([refunded, snapshot(e1, { id: "tx-2" })]).totals;
    expect(usd).toMatchObject({ count: 2, gross: "160.00", fees: "16.80", net: "143.20" });
  });

  test("las comisiones del total son todas, también las que pagó el comprador", () => {
    const [usd] = modelOf([snapshot(compute(rulesE1(), paidByBuyer("100.00"), "USD"))]).totals;
    expect(usd).toMatchObject({ gross: "100.00", fees: "9.70", net: "90.30" });
  });

  test("los fallidos no cuentan: se dice cuántos quedaron fuera; una moneda con solo fallidos no tiene bloque", () => {
    const model = modelOf([
      snapshot(recompute(e1, { failed: true }), { id: "tx-f" }),
      snapshot(e1, { id: "tx-1" }),
      snapshot(recompute(compute(rulesE1(), paid("100.00"), "MXN"), { failed: true }), { id: "tx-m" }),
    ]);
    expect(model.transactions).toHaveLength(3);
    expect(model.totals.map((block) => [block.currency, block.count, block.failed])).toEqual([["USD", 1, 1]]);
    expect(model.totals[0]?.figures.rows.slice(0, 2)).toEqual([
      { kind: "dato", label: "Cobros", value: "1" },
      { kind: "nota", text: "Sin contar 1 fallido." },
    ]);
    const failed = recompute(e1, { failed: true });
    const two = modelOf([snapshot(e1), snapshot(failed, { id: "tx-f1" }), snapshot(failed, { id: "tx-f2" })]);
    expect(notes(two.totals[0]?.figures.rows ?? [])).toEqual(["Sin contar 2 fallidos."]);
  });

  test("quien solo recibió de la retención no es una parte: su adelanto se dice debajo de la tabla", () => {
    const retention: RetentionRule = {
      ...OTF_RETENTION,
      recipients: [{ beneficiaryId: "ben-tc", name: "Titular C", pct: "100" }],
    };
    const [alone] = modelOf([snapshot(compute(rulesE10({ retention, scheme: null }), paid("1000.00"), "USD"))]).totals;
    expect(alone?.parties).toEqual([]);
    expect(alone?.advances).toEqual([{ beneficiaryId: "ben-tc", name: "Titular C", amount: "50.00" }]);
    expect(alone?.allocation).toMatchObject({
      rows: [],
      notes: [
        "Titular C recibió $50,00 de la retención sin estar en el reparto de esos cobros: es un adelanto y su " +
          "saldo baja.",
      ],
    });
    // Con el reparto de E10, sus adelantos de dos cobros se suman y van debajo de las partes.
    const withScheme = snapshot(compute(rulesE10({ retention }), paid("1000.00"), "USD"));
    const [both] = modelOf([
      { ...withScheme, id: "tx-1" },
      { ...withScheme, id: "tx-2" },
    ]).totals;
    expect(both?.parties.map((total) => total.name)).toEqual(["Grupo A", "Grupo B", "Titular A", "Titular B"]);
    expect(both?.advances).toEqual([{ beneficiaryId: "ben-tc", name: "Titular C", amount: "100.00" }]);
    expect(both?.allocation.notes).toEqual([
      "Titular C recibió $100,00 de la retención sin estar en el reparto de esos cobros: es un adelanto y su " +
        "saldo baja.",
    ]);
  });

  test("sin nadie en el reparto, lo dice", () => {
    const unshared = compute(rulesE10({ retention: null, scheme: null }), paid("1000.00"), "USD");
    const [usd] = modelOf([snapshot(unshared)]).totals;
    expect(usd?.parties).toEqual([]);
    expect(usd?.allocation).toMatchObject({ rows: [], notes: ["Sin reparto."] });
  });

  test("cada parte con su nombre de ahora o, si ya no existe, el congelado; en orden alfabético", () => {
    const renamed: PayConfig = {
      ...CFG,
      beneficiaries: [person("ben-ga", "Ángel Demo"), person("ben-gb", "Zeta Demo")],
    };
    const [usd] = modelOf([snapshot(e1)], renamed).totals;
    expect(usd?.parties.map((total) => total.name)).toEqual(["Ángel Demo", "Grupo C", "Zeta Demo"]);
  });
});
