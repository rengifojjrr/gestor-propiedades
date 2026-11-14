/**
 * El cálculo de un cobro: comisiones línea por línea, neto y reparto (spec §5.2), y el desglose que se congela.
 * Cada línea se redondea a centavos ANTES de sumar. Las reglas viajan dentro del desglose, así que un reembolso
 * o una disputa posteriores se calculan con la tarifa de entonces.
 */
import type { Decimal } from "decimal.js";
import { z } from "zod";
import { allocate, allocateInProportion } from "./allocate";
import { addDays } from "./dates";
import { D, ZERO, dec, isMoney, normPct, r2, toMoney } from "./decimal";
import { sub } from "./money";
import { PayRuleError } from "./rules";
import { someonePaysFees } from "./schemes";
import type {
  AllocBase,
  AllocLine,
  Breakdown,
  BreakdownLine,
  Currency,
  DiffRow,
  FeesPaidBy,
  ISODate,
  LineKind,
  Money,
  Pct,
  Rules,
  SchemeRule,
  State,
} from "./types";

// ─── compute ────────────────────────────────────────────────────────────────────────────────────────────────

/** Un monto de las reglas o del estado: tiene que venir canónico ("0.30"); si no, RangeError. */
function money(value: Money, what: string): Decimal {
  if (!isMoney(value)) throw new RangeError(`${what} no es un monto con dos decimales: «${value}»`);
  return dec(value);
}

/** r(base × % + fijo). */
function fee(base: Decimal, pct: Pct, fixed: Decimal): Decimal {
  return r2(base.times(dec(pct)).div(100).plus(fixed));
}

/**
 * Las líneas de comisión, en orden: pasarela, costo del reembolso, opciones, plataforma, disputa.
 * `g0` es lo cobrado y `g` el bruto vigente (lo cobrado menos lo reembolsado).
 */
function feeLines(rules: Rules, state: State, g0: Decimal, g: Decimal): BreakdownLine[] {
  const { gateway } = rules;
  const none = new D(0);
  const nothingLeft = g.isZero();
  const hasRefund = !g.eq(g0);
  const gross = toMoney(g);
  const lines: BreakdownLine[] = [];

  // Pasarela. F0 es la comisión original: la calculada o, si la pasarela la informó, la informada.
  const gatewayFixed = money(gateway.fixed, "La cuota fija de la pasarela");
  const override = gateway.feeOverride;
  const informed = override !== undefined;
  const f0 = informed ? money(override, "La comisión informada") : fee(g0, gateway.pct, gatewayFixed);
  let gatewayFee = f0;
  if (nothingLeft) gatewayFee = none;
  else if (hasRefund) gatewayFee = informed ? r2(f0.times(g).div(g0)) : fee(g, gateway.pct, gatewayFixed);
  lines.push({
    kind: "pasarela",
    refId: gateway.id,
    name: gateway.name,
    baseKind: informed ? "informado" : "bruto",
    baseAmount: gross,
    pct: informed ? "0" : normPct(gateway.pct),
    fixed: informed ? toMoney(gatewayFee) : gateway.fixed,
    amount: toMoney(gatewayFee),
  });

  // Costo del reembolso: lo que la pasarela se queda de lo reembolsado. Así lo retenido sigue siendo F0.
  let refundCost = none;
  if (hasRefund && !gateway.refundsReturnFee) {
    refundCost = f0.minus(gatewayFee);
    lines.push({
      kind: "reembolso",
      refId: null,
      name: "Costo del reembolso",
      baseKind: "fijo",
      baseAmount: toMoney(g0.minus(g)),
      pct: "0",
      fixed: toMoney(refundCost),
      amount: toMoney(refundCost),
    });
  }

  // Opciones encendidas, sobre el bruto vigente o sobre lo que queda después de la pasarela.
  const afterGateway = D.max(0, g.minus(gatewayFee).minus(refundCost));
  for (const extra of rules.extras) {
    const base = extra.base === "bruto" ? g : afterGateway;
    const amount = fee(base, extra.pct, money(extra.fixed, `La cuota fija de «${extra.name}»`));
    lines.push({
      kind: "opcion",
      refId: extra.id,
      name: extra.name,
      baseKind: extra.base,
      baseAmount: toMoney(base),
      pct: normPct(extra.pct),
      fixed: extra.fixed,
      amount: toMoney(nothingLeft ? none : amount),
    });
  }

  // Plataforma o canal.
  if (rules.platform !== null) {
    const { platform } = rules;
    const amount = fee(g, platform.pct, money(platform.fixed, `La cuota fija de «${platform.name}»`));
    lines.push({
      kind: "plataforma",
      refId: platform.channelId,
      name: platform.name,
      baseKind: "bruto",
      baseAmount: gross,
      pct: normPct(platform.pct),
      fixed: platform.fixed,
      amount: toMoney(nothingLeft ? none : amount),
    });
  }

  // Disputa: cuesta mientras esté abierta o si se perdió; si se ganó, nada.
  if (state.dispute === "abierta" || state.dispute === "perdida") {
    const cost = toMoney(money(gateway.disputeFee, "El costo de disputa"));
    lines.push({
      kind: "disputa",
      refId: null,
      name: "Costo de disputa",
      baseKind: "fijo",
      baseAmount: ZERO,
      pct: "0",
      fixed: cost,
      amount: cost,
    });
  }

  return lines;
}

