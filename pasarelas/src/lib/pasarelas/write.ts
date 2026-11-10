/**
 * Cada cambio sobre un cobro, planeado como una escritura lista para `pay_save_transactions`: las columnas que
 * cambian, el reparto nuevo (solo si cambian los números) y el evento del historial con su antes y su después.
 * Funciones puras: no leen la base ni el reloj; quien llama guarda lo que devuelven.
 *
 * Un cambio que no corresponde al estado del cobro lanza `PayStateError`; lo que no se puede resolver con la
 * configuración, `PayRuleError` (rules.ts). Un monto cobrado o un instante mal escritos los rechazan el cálculo
 * y las fechas con `RangeError`: validar la forma de lo que entra es cosa de quien llama.
 */
import { compute, diff, recalc, recompute } from "./breakdown";
import { estimateDepositDate, formatDate, nyDate } from "./dates";
import { ZERO, isMoney } from "./decimal";
import { add, cmp, formatMoney } from "./money";
import { reResolve, resolvePayout, resolveRules } from "./rules";
import type {
  AllocWrite,
  Breakdown,
  Currency,
  DiffRow,
  DisputeState,
  EventKind,
  ExtraRule,
  ISODate,
  Lifecycle,
  Money,
  PayConfig,
  Selection,
  TxFields,
  TxSnapshot,
  TxWrite,
} from "./types";

// ─── Errores ────────────────────────────────────────────────────────────────────────────────────────────────

export type PayStateCode =
  | "fecha_inconsistente"
  | "falta_fecha_deposito"
  | "monto_invalido"
  | "reembolso_excede"
  | "sin_cambios"
  | "en_papelera"
  | "no_en_papelera"
  | "fallido"
  | "no_fallido"
  | "depositado"
  | "no_depositado"
  | "en_transito"
  | "con_reembolso"
  | "con_disputa"
  | "disputa_existente"
  | "sin_disputa_abierta"
  | "disputa_perdida";

/** El mensaje de cada error de estado, para mostrarlo tal cual. */
export const PAY_STATE_TEXT: Record<PayStateCode, string> = {
  fecha_inconsistente: "La fecha del cobro no coincide con su fecha y hora en Nueva York.",
  falta_fecha_deposito: "Para registrarlo como depositado hace falta la fecha del depósito.",
  monto_invalido: "El monto tiene que ser mayor que cero y llevar dos decimales.",
  reembolso_excede: "Lo reembolsado no puede pasar de lo cobrado.",
  sin_cambios: "No hay cambios que guardar.",
  en_papelera: "El cobro está en la papelera: restáuralo para poder cambiarlo.",
  no_en_papelera: "El cobro no está en la papelera.",
  fallido: "El cobro está marcado como fallido.",
  no_fallido: "Solo se puede reabrir un cobro marcado como fallido.",
  depositado: "El cobro ya está depositado: revierte el depósito primero.",
  no_depositado: "El cobro no está depositado.",
  en_transito: "El cobro ya está en tránsito.",
  con_reembolso: "Un cobro con reembolso no se puede marcar como fallido.",
  con_disputa: "Un cobro con disputa no se puede marcar como fallido.",
  disputa_existente: "El cobro ya tiene una disputa abierta o perdida.",
  sin_disputa_abierta: "El cobro no tiene una disputa abierta.",
  disputa_perdida: "Con la disputa perdida el cobro queda reembolsado por completo.",
};

/** El cambio pedido no corresponde al estado del cobro. */
export class PayStateError extends Error {
  readonly code: PayStateCode;

  constructor(code: PayStateCode) {
    super(PAY_STATE_TEXT[code]);
    this.name = "PayStateError";
    this.code = code;
  }
}

// ─── Lo que entra ───────────────────────────────────────────────────────────────────────────────────────────

export type NewTxInput = Selection & {
  id: string;
  /** El instante del cobro (ISO 8601 con zona). `occurredOn` tiene que ser su fecha en Nueva York. */
  occurredAt: string;
  currency: Currency;
  grossOriginal: Money;
  reference: string | null;
  note: string | null;
  /** Por defecto, `registrado`. */
  status?: "registrado" | "en_transito" | "depositado";
  /** Obligatoria con `depositado`; con otro estado no se guarda. */
  depositedOn?: ISODate | null;
  /** Vacía = la de la cuenta de la pasarela de esa empresa. */
  bankAccountId?: string | null;
  /** Vacía = la automática. */
  estimatedDepositOn?: ISODate | null;
};

