import { refundedInFull } from "@/components/pasarelas/tx/allowed";
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
import { add, cmp, formatMoney, formatPct, isZero, neg, sub } from "@/lib/pasarelas/money";
import type { PayoutPart, PayoutStatus } from "@/lib/pasarelas/payouts";
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
 * (`BreakdownCard` y `AllocationList`): las cuentas de la retención son las del motor (`retentionOf`, `payoutOf`), y
 * lo ya pagado a cada parte, su estado de pago (`payoutStatus`), que entra hecho.
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

/**
 * Lo que se le debe a cada parte del reparto de cada cobro (`payoutStatus` del motor, con los pagos ligados que hay
 * en la base), por id de cobro. `null`: el cobro no tiene nada pendiente (fallido) o no tiene partes.
 */
export type PdfPayouts = ReadonlyMap<string, PayoutStatus | null>;

/**
 * Lo de una parte en los cobros de una moneda, sumado de su estado de pago en cada uno: `paid + owed + retained =
 * allocated`, como en cada cobro.
 */
export type PartyTotal = {
  beneficiaryId: string;
  name: string;
  /** Lo que le tocó en el reparto. */
  allocated: Money;
  /** Lo que la pasarela le retuvo y le paga directo: ya lo recibió. */
  retained: Money;
  /** Lo ya pagado, ligado a esos cobros. */
  paid: Money;
  /** Lo que se le debe todavía: positivo, falta; negativo, se le pagó de más. */
  owed: Money;
};

/** Lo que recibió de lo retenido quien no es parte del reparto de esos cobros: un adelanto que le baja el saldo. */
export type PartyAdvance = { beneficiaryId: string; name: string; amount: Money };

/** Una columna de montos de una tabla: su título y, con `strong`, en negrita (lo que más importa). */
export type PdfColumn = { title: string; strong?: boolean };

/** Una tabla de montos: cada fila con lo que es (y su `detail` en letra chica) y un monto por columna; notas debajo. */
export type PdfTable = {
  title: string;
  columns: readonly PdfColumn[];
  rows: { label: string; amounts: Money[]; detail?: string }[];
  notes: string[];
};

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
  /** Por nombre. */
  advances: PartyAdvance[];
  figures: PdfSection;
  /** Las partes en columnas: reparto, retenido, pagado y lo que falta; los adelantos, debajo. */
  allocation: PdfTable;
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

const GONE_NAME = "Beneficiario que ya no existe";

/** Los nombres congelados en el desglose: los de las partes del reparto y los de quienes reciben lo retenido. */
function frozenNames(b: Breakdown): ReadonlyMap<string, string> {
  return new Map([...b.alloc.lines, ...(retentionOf(b)?.shares ?? [])].map((item) => [item.beneficiaryId, item.name]));
}

/** El nombre de ahora de un beneficiario; si ya no existe, el congelado en el desglose o, sin él, que ya no existe. */
function nameOf(cfg: PayConfig, beneficiaryId: string, frozen: ReadonlyMap<string, string>): string {
  return cfg.beneficiaries.find((item) => item.id === beneficiaryId)?.name ?? frozen.get(beneficiaryId) ?? GONE_NAME;
}

/** «Se le pagó de más $10,00»: lo que se le debe es negativo, y eso es lo que tiene que devolver. */
const overpaidText = (owed: Money, currency: Currency): string =>
  `Se le pagó de más ${formatMoney(neg(owed), currency)}`;

/** El estado de pago de una parte con las palabras del detalle (`PayoutBadge`). */
function partText(part: PayoutPart, currency: Currency): string {
  switch (part.state) {
    case "pagado":
      return "Pagado";
    case "falta":
      return `Falta ${formatMoney(part.owed, currency)}`;
    case "de_mas":
      return overpaidText(part.owed, currency);
  }
}

const BASE_LABEL = { neto: "Sobre el neto", bruto: "Sobre el bruto" } as const;