type Share = { pct: Pct; feeExempt: boolean };

/**
 * El reparto cuando alguna parte no paga comisión (la pagamos nosotros y se reparte el neto). Cada parte que no la
 * paga recibe lo que le tocaría si no hubiera comisión: su parte de la venta, por mayor resto entre todas las partes
 * (como en un esquema sobre el bruto). Pagando nosotros, la venta es el bruto vigente: no hay nada de los compradores
 * que descontar (`buyerFeesOf` da 0). Las demás, «Resto» incluido, se reparten lo que queda del neto en proporción a
 * sus porcentajes, también por mayor resto. Suma exactamente el neto. Si nadie queda pagando la comisión, lanza
 * `PayRuleError("nadie_paga_comision")`.
 *
 * `shares` es el reparto completo: las líneas y, si suman menos de 100 %, el «Resto» que lo completa (sin marca).
 * Por eso quién paga se pregunta solo entre ellas, sin preguntar aparte por el «Resto» (`hasRemainder` falso). Y por
 * eso antes `allocate` comprueba que cubran el 100 % (si no, RangeError): sin el «Resto» adentro, la respuesta sería
 * «nadie paga» en un esquema que en realidad no vale.
 */
function sparedAmounts(shares: readonly Share[], sale: Money, net: Money): Money[] {
  const asIfNoFees = allocate(
    sale,
    shares.map((share) => share.pct),
  );
  if (!someonePaysFees(shares, false)) throw new PayRuleError("nadie_paga_comision");
  const sparedTotal = shares.reduce(
    (sum, share, i) => (share.feeExempt ? sum.plus(dec(asIfNoFees[i] as Money)) : sum),
    new D(0),
  );
  // Las que no pagan comisión pesan 0 en lo que queda: no reciben nada de ahí (ni un centavo del mayor resto).
  const paying = allocateInProportion(
    toMoney(dec(net).minus(sparedTotal)),
    shares.map((share) => (share.feeExempt ? "0" : share.pct)),
  );
  return shares.map((share, i) => (share.feeExempt ? asIfNoFees[i] : paying[i]) as Money);
}

/**
 * El reparto por mayor resto. Si las líneas suman menos de 100 %, lo que falta va al «Resto», al final. La base es
 * la del esquema, salvo que la comisión la pagó el comprador: entonces el neto, porque lo que pagó de más para
 * cubrirla no es venta del negocio (el desglose lo dice en `state.feesPaidBy`).
 *
 * Una línea marcada «No paga comisión» solo cuenta si la pagamos nosotros y se reparte el neto (ver `sparedAmounts`);
 * con el comprador o sobre el bruto la marca no cambia nada.
 */
