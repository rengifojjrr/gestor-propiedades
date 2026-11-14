import { FEES_PAID_BY_LABEL } from "@/components/pasarelas/tx/payer";
import { buyerFeesOf, payoutOf, retentionOf, retentionReleaseOn, type Retention } from "@/lib/pasarelas/breakdown";
import {
  depositWindowOf,
  formatDate,
  formatDateTime,
  todayNY,
  windowDayLabels,
  type DateWindow,
} from "@/lib/pasarelas/dates";
import { ZERO } from "@/lib/pasarelas/decimal";
import { add, cmp, formatMoney, formatPct, isZero, sub } from "@/lib/pasarelas/money";
import { STATUS_LABEL, displayStatus, isOverdue, isPartialRefund } from "@/lib/pasarelas/status";
import type {
  AllocLine,
  Breakdown,
  BreakdownLine,
  Currency,
  ISODate,
  Money,
  PayConfig,
  TxSnapshot,
} from "@/lib/pasarelas/types";

/*
 * El modelo del PDF de cobros: lo que se dibuja, ya resuelto, sin tocar la base ni el reloj (`now` entra como
 * parámetro). Cada cobro sale de su desglose congelado, nunca recalculado, y dice lo mismo que su detalle
 * (`BreakdownCard` y `AllocationList`): las cuentas de la retención son las del motor (`retentionOf`, `payoutOf`).
 * Los montos van como `Money`; quien dibuja les da el formato de la app con la moneda del cobro o del bloque.
 */

/**
 * Una fila de una sección: un monto con lo que es (`detail`: la cuenta que lo explica, en letra chica), un dato que no
 * es un monto («Comisión pagada por: Nosotros») o una nota de una frase.
 */
export type PdfRow =
  | { kind: "monto"; label: string; amount: Money; detail?: string; strong?: boolean; indent?: boolean }
  | { kind: "dato"; label: string; value: string }
  | { kind: "nota"; text: string };

export type PdfSection = { title: string; rows: PdfRow[] };

/** Un cobro, como se dibuja: el encabezado y dos secciones, el desglose y el reparto. */
export type PdfTx = {
  id: string;
  currency: Currency;
  /** «Escuela Demo · Inscripciones en línea»: la empresa y, si hay, el canal. */
  heading: string;
  /** «mar 10 nov 2026, 12:00»: la fecha y hora del cobro en Nueva York. */
  when: string;
  /** «OTF Demo · Ref. pi_123 · USD»: la pasarela, la referencia si hay y la moneda. */
  source: string;
  /** «Registrado · llega el jue 12 nov», «Depositado el vie 13 nov 2026». */
  status: string;
  breakdown: PdfSection;
  allocation: PdfSection;
};

/** Lo que le tocó a una parte en el reparto de los cobros de una moneda, y lo que ya recibió de lo retenido. */
export type PartyTotal = { beneficiaryId: string; name: string; amount: Money; received: Money };

/** Los totales de una moneda: sin los fallidos, que no cuentan en nada (`failed` dice cuántos quedaron fuera). */
export type PdfTotals = {
  currency: Currency;
  count: number;
  failed: number;
  gross: Money;
  /** Todas las comisiones, también las que pagaron los compradores (las mismas que se ven cobro por cobro). */
  fees: Money;
  net: Money;
  retention: Money;
  /** Lo que llega al banco: el neto menos lo retenido. */
  payout: Money;
  /** Por nombre: es lo que el dueño usa para pagar. */
  parties: PartyTotal[];
  figures: PdfSection;
  allocation: PdfSection;
};

export type PdfModel = {
  /** Qué abarca: «Seleccionados (12)» o el período y los filtros, en palabras. */
  scope: string;
  generatedAt: string;
  transactions: PdfTx[];
  /** Un bloque por moneda, en el orden en que aparece cada una. */
  totals: PdfTotals[];
};

// ─── Cada cobro ─────────────────────────────────────────────────────────────────────────────────────────────

const monto = (label: string, amount: Money, extra: Partial<Omit<Extract<PdfRow, { kind: "monto" }>, "kind">> = {}) =>
  ({ kind: "monto", label, amount, ...extra }) as const satisfies PdfRow;
const nota = (text: string) => ({ kind: "nota", text }) as const satisfies PdfRow;

/**
 * Cómo se calculó una línea, como en el detalle: «2,9 % + $0,30 de $100,00». Lo fijo (el costo de un reembolso o
 * de una disputa) no lleva cuenta. Sin porcentaje ni fijo se dice «0 % de …».
 */