/**
 * El reparto de `AllocationList` en el detalle del cobro: sobre qué se reparte y cuánto le toca a cada parte, con sus
 * marcas; a quien recibe lo retenido, lo que ya recibió; a cada parte, lo ya pagado según su estado de pago («Pagado»,
 * «Falta $25,00» o «Se le pagó de más $10,00»), que cuenta también lo retenido; el aviso de quien recibe lo retenido
 * sin estar en el reparto de este cobro, y lo pagado a quien no está en él. Sin estado de pago (un fallido), no dice
 * lo pagado.
 */
function allocationRows(b: Breakdown, status: PayoutStatus | null, cfg: PayConfig): PdfRow[] {
  const { alloc, currency } = b;
  const parts = status?.parts ?? [];
  const partOf = new Map(parts.map((part) => [part.beneficiaryId, part]));
  const names = frozenNames(b);
  const paidOutside = parts
    .filter((part) => !alloc.lines.some((line) => line.beneficiaryId === part.beneficiaryId))
    .map((part) =>
      nota(
        `Pagos a quien no está en el reparto: ${nameOf(cfg, part.beneficiaryId, names)} · ` +
          partText(part, currency),
      ),
    );
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
  if (alloc.baseKind === null) return [nota("Este cobro no se reparte."), ...outside, ...paidOutside];
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
      const part = partOf.get(line.beneficiaryId);
      const detail = [
        share === undefined ? null : `ya recibió ${formatMoney(share.amount, currency)} de la retención`,
        part === undefined ? null : partText(part, currency),
      ]
        .filter((text) => text !== null)
        .join(" · ");
      return monto(label, line.amount, { indent: true, ...(detail === "" ? {} : { detail }) });
    }),
    ...outside,
    ...paidOutside,
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
 * no, la estimada, como en el detalle («se estimaba» si falló; reembolsado del todo, que no hay depósito).
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
    refundedInFull(tx) ? "no hay depósito" : window === null ? null : windowText(window, tx.status === "fallido"),
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

function pdfTx(tx: TxSnapshot, status: PayoutStatus | null, cfg: PayConfig, today: ISODate): PdfTx {
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
    allocation: { title: "Reparto", rows: allocationRows(tx.breakdown, status, cfg) },
  };
}

// ─── Los totales ────────────────────────────────────────────────────────────────────────────────────────────

/** Los cobros de cada moneda, en el orden en que aparece cada una. */
function byCurrency(txs: readonly TxSnapshot[]): Map<Currency, TxSnapshot[]> {
  const groups = new Map<Currency, TxSnapshot[]>();
  for (const tx of txs) groups.set(tx.currency, [...(groups.get(tx.currency) ?? []), tx]);
  return groups;
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, "es");

/**
 * Lo de cada parte en esos cobros, sumado de su estado de pago en cada uno (reparto, retenido, pagado y lo que se le
 * debe), y lo que recibió de lo retenido quien no es parte de un cobro (un adelanto). Cada lista, por nombre.
 */
function partiesOf(
  txs: readonly TxSnapshot[],
  payouts: PdfPayouts,
  cfg: PayConfig,
): { parties: PartyTotal[]; advances: PartyAdvance[] } {
  const parties = new Map<string, PartyTotal>();
  const advances = new Map<string, PartyAdvance>();
  for (const tx of txs) {
    const names = frozenNames(tx.breakdown);
    const parts = payouts.get(tx.id)?.parts ?? [];
    for (const part of parts) {
      const id = part.beneficiaryId;
      const total = parties.get(id) ?? {
        beneficiaryId: id,
        name: nameOf(cfg, id, names),
        allocated: ZERO,
        retained: ZERO,
        paid: ZERO,
        owed: ZERO,
      };
      parties.set(id, {
        ...total,
        allocated: add(total.allocated, part.allocated),
        retained: add(total.retained, part.retained),
        paid: add(total.paid, part.paid),
        owed: add(total.owed, part.owed),
      });
    }
    // Quien está en el reparto o tiene pagos ligados es una parte: lo retenido ya cuenta en lo suyo.
    const partIds = new Set([...tx.breakdown.alloc.lines, ...parts].map((item) => item.beneficiaryId));
    for (const share of retentionOf(tx.breakdown)?.shares ?? []) {
      if (isZero(share.amount) || partIds.has(share.beneficiaryId)) continue;
      const id = share.beneficiaryId;
      const advance = advances.get(id) ?? { beneficiaryId: id, name: nameOf(cfg, id, names), amount: ZERO };
      advances.set(id, { ...advance, amount: add(advance.amount, share.amount) });
    }
  }
  return { parties: [...parties.values()].sort(byName), advances: [...advances.values()].sort(byName) };
}