function allocation(scheme: SchemeRule | null, gross: Decimal, net: Decimal, payer: FeesPaidBy): Breakdown["alloc"] {
  if (scheme === null) return { baseKind: null, baseAmount: ZERO, lines: [] };

  const shares = scheme.lines.map((line) => ({ ...line, pct: normPct(line.pct), isRemainder: false }));
  const total = shares.reduce((sum, share) => sum.plus(dec(share.pct)), new D(0));
  if (total.lt(100) && scheme.remainder !== null) {
    shares.push({ ...scheme.remainder, pct: normPct(new D(100).minus(total)), isRemainder: true, feeExempt: false });
  }

  // Un esquema que aun así no suma 100 % (se pasa, o le falta y no hay «Resto») es inválido: allocate lanza RangeError.
  const baseKind: AllocBase = payer === "comprador" ? "neto" : scheme.base;
  const baseAmount = toMoney(baseKind === "bruto" ? gross : net);
  const exemptApplies = payer === "nosotros" && baseKind === "neto" && shares.some((share) => share.feeExempt);
  const amounts = exemptApplies
    ? sparedAmounts(shares, toMoney(gross), baseAmount)
    : allocate(
        baseAmount,
        shares.map((share) => share.pct),
      );
  const lines: AllocLine[] = shares.map((share, i) => ({
    beneficiaryId: share.beneficiaryId,
    name: share.name,
    pct: share.pct,
    amount: amounts[i] as Money, // allocate devuelve un monto por porcentaje
    isRemainder: share.isRemainder,
    feeExempt: exemptApplies && share.feeExempt,
  }));
  return { baseKind, baseAmount, lines };
}

/**
 * Calcula el desglose de un cobro. Lanza RangeError si lo cobrado no es mayor que cero, si lo reembolsado no está
 * entre cero y lo cobrado, o si el esquema no cubre exactamente el 100 %.
 */
export function compute(rules: Rules, state: State, currency: Currency): Breakdown {
  const g0 = money(state.grossOriginal, "Lo cobrado");
  const refunded = money(state.refunded, "Lo reembolsado");
  if (g0.lte(0)) throw new RangeError("Lo cobrado tiene que ser mayor que cero");
  if (refunded.lt(0) || refunded.gt(g0)) throw new RangeError("Lo reembolsado tiene que estar entre cero y lo cobrado");

  // Fallido: sin líneas; bruto vigente, comisiones, neto y reparto en cero.
  const g = state.failed ? new D(0) : g0.minus(refunded);
  const lines = state.failed ? [] : feeLines(rules, state, g0, g);
  const feesTotal = lines.reduce((sum, line) => sum.plus(dec(line.amount)), new D(0));
  const net = g.minus(feesTotal);
  return {
    v: 1,
    currency,
    rules,
    state,
    gross: toMoney(g),
    lines,
    feesTotal: toMoney(feesTotal),
    net: toMoney(net),
    alloc: allocation(rules.scheme, g, net, state.feesPaidBy),
  };
}

/** Mismas reglas, estado nuevo: reembolso, disputa, monto, fallido. */
export function recompute(b: Breakdown, patch: Partial<State>): Breakdown {
  return compute(b.rules, { ...b.state, ...patch }, b.currency);
}

/** Reglas nuevas, mismo estado: «recalcular con la tarifa de hoy». */
export function recalc(b: Breakdown, rules: Rules): Breakdown {
  return compute(rules, b.state, b.currency);
}

// ─── Lo que pagaron los compradores ─────────────────────────────────────────────────────────────────────────

/** Las líneas que se cobran sobre lo que el comprador sigue pagando: si la comisión la pagó él, son suyas. */
const PAID_BY_BUYER: Record<LineKind, boolean> = {
  pasarela: true,
  opcion: true,
  plataforma: true,
  reembolso: false,
  disputa: false,
};

/**
 * Lo que pagaron los compradores en un cobro: si la comisión la pagó el comprador, las líneas que se cobran sobre lo
 * que él sigue pagando (la pasarela, las opciones y la plataforma). El costo de un reembolso y el de una disputa son
 * del negocio: el comprador que recupera su dinero no paga lo que la pasarela se queda, y la disputa la cobra la
 * pasarela al negocio. Si pagamos nosotros (o el desglose es de antes y no lo dice), 0.
 *
 * Las comisiones del negocio son `feesTotal` menos esto, y su venta (lo facturado), el bruto vigente menos esto.
 */
export function buyerFeesOf(b: Breakdown): Money {
  if (b.state.feesPaidBy !== "comprador") return ZERO;
  const paid = b.lines.filter((line) => PAID_BY_BUYER[line.kind]);
  return toMoney(paid.reduce((sum, line) => sum.plus(dec(line.amount)), new D(0)));
}

// ─── Lo que retiene la pasarela ─────────────────────────────────────────────────────────────────────────────