function ruleText(line: BreakdownLine, b: Breakdown): string | null {
  const money = (value: Money) => formatMoney(value, b.currency);
  if (line.baseKind === "informado") {
    const informed = b.rules.gateway.feeOverride;
    if (isZero(b.state.refunded) || informed === undefined) return "Informada por la pasarela";
    return `Proporcional a lo no reembolsado de la comisión informada (${money(informed)})`;
  }
  if (line.baseKind === "fijo") return null;
  const parts = [isZero(line.pct) ? null : formatPct(line.pct), isZero(line.fixed) ? null : money(line.fixed)];
  const cost = parts.filter((part) => part !== null).join(" + ") || formatPct("0");
  const after = line.baseKind === "despues_de_comision" ? " (después de la comisión)" : "";
  return `${cost} de ${money(line.baseAmount)}${after}`;
}

/** Lo que paga el negocio aunque la comisión la pague el comprador: lo que cuesta un reembolso o una disputa. */
const isBusinessCost = (line: BreakdownLine): boolean => line.kind === "reembolso" || line.kind === "disputa";

/** Lo que retuvo la pasarela, a quién le cae, hacia cuándo se libera y lo que llega al banco. */
function retentionRows(b: Breakdown, retention: Retention, occurredOn: ISODate): PdfRow[] {
  const head = monto(`Retiene ${b.rules.gateway.name} (${formatPct(retention.pct)})`, retention.amount);
  const payout = monto("Llega al banco", payoutOf(b), { strong: true });
  if (isZero(retention.amount)) return [head, nota("Sin nada cobrado, no retiene nada."), payout];
  return [
    head,
    ...retention.shares.map((share) => monto(share.name, share.amount, { indent: true })),
    nota(
      `Se libera hacia el ${formatDate(retentionReleaseOn(occurredOn, retention.days))}. La pasarela se lo paga ` +
        "directo a esas personas: no llega al banco.",
    ),
    payout,
  ];
}

/** El desglose de `BreakdownCard`: lo cobrado, cada comisión con su cuenta, quién la pagó, el neto y lo retenido. */
function breakdownRows(tx: TxSnapshot): PdfRow[] {
  const b = tx.breakdown;
  const byBuyer = b.state.feesPaidBy === "comprador";
  const split = byBuyer && b.lines.some(isBusinessCost);
  const buyerFees = buyerFeesOf(b);
  const retention = retentionOf(b);
  return [
    ...(isZero(b.state.refunded)
      ? []
      : [monto("Cobrado", b.state.grossOriginal), monto("Reembolsado", b.state.refunded)]),
    monto("Bruto", b.gross),
    ...(b.lines.length === 0
      ? [nota("Sin comisiones.")]
      : b.lines.map((line) => {
          const detail = ruleText(line, b);
          return monto(line.name, line.amount, { ...(detail === null ? {} : { detail }), indent: true });
        })),
    monto("Comisiones", b.feesTotal),
    { kind: "dato", label: "Comisión pagada por", value: FEES_PAID_BY_LABEL[b.state.feesPaidBy] },
    ...(split
      ? [
          monto("Pagadas por el comprador", buyerFees, { indent: true }),
          monto("Pagadas por el negocio", sub(b.feesTotal, buyerFees), { indent: true }),
        ]
      : []),
    monto(byBuyer ? "Lo que te queda" : "Neto", b.net, { strong: true }),
    ...(split
      ? [
          nota(
            "El comprador paga las comisiones de lo que sigue pagando; lo que cuesta un reembolso o una disputa lo " +
              "paga el negocio.",
          ),
        ]
      : byBuyer
        ? [nota("La comisión la pagó el comprador: se le cobró de más para cubrirla.")]
        : []),
    ...(retention === null ? [] : retentionRows(b, retention, tx.occurredOn)),
  ];
}