const PARTY_COLUMNS: readonly PdfColumn[] = [
  { title: "Reparto" },
  { title: "Retenido" },
  { title: "Pagado" },
  { title: "Falta", strong: true },
];

/**
 * La tabla de lo que se le debe a cada parte en esos cobros: reparto, retenido, pagado y lo que falta (una parte a la
 * que se le pagó de más lo dice debajo de su nombre). Los adelantos y «Sin reparto.» van como notas.
 */
function partiesTable(parties: readonly PartyTotal[], advances: readonly PartyAdvance[], currency: Currency): PdfTable {
  return {
    title: "Reparto por parte",
    columns: PARTY_COLUMNS,
    rows: parties.map((total) => ({
      label: total.name,
      amounts: [total.allocated, total.retained, total.paid, total.owed],
      ...(cmp(total.owed, ZERO) < 0 ? { detail: overpaidText(total.owed, currency) } : {}),
    })),
    notes: [
      ...advances.map(
        (advance) =>
          `${advance.name} recibió ${formatMoney(advance.amount, currency)} de la retención sin estar en el reparto ` +
          "de esos cobros: es un adelanto y su saldo baja.",
      ),
      ...(parties.length === 0 && advances.length === 0 ? ["Sin reparto."] : []),
    ],
  };
}

/** Los totales de los cobros de UNA moneda (sin los fallidos), con sus filas para dibujar. */
function totalsOf(
  currency: Currency,
  group: readonly TxSnapshot[],
  payouts: PdfPayouts,
  cfg: PayConfig,
): PdfTotals | null {
  const counted = group.filter((tx) => tx.status !== "fallido");
  if (counted.length === 0) return null;
  const failed = group.length - counted.length;
  const sum = (amountOf: (b: Breakdown) => Money) => add(ZERO, ...counted.map((tx) => amountOf(tx.breakdown)));
  const gross = sum((b) => b.gross);
  const fees = sum((b) => b.feesTotal);
  const net = sum((b) => b.net);
  const retention = sum((b) => retentionOf(b)?.amount ?? ZERO);
  const payout = sum(payoutOf);
  const { parties, advances } = partiesOf(counted, payouts, cfg);
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
    advances,
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
    allocation: partiesTable(parties, advances, currency),
  };
}

/**
 * El PDF de esos cobros, en el orden en que llegan: cada uno con su desglose y su reparto (con lo ya pagado a cada
 * parte), y al final los totales por moneda (cobros, bruto, comisiones, neto, retenido, lo que llega al banco y, por
 * parte, lo que falta pagarle). `payouts` trae el estado de pago de cada cobro (`payoutStatuses`); un cobro que no
 * esté ahí no dice lo pagado. `scope` dice qué abarca; `now`, cuándo se generó (y qué día es hoy en Nueva York, para
 * lo atrasado).
 */
export function pdfModel(input: {
  txs: readonly TxSnapshot[];
  payouts: PdfPayouts;
  cfg: PayConfig;
  scope: string;
  now: Date;
}): PdfModel {
  const { txs, payouts, cfg, scope, now } = input;
  const today = todayNY(now);
  return {
    scope,
    generatedAt: `Generado el ${formatDateTime(now.toISOString())} (hora de Nueva York)`,
    transactions: txs.map((tx) => pdfTx(tx, payouts.get(tx.id) ?? null, cfg, today)),
    totals: [...byCurrency(txs)].flatMap(([currency, group]) => {
      const totals = totalsOf(currency, group, payouts, cfg);
      return totals === null ? [] : [totals];
    }),
  };
}