/** Lo que la pasarela retuvo de un cobro y lo que le cae a cada persona cuando lo libera. */
export type Retention = {
  pct: Pct;
  /** Días corridos que lo retiene (ver `retentionReleaseOn`). */
  days: number;
  amount: Money;
  /** Una por persona, en el orden de la regla; suman exactamente `amount`. */
  shares: { beneficiaryId: string; name: string; pct: Pct; amount: Money }[];
};

/**
 * Lo que retuvo la pasarela de un cobro, según la regla congelada en su desglose (`rules.gateway.retention`): el
 * porcentaje del bruto vigente, al centavo y con el mismo redondeo que las líneas de comisión, repartido entre sus
 * personas por mayor resto (`allocate`: la suma es exacta). Con reembolso es sobre lo que queda cobrado; fallido, el
 * bruto vigente es 0 y no retiene nada. `null` si la pasarela no retenía al congelar el cobro (o el desglose es de
 * antes de existir la retención).
 *
 * La retención no es una comisión: no cambia el neto, ni las comisiones, ni el reparto. Es una parte del neto que la
 * pasarela le paga directo a esas personas: no llega al banco del negocio (`payoutOf`).
 */
export function retentionOf(b: Breakdown): Retention | null {
  const rule = b.rules.gateway.retention;
  if (rule === undefined) return null;
  const amount = toMoney(fee(dec(b.gross), rule.pct, new D(0)));
  const amounts = allocate(
    amount,
    rule.recipients.map((recipient) => recipient.pct),
  );
  return {
    pct: rule.pct,
    days: rule.days,
    amount,
    shares: rule.recipients.map((recipient, i) => ({ ...recipient, amount: amounts[i] as Money })),
  };
}

/** Lo que llega al banco de un cobro: el neto menos lo que retuvo la pasarela. Sin retención, el neto. */
export function payoutOf(b: Breakdown): Money {
  return sub(b.net, retentionOf(b)?.amount ?? ZERO);
}

/** El día en que la pasarela libera lo retenido: el del cobro más los días corridos de la retención. */
export function retentionReleaseOn(occurredOn: ISODate, days: number): ISODate {
  return addDays(occurredOn, days);
}

// ─── diff ───────────────────────────────────────────────────────────────────────────────────────────────────

const LINE_ORDER: Record<LineKind, number> = { pasarela: 1, reembolso: 2, opcion: 3, plataforma: 4, disputa: 5 };

type Cell = { key: string; label: string; amount: Money; order: number };

/** Cada monto del desglose con su clave, su etiqueta y el lugar que ocupa en el antes y después. */
function cells(b: Breakdown): Cell[] {
  return [
    { key: "gross", label: "Bruto", amount: b.gross, order: 0 },
    ...b.lines.map((line) => ({
      key: `line:${line.kind}:${line.refId ?? line.name}`,
      label: line.name,
      amount: line.amount,
      order: LINE_ORDER[line.kind],
    })),
    { key: "feesTotal", label: "Comisiones", amount: b.feesTotal, order: 6 },
    { key: "net", label: "Neto", amount: b.net, order: 7 },
    ...b.alloc.lines.map((line) => ({
      key: `alloc:${line.beneficiaryId}`,
      label: line.name,
      amount: line.amount,
      order: 8,
    })),
    ...retentionCells(retentionOf(b)),
  ];
}

/** Lo retenido y lo de cada persona, después del reparto. Sin retención no hay filas (se ven como «—»). */
function retentionCells(retention: Retention | null): Cell[] {
  if (retention === null) return [];
  return [
    { key: "retention", label: "Retenido", amount: retention.amount, order: 9 },
    ...retention.shares.map((share) => ({
      key: `retention:${share.beneficiaryId}`,
      label: `Retenido · ${share.name}`,
      amount: share.amount,
      order: 10,
    })),
  ];
}

/** El antes y el después de dos desgloses: solo las filas que cambian. «—» = la línea no existe en ese lado. */
export function diff(a: Breakdown, b: Breakdown): DiffRow[] {
  const before = new Map(cells(a).map((cell) => [cell.key, cell]));
  const after = new Map(cells(b).map((cell) => [cell.key, cell]));
  // Unión de las dos: conserva el orden de «antes», añade lo nuevo de «después» y se queda con su etiqueta.
  // El orden estable deja cada línea nueva en su grupo (un reembolso que aparece va tras la pasarela).
  const merged = [...new Map([...before, ...after]).values()].sort((x, y) => x.order - y.order);
  return merged
    .map((cell) => ({
      key: cell.key,
      label: cell.label,
      before: before.get(cell.key)?.amount ?? "—",
      after: after.get(cell.key)?.amount ?? "—",
    }))
    .filter((row) => row.before !== row.after);
}