/** «Grupo A», «Grupo A y Grupo C», «Grupo A, Grupo B y Grupo C». */
function listed(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.slice(-1).join("")}`;
}

/** «Grupo A no paga comisión: su parte es el 20 % del bruto. La comisión la pagan los demás.» (o en plural). */
function sparedText(lines: readonly AllocLine[]): string {
  const verb = lines.length === 1 ? "no paga comisión: su parte es" : "no pagan comisión: sus partes son";
  const pcts = listed(lines.map((line) => `el ${formatPct(line.pct)}`));
  return `${listed(lines.map((line) => line.name))} ${verb} ${pcts} del bruto. La comisión la pagan los demás.`;
}

/** «ya recibió $25,00 de la retención · falta $25,00» (o «· $50,00 de adelanto» si recibió más que su parte). */
function receivedText(amount: Money, received: Money, currency: Currency): string {
  const rest = sub(amount, received);
  const tail =
    cmp(rest, ZERO) >= 0
      ? `falta ${formatMoney(rest, currency)}`
      : `${formatMoney(sub(received, amount), currency)} de adelanto`;
  return `ya recibió ${formatMoney(received, currency)} de la retención · ${tail}`;
}

const BASE_LABEL = { neto: "Sobre el neto", bruto: "Sobre el bruto" } as const;

/**
 * El reparto de `AllocationList`: sobre qué se reparte y cuánto le toca a cada parte, con sus marcas; a quien recibe
 * lo retenido, lo que ya recibió; y el aviso de quien lo recibe sin estar en el reparto de este cobro.
 */
function allocationRows(b: Breakdown): PdfRow[] {
  const { alloc, currency } = b;
  // Solo cuenta lo que de verdad recibió (con un reembolso total o un fallido, nada).
  const received = (retentionOf(b)?.shares ?? []).filter((share) => !isZero(share.amount));
  const shareOf = new Map(received.map((share) => [share.beneficiaryId, share]));
  const outside = received
    .filter((share) => !alloc.lines.some((line) => line.beneficiaryId === share.beneficiaryId))
    .map((share) =>
      nota(
        `${share.name} recibe ${formatMoney(share.amount, currency)} de la retención pero no está en el reparto de ` +
          "este cobro: es un adelanto y su saldo baja.",
      ),
    );
  if (alloc.baseKind === null) return [nota("Este cobro no se reparte."), ...outside];
  const spared = alloc.lines.filter((line) => line.feeExempt);
  const buyerNote =
    b.state.feesPaidBy !== "comprador"
      ? []
      : [
          nota(
            isZero(buyerFeesOf(b))
              ? "Se reparte sobre lo que te queda: el cobro se registró con la comisión a cargo del comprador."
              : "Se reparte sobre lo que te queda: la comisión la pagó el comprador.",
          ),
        ];
  return [
    ...buyerNote,
    ...(spared.length === 0 ? [] : [nota(sparedText(spared))]),
    monto(BASE_LABEL[alloc.baseKind], alloc.baseAmount),
    ...alloc.lines.map((line) => {
      const marks = [line.isRemainder ? "Resto" : null, line.feeExempt ? "no paga comisión" : null];
      const label = [`${line.name} (${formatPct(line.pct)})`, ...marks].filter((part) => part !== null).join(" · ");
      const share = shareOf.get(line.beneficiaryId);
      const detail = share === undefined ? {} : { detail: receivedText(line.amount, share.amount, currency) };
      return monto(label, line.amount, { indent: true, ...detail });
    }),
    ...outside,
  ];
}

/** «llega el jue 12 nov», «llega entre el lun 16 y el mié 18 nov»; con `past`, «se estimaba …». */
function windowText(window: DateWindow, past: boolean): string {
  const verb = past ? "se estimaba" : "llega";
  const [first, last] = windowDayLabels(window);
  return last === undefined ? `${verb} el ${first}` : `${verb} entre el ${first} y el ${last}`;
}

/**
 * El estado visible con sus marcas (reembolso parcial, atrasado) y la fecha del depósito: la real si se depositó; si
 * no, la estimada, como en el detalle («se estimaba» si falló).
 */
function statusText(tx: TxSnapshot, today: ISODate): string {
  const shown = displayStatus(tx);
  if (tx.status === "depositado" && tx.depositedOn !== null) {
    const on = formatDate(tx.depositedOn);
    return shown === "depositado" ? `Depositado el ${on}` : `${STATUS_LABEL[shown]} · depositado el ${on}`;
  }
  const window = depositWindowOf(tx);
  return [
    STATUS_LABEL[shown],
    isPartialRefund(tx) ? "reembolso parcial" : null,
    isOverdue(tx, today) ? "atrasado" : null,
    window === null ? null : windowText(window, tx.status === "fallido"),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/** Los nombres de ahora; si ya no existen, los congelados en el desglose (como el detalle). */
function namesOf(tx: TxSnapshot, cfg: PayConfig) {
  const { rules } = tx.breakdown;
  const company = cfg.companies.find((item) => item.id === tx.companyId)?.name ?? "—";
  const channel =
    tx.channelId === null
      ? null
      : (cfg.channels.find((item) => item.id === tx.channelId)?.name ?? rules.platform?.name ?? "—");
  const gateway = cfg.gateways.find((item) => item.id === tx.gatewayId)?.name ?? rules.gateway.name;
  return { company, channel, gateway };
}

function pdfTx(tx: TxSnapshot, cfg: PayConfig, today: ISODate): PdfTx {
  const names = namesOf(tx, cfg);
  return {
    id: tx.id,
    currency: tx.currency,
    heading: names.channel === null ? names.company : `${names.company} · ${names.channel}`,
    when: formatDateTime(tx.occurredAt),
    source: [names.gateway, tx.reference === null ? null : `Ref. ${tx.reference}`, tx.currency]
      .filter((part) => part !== null)
      .join(" · "),
    status: statusText(tx, today),
    breakdown: { title: "Desglose", rows: breakdownRows(tx) },
    allocation: { title: "Reparto", rows: allocationRows(tx.breakdown) },
  };
}

// ─── Los totales ────────────────────────────────────────────────────────────────────────────────────────────

/** Los cobros de cada moneda, en el orden en que aparece cada una. */
function byCurrency(txs: readonly TxSnapshot[]): Map<Currency, TxSnapshot[]> {
  const groups = new Map<Currency, TxSnapshot[]>();
  for (const tx of txs) groups.set(tx.currency, [...(groups.get(tx.currency) ?? []), tx]);
  return groups;
}

/** Lo que le tocó a cada parte en esos cobros y lo que ya recibió de lo retenido, por nombre. */
function partiesOf(txs: readonly TxSnapshot[], cfg: PayConfig): PartyTotal[] {
  const parties = new Map<string, PartyTotal>();
  const party = (beneficiaryId: string, frozenName: string): PartyTotal => {
    const found = parties.get(beneficiaryId);
    if (found !== undefined) return found;
    const name = cfg.beneficiaries.find((item) => item.id === beneficiaryId)?.name ?? frozenName;
    const created = { beneficiaryId, name, amount: ZERO, received: ZERO };
    parties.set(beneficiaryId, created);
    return created;
  };
  for (const { breakdown } of txs) {
    for (const line of breakdown.alloc.lines) {
      const total = party(line.beneficiaryId, line.name);
      total.amount = add(total.amount, line.amount);
    }
    for (const share of retentionOf(breakdown)?.shares ?? []) {
      if (isZero(share.amount)) continue;
      const total = party(share.beneficiaryId, share.name);
      total.received = add(total.received, share.amount);
    }
  }
  return [...parties.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Los totales de los cobros de UNA moneda (sin los fallidos), con sus filas para dibujar. */
function totalsOf(currency: Currency, group: readonly TxSnapshot[], cfg: PayConfig): PdfTotals | null {
  const counted = group.filter((tx) => tx.status !== "fallido");
  if (counted.length === 0) return null;
  const failed = group.length - counted.length;
  const sum = (amountOf: (b: Breakdown) => Money) => add(ZERO, ...counted.map((tx) => amountOf(tx.breakdown)));
  const gross = sum((b) => b.gross);
  const fees = sum((b) => b.feesTotal);
  const net = sum((b) => b.net);
  const retention = sum((b) => retentionOf(b)?.amount ?? ZERO);
  const payout = sum(payoutOf);
  const parties = partiesOf(counted, cfg);
  return {
    currency,
    count: counted.length,
    failed,
    gross,
    fees,
    net,
    retention,
    payout,
    parties,
    figures: {
      title: "Cifras",
      rows: [
        { kind: "dato", label: "Cobros", value: String(counted.length) },
        ...(failed === 0 ? [] : [nota(`Sin contar ${failed === 1 ? "1 fallido" : `${failed} fallidos`}.`)]),
        monto("Bruto", gross),
        monto("Comisiones", fees),
        monto("Neto", net),
        monto("Retenido", retention),
        monto("Llega al banco", payout, { strong: true }),
      ],
    },
    allocation: {
      title: "Reparto por parte",
      rows:
        parties.length === 0
          ? [nota("Sin reparto.")]
          : parties.map((total) =>
              monto(
                total.name,
                total.amount,
                isZero(total.received) ? {} : { detail: receivedText(total.amount, total.received, currency) },
              ),
            ),
    },
  };
}

/**
 * El PDF de esos cobros, en el orden en que llegan: cada uno con su desglose y su reparto, y al final los totales
 * por moneda (cobros, bruto, comisiones, neto, retenido, lo que llega al banco y el reparto por parte).
 * `scope` dice qué abarca; `now`, cuándo se generó (y qué día es hoy en Nueva York, para lo atrasado).
 */
export function pdfModel(input: { txs: readonly TxSnapshot[]; cfg: PayConfig; scope: string; now: Date }): PdfModel {
  const { txs, cfg, scope, now } = input;
  const today = todayNY(now);
  return {
    scope,
    generatedAt: `Generado el ${formatDateTime(now.toISOString())} (hora de Nueva York)`,
    transactions: txs.map((tx) => pdfTx(tx, cfg, today)),
    totals: [...byCurrency(txs)].flatMap(([currency, group]) => {
      const totals = totalsOf(currency, group, cfg);
      return totals === null ? [] : [totals];
    }),
  };
}