/** Lo que se quiere cambiar de un cobro: solo cuenta lo que viene (`undefined` = sin tocar). */
export type EditTxInput = Partial<
  Pick<
    NewTxInput,
    | "companyId"
    | "channelId"
    | "gatewayId"
    | "extraIds"
    | "schemeId"
    | "occurredAt"
    | "currency"
    | "grossOriginal"
    | "reference"
    | "note"
    | "bankAccountId"
  >
>;

// ─── Del desglose y del cobro guardado a columnas ───────────────────────────────────────────────────────────

/** Las columnas que salen del desglose: cuando se recalcula, se escriben las que hayan cambiado. */
function derived(b: Breakdown) {
  return {
    currency: b.currency,
    grossOriginal: b.state.grossOriginal,
    refundedAmount: b.state.refunded,
    grossAmount: b.gross,
    feesTotal: b.feesTotal,
    netAmount: b.net,
    allocBase: b.alloc.baseKind,
    allocBaseAmount: b.alloc.baseAmount,
    breakdown: b,
    feeVersionId: b.rules.gateway.feeVersionId,
    schemeId: b.rules.scheme?.schemeId ?? null,
    schemeVersionId: b.rules.scheme?.versionId ?? null,
    disputeState: b.state.dispute,
  } satisfies Partial<TxFields>;
}

/** El cobro guardado, columna por columna. Las que la foto del cobro no trae salen de su desglose. */
function columns(tx: TxSnapshot): TxFields {
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
    estimatedIsManual: tx.estimatedIsManual,
    depositedOn: tx.depositedOn,
    bankAccountId: tx.bankAccountId,
    deletedAt: tx.deletedAt,
  };
}

/** El reparto del desglose, como filas de `pay_allocations`. Sin esquema, ninguna. */
function allocationsOf(b: Breakdown): AllocWrite[] {
  const { baseKind, lines } = b.alloc;
  if (baseKind === null) return [];
  return lines.map((line) => ({
    beneficiaryId: line.beneficiaryId,
    amount: line.amount,
    base: baseKind,
    pct: line.pct,
    isRemainder: line.isRemainder,
  }));
}

type Photo = {
  bruto: Money;
  comisiones: Money;
  neto: Money;
  reembolsado: Money;
  estado: Lifecycle;
  disputa: DisputeState | null;
  pasarela: string;
  versionDeEsquema: string | null;
  fechaEstimada: ISODate | null;
  depositadoEl: ISODate | null;
};