// ─── parseBreakdown ─────────────────────────────────────────────────────────────────────────────────────────

const zMoney = z.custom<Money>(isMoney, { error: "No es un monto con dos decimales escrito como texto" });
const zPct = z.custom<Pct>((value) => typeof value === "string" && /^\d+(\.\d+)?$/.test(value), {
  error: "No es un porcentaje escrito como texto",
});

const zBreakdown = z.strictObject({
  v: z.literal(1),
  currency: z.string().regex(/^[A-Z]{3}$/, { error: "No es un código de moneda de tres letras mayúsculas" }),
  rules: z.strictObject({
    gateway: z.strictObject({
      id: z.string(),
      name: z.string(),
      feeVersionId: z.string(),
      pct: zPct,
      fixed: zMoney,
      refundsReturnFee: z.boolean(),
      disputeFee: zMoney,
      feeOverride: zMoney.optional(),
      // Solo si la pasarela retenía al congelar el cobro; los desgloses de antes no la traen.
      retention: z
        .strictObject({
          pct: zPct,
          days: z.int(),
          recipients: z.array(z.strictObject({ beneficiaryId: z.string(), name: z.string(), pct: zPct })),
        })
        .optional(),
    }),
    extras: z.array(
      z.strictObject({
        id: z.string(),
        name: z.string(),
        pct: zPct,
        fixed: zMoney,
        base: z.enum(["bruto", "despues_de_comision"]),
        payoutDaysOverride: z.int().nullable(),
        // Solo en los desgloses de una opción con ventana de días («de 1 a 3»); los de antes no la traen.
        payoutDaysOverrideMax: z.int().optional(),
      }),
    ),
    platform: z.strictObject({ channelId: z.string(), name: z.string(), pct: zPct, fixed: zMoney }).nullable(),
    scheme: z
      .strictObject({
        schemeId: z.string(),
        versionId: z.string(),
        name: z.string(),
        base: z.enum(["neto", "bruto"]),
        lines: z.array(
          z.strictObject({
            beneficiaryId: z.string(),
            name: z.string(),
            pct: zPct,
            // Los desgloses guardados antes de las partes sin comisión no la traen: todas la pagaban.
            feeExempt: z.boolean().default(false),
          }),
        ),
        remainder: z.strictObject({ beneficiaryId: z.string(), name: z.string() }).nullable(),
      })
      .nullable(),
  }),
  state: z.strictObject({
    grossOriginal: zMoney,
    refunded: zMoney,
    dispute: z.enum(["abierta", "ganada", "perdida"]).nullable(),
    failed: z.boolean(),
    // Los desgloses guardados antes de poder decir quién pagó la comisión no la traen: la pagó el negocio.
    feesPaidBy: z.enum(["nosotros", "comprador"]).default("nosotros"),
  }),
  gross: zMoney,
  lines: z.array(
    z.strictObject({
      kind: z.enum(["pasarela", "opcion", "plataforma", "reembolso", "disputa"]),
      refId: z.string().nullable(),
      name: z.string(),
      baseKind: z.enum(["bruto", "despues_de_comision", "fijo", "informado"]),
      baseAmount: zMoney,
      pct: zPct,
      fixed: zMoney,
      amount: zMoney,
    }),
  ),
  feesTotal: zMoney,
  net: zMoney,
  alloc: z.strictObject({
    baseKind: z.enum(["neto", "bruto"]).nullable(),
    baseAmount: zMoney,
    lines: z.array(
      z.strictObject({
        beneficiaryId: z.string(),
        name: z.string(),
        pct: zPct,
        amount: zMoney,
        isRemainder: z.boolean(),
        // Ídem: un reparto de antes no tiene partes sin comisión.
        feeExempt: z.boolean().default(false),
      }),
    ),
  }),
});

/**
 * Valida la forma de un desglose guardado (jsonb, versión 1). Lanza si no lo es: otra versión, montos como número…
 * Uno sin `state.feesPaidBy` (guardado antes de existir) sale con `nosotros`.
 */
export function parseBreakdown(json: unknown): Breakdown {
  return zBreakdown.parse(json);
}