/** La foto del cobro que queda en el historial: se guarda la de antes y la de después de cada cambio. */
function photo(f: TxFields): Photo {
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

/** ¿Dicen lo mismo dos valores de columna? El desglose se compara por contenido: de la base vuelve otra copia. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const left = Object.entries(a);
  const right = b as Record<string, unknown>;
  return left.length === Object.keys(right).length && left.every(([key, value]) => sameValue(value, right[key]));
}

/**
 * La escritura de un cambio sobre un cobro guardado. De `next` solo quedan las columnas que de verdad cambian
 * (`undefined` = sin tocar); el reparto se reescribe si y solo si cambia el desglose.
 */
function update(
  tx: TxSnapshot,
  next: Partial<TxFields>,
  kind: EventKind,
  summary: string,
  extra: Record<string, unknown> = {},
): TxWrite {
  const before = columns(tx);
  const fields: Partial<TxFields> = Object.fromEntries(
    Object.entries(next).filter(
      ([name, value]) => value !== undefined && !sameValue(value, before[name as keyof TxFields]),
    ),
  );
  return {
    mode: "update",
    id: tx.id,
    fields,
    expectedUpdatedAt: tx.updatedAt,
    allocations: fields.breakdown === undefined ? null : allocationsOf(fields.breakdown),
    event: { kind, summary, data: { antes: photo(before), despues: photo({ ...before, ...fields }), ...extra } },
  };
}

// ─── Comprobaciones ─────────────────────────────────────────────────────────────────────────────────────────

/** Un cobro en la papelera solo admite restaurarse. */
function requireNotTrashed(tx: TxSnapshot): void {
  if (tx.deletedAt !== null) throw new PayStateError("en_papelera");
}

/** Ni en la papelera ni fallido: lo que piden los reembolsos, las disputas, el depósito y recalcular. */
function requireLive(tx: TxSnapshot): void {
  requireNotTrashed(tx);
  if (tx.status === "fallido") throw new PayStateError("fallido");
}

// ─── Fecha estimada y selección ─────────────────────────────────────────────────────────────────────────────

/** Cuándo cae el dinero de un cobro con esas opciones, y a qué cuenta (spec §5.4). */
function payout(
  cfg: PayConfig,
  of: Pick<Selection, "companyId" | "gatewayId" | "occurredOn">,
  extras: readonly ExtraRule[],
): { on: ISODate; bankAccountId: string | null } {
  const { days, dayType, bankAccountId } = resolvePayout(cfg, of, extras);
  const holidays = new Set(cfg.holidays);
  return { on: estimateDepositDate({ occurredOn: of.occurredOn, days, dayType, holidays }), bankAccountId };
}

/** Lo que se eligió al registrar un cobro guardado. La comisión informada no se arrastra. */
function selectionOf(tx: TxSnapshot): Selection {
  return {
    companyId: tx.companyId,
    channelId: tx.channelId,
    gatewayId: tx.gatewayId,
    extraIds: tx.breakdown.rules.extras.map((option) => option.id),
    schemeId: tx.schemeId,
    occurredOn: tx.occurredOn,
  };
}

// ─── Crear ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Un cobro nuevo, calculado con la configuración: todas sus columnas, su reparto y el evento de alta. */
export function planCreate(cfg: PayConfig, input: NewTxInput, kind: "creado" | "importado" = "creado"): TxWrite {
  const occurredOn = nyDate(input.occurredAt);
  if (input.occurredOn !== occurredOn) throw new PayStateError("fecha_inconsistente");
  const status = input.status ?? "registrado";
  const depositedOn = status === "depositado" ? (input.depositedOn ?? null) : null;
  if (status === "depositado" && depositedOn === null) throw new PayStateError("falta_fecha_deposito");

  const rules = resolveRules(cfg, input);
  const state = { grossOriginal: input.grossOriginal, refunded: ZERO, dispute: null, failed: false };
  const b = compute(rules, state, input.currency);
  const automatic = payout(cfg, input, rules.extras);
  const manual = input.estimatedDepositOn ?? null;
  const fields: TxFields = {
    ...derived(b),
    occurredAt: input.occurredAt,
    occurredOn,
    companyId: input.companyId,
    channelId: input.channelId,
    gatewayId: input.gatewayId,
    reference: input.reference,
    note: input.note,
    status,
    disputeOpenedOn: null,
    disputeClosedOn: null,
    estimatedDepositOn: manual ?? automatic.on,
    estimatedIsManual: manual !== null,
    depositedOn,
    bankAccountId: input.bankAccountId ?? automatic.bankAccountId,
    deletedAt: null,
  };
  return {
    mode: "insert",
    id: input.id,
    fields,
    expectedUpdatedAt: null,
    allocations: allocationsOf(b),
    event: {
      kind,
      summary: `Cobro de ${formatMoney(b.gross, b.currency)} por ${rules.gateway.name}`,
      data: { antes: null, despues: photo(fields) },
    },
  };
}

// ─── Editar ─────────────────────────────────────────────────────────────────────────────────────────────────

const pick = <T>(wanted: T | undefined, current: T): T => (wanted === undefined ? current : wanted);

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * La edición de un cobro. Solo se vuelven a resolver las reglas de lo que cambió (pasarela, canal, opciones,
 * esquema o fecha); lo demás conserva lo congelado, igual que el reembolso, la disputa y el «fallido». La fecha
 * estimada se recalcula si cambió la fecha, la pasarela o las opciones, salvo que esté puesta a mano.
 *
 * Una disputa perdida es un reembolso total (spec §5.2.7): ahí lo reembolsado sigue al monto, suba o baje.
 *
 * Al cambiar de pasarela hay que decir qué opciones lleva (`extraIds`): las de la anterior no son suyas. Al
 * cambiar de empresa, el canal tiene que ser de la nueva.
 */
export function planEdit(cfg: PayConfig, tx: TxSnapshot, input: EditTxInput): TxWrite {
  requireNotTrashed(tx);
  const prev = tx.breakdown;
  const before = selectionOf(tx);
  const movedInTime = input.occurredAt !== undefined && Date.parse(input.occurredAt) !== Date.parse(tx.occurredAt);
  const sel: Selection = {
    companyId: pick(input.companyId, before.companyId),
    channelId: pick(input.channelId, before.channelId),
    gatewayId: pick(input.gatewayId, before.gatewayId),
    extraIds: pick(input.extraIds, before.extraIds),
    schemeId: pick(input.schemeId, before.schemeId),
    occurredOn: input.occurredAt === undefined ? before.occurredOn : nyDate(input.occurredAt),
  };
  const currency = pick(input.currency, tx.currency);
  const grossOriginal = pick(input.grossOriginal, tx.grossOriginal);
  const changed = {
    company: sel.companyId !== before.companyId,
    channel: sel.channelId !== before.channelId,
    gateway: sel.gatewayId !== before.gatewayId,
    extras: !sameIds(sel.extraIds, before.extraIds),
    scheme: sel.schemeId !== before.schemeId,
    date: sel.occurredOn !== before.occurredOn,
  };

  // Lo que cambió, en el orden en que lo lista el historial.
  const labels = [
    { label: "monto", did: grossOriginal !== tx.grossOriginal },
    { label: "moneda", did: currency !== tx.currency },
    { label: "fecha", did: movedInTime },
    { label: "empresa", did: changed.company },
    { label: "canal", did: changed.channel },
    { label: "pasarela", did: changed.gateway },
    { label: "opciones", did: changed.extras },
    { label: "esquema", did: changed.scheme },
    { label: "referencia", did: pick(input.reference, tx.reference) !== tx.reference },
    { label: "nota", did: pick(input.note, tx.note) !== tx.note },
    { label: "cuenta destino", did: pick(input.bankAccountId, tx.bankAccountId) !== tx.bankAccountId },
  ].flatMap((item) => (item.did ? [item.label] : []));
  if (labels.length === 0) throw new PayStateError("sin_cambios");
  const lost = prev.state.dispute === "perdida";
  if (!lost && cmp(grossOriginal, tx.refunded) < 0) throw new PayStateError("reembolso_excede");

  // Un canal es de una sola empresa: si cambia la empresa, la plataforma se vuelve a resolver (y a comprobar).
  const again = { ...changed, channel: changed.channel || changed.company };
  const anyRule = again.gateway || again.channel || again.extras || again.scheme || again.date;
  const state = { ...prev.state, grossOriginal, refunded: lost ? grossOriginal : prev.state.refunded };
  // Lo congelado solo se vuelve a calcular si cambió algo que entra en el cálculo.
  const b =
    anyRule || grossOriginal !== tx.grossOriginal || currency !== tx.currency
      ? compute(reResolve(prev.rules, cfg, sel, again), state, currency)
      : prev;
  const movesDeposit = (changed.date || changed.gateway || changed.extras) && !tx.estimatedIsManual;
  return update(
    tx,
    {
      ...derived(b),
      occurredAt: movedInTime ? input.occurredAt : undefined,
      occurredOn: sel.occurredOn,
      companyId: sel.companyId,
      channelId: sel.channelId,
      gatewayId: sel.gatewayId,
      reference: input.reference,
      note: input.note,
      bankAccountId: input.bankAccountId,
      estimatedDepositOn: movesDeposit ? payout(cfg, sel, b.rules.extras).on : undefined,
    },
    "editado",
    `Editado: ${labels.join(", ")}`,
  );
}

// ─── Reembolsos ─────────────────────────────────────────────────────────────────────────────────────────────

/** El cobro con ese total reembolsado. `total` ya viene comprobado como monto. */
function refundedTo(tx: TxSnapshot, total: Money): Partial<TxFields> {
  if (cmp(total, tx.grossOriginal) > 0) throw new PayStateError("reembolso_excede");
  return derived(recompute(tx.breakdown, { refunded: total }));
}

/** Un reembolso más: se suma a lo ya reembolsado. Nunca sobre un fallido ni por más de lo que queda. */
export function planRefund(tx: TxSnapshot, a: { amount: Money; on: ISODate; note?: string | null }): TxWrite {
  requireLive(tx);
  if (!isMoney(a.amount) || cmp(a.amount, ZERO) <= 0) throw new PayStateError("monto_invalido");
  return update(
    tx,
    refundedTo(tx, add(tx.refunded, a.amount)),
    "reembolso",
    `Reembolso de ${formatMoney(a.amount, tx.currency)}`,
    { monto: a.amount, fecha: a.on, nota: a.note ?? null },
  );
}

/**
 * Corrige el total reembolsado (de cero a lo cobrado) en vez de sumarle. Con la disputa perdida el reembolso es
 * total y no admite otro valor.
 */
export function planRefundTotal(tx: TxSnapshot, total: Money): TxWrite {
  requireLive(tx);
  if (!isMoney(total) || cmp(total, ZERO) < 0) throw new PayStateError("monto_invalido");
  if (tx.disputeState === "perdida" && cmp(total, tx.grossOriginal) !== 0) throw new PayStateError("disputa_perdida");
  return update(tx, refundedTo(tx, total), "reembolso", `Reembolso corregido a ${formatMoney(total, tx.currency)}`);
}

// ─── Disputas ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Una disputa se abre sobre un cobro sin disputa o con una ganada; se gana, se pierde o se anula solo si está
 * abierta. Perderla implica el reembolso total, y así se queda: `planEdit` y `planRefundTotal` lo mantienen.
 */
export function planDispute(
  tx: TxSnapshot,
  a: { action: "abrir" | "ganar" | "perder" | "anular"; on: ISODate },
): TxWrite {
  requireLive(tx);
  const b = tx.breakdown;
  const fecha = { fecha: a.on };
  if (a.action === "abrir") {
    if (tx.disputeState !== null && tx.disputeState !== "ganada") throw new PayStateError("disputa_existente");
    const opened = derived(recompute(b, { dispute: "abierta" }));
    const next = { ...opened, disputeOpenedOn: a.on, disputeClosedOn: null };
    return update(tx, next, "disputa_abierta", "Disputa abierta", fecha);
  }
  if (tx.disputeState !== "abierta") throw new PayStateError("sin_disputa_abierta");
  if (a.action === "ganar") {
    const next = { ...derived(recompute(b, { dispute: "ganada" })), disputeClosedOn: a.on };
    return update(tx, next, "disputa_ganada", "Disputa ganada", fecha);
  }
  if (a.action === "perder") {
    const lost = derived(recompute(b, { dispute: "perdida", refunded: tx.grossOriginal }));
    return update(tx, { ...lost, disputeClosedOn: a.on }, "disputa_perdida", "Disputa perdida", fecha);
  }
  const next = { ...derived(recompute(b, { dispute: null })), disputeOpenedOn: null, disputeClosedOn: null };
  return update(tx, next, "disputa_anulada", "Disputa anulada", fecha);
}

// ─── Fallido y reabrir ──────────────────────────────────────────────────────────────────────────────────────

/** Marca el cobro como fallido: todo en cero. Solo sin depósito, sin reembolso y sin disputa. */
export function planFail(tx: TxSnapshot): TxWrite {
  requireNotTrashed(tx);
  if (tx.status === "depositado" || tx.status === "fallido") throw new PayStateError(tx.status);
  if (cmp(tx.refunded, ZERO) !== 0) throw new PayStateError("con_reembolso");
  if (tx.disputeState !== null) throw new PayStateError("con_disputa");
  const next = { ...derived(recompute(tx.breakdown, { failed: true })), status: "fallido" as const };
  return update(tx, next, "fallido", "Marcado como fallido");
}

/** Un fallido vuelve a «registrado», con sus números de antes. */
export function planReopen(tx: TxSnapshot): TxWrite {
  requireNotTrashed(tx);
  if (tx.status !== "fallido") throw new PayStateError("no_fallido");
  const next = { ...derived(recompute(tx.breakdown, { failed: false })), status: "registrado" as const };
  return update(tx, next, "reabierto", "Reabierto");
}

// ─── El camino del dinero ───────────────────────────────────────────────────────────────────────────────────

/** De «registrado» a «en tránsito». */
export function planTransit(tx: TxSnapshot): TxWrite {
  requireNotTrashed(tx);
  if (tx.status !== "registrado") throw new PayStateError(tx.status);
  return update(tx, { status: "en_transito" }, "en_transito", "En tránsito");
}

/** Depositado el día `on`, desde «registrado» o «en tránsito»; si ya lo estaba, cambia la fecha. */
export function planDeposit(tx: TxSnapshot, on: ISODate): TxWrite {
  requireLive(tx);
  return update(tx, { status: "depositado", depositedOn: on }, "depositado", `Depositado el ${formatDate(on)}`);
}

/** Deshace el depósito: el cobro vuelve a «en tránsito». */
export function planRevertDeposit(tx: TxSnapshot): TxWrite {
  requireNotTrashed(tx);
  if (tx.status !== "depositado") throw new PayStateError("no_depositado");
  return update(tx, { status: "en_transito", depositedOn: null }, "deposito_revertido", "Depósito revertido");
}

/**
 * La fecha estimada: una fecha la fija a mano; `null` vuelve a la automática, calculada con las opciones
 * congeladas en el cobro.
 */
export function planEstimated(cfg: PayConfig, tx: TxSnapshot, date: ISODate | null): TxWrite {
  requireNotTrashed(tx);
  if (date !== null) {
    const next = { estimatedDepositOn: date, estimatedIsManual: true };
    return update(tx, next, "fecha_estimada", `Fecha estimada: ${formatDate(date)}`);
  }
  const next = { estimatedDepositOn: payout(cfg, tx, tx.breakdown.rules.extras).on, estimatedIsManual: false };
  return update(tx, next, "fecha_estimada", "Fecha estimada automática");
}

// ─── Recalcular ─────────────────────────────────────────────────────────────────────────────────────────────

const RECALC_SUMMARY = {
  hoy: "Recalculado con la tarifa de hoy",
  fecha_del_cobro: "Recalculado con la tarifa de la fecha del cobro",
} as const;

/**
 * Vuelve a calcular el cobro con la configuración de ahora: con las versiones que rigen hoy (`hoy`) o con las
 * que correspondían a la fecha del cobro (`fecha_del_cobro`). La comisión informada se descarta y las opciones
 * que ya no existen se omiten; el estado (reembolso, disputa) se conserva. `changes` es el antes y el después:
 * si está vacío no cambió ningún número y no hace falta escribir.
 */
export function planRecalc(
  cfg: PayConfig,
  tx: TxSnapshot,
  mode: "hoy" | "fecha_del_cobro",
  today: ISODate,
): { write: TxWrite; changes: DiffRow[] } {
  requireLive(tx);
  const frozen = selectionOf(tx);
  const gateway = cfg.gateways.find((candidate) => candidate.id === tx.gatewayId);
  // Si la pasarela ya no existe, `resolveRules` lo dice con su error.
  const known = new Set(gateway?.extras.map((option) => option.id));
  const sel: Selection = { ...frozen, extraIds: frozen.extraIds.filter((id) => known.has(id)) };
  const next = recalc(tx.breakdown, resolveRules(cfg, sel, mode === "hoy" ? today : tx.occurredOn));
  const estimatedDepositOn = tx.estimatedIsManual ? undefined : payout(cfg, sel, next.rules.extras).on;
  return {
    write: update(tx, { ...derived(next), estimatedDepositOn }, "recalculado", RECALC_SUMMARY[mode]),
    changes: diff(tx.breakdown, next),
  };
}

// ─── Papelera ───────────────────────────────────────────────────────────────────────────────────────────────

/** A la papelera en el instante `nowIso` (el reloj lo pone quien llama). */
export function planTrash(tx: TxSnapshot, nowIso: string): TxWrite {
  requireNotTrashed(tx);
  return update(tx, { deletedAt: nowIso }, "a_papelera", "A la papelera");
}

/** Saca el cobro de la papelera. */
export function planRestore(tx: TxSnapshot): TxWrite {
  if (tx.deletedAt === null) throw new PayStateError("no_en_papelera");
  return update(tx, { deletedAt: null }, "restaurado", "Restaurado");
}
