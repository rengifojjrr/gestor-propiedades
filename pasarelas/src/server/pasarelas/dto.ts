import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dec, normPct, parseBreakdown, toMoney } from "@/lib/pasarelas";
import type {
  AllocBase,
  BankAccountCfg,
  BeneficiaryCfg,
  BeneficiaryKind,
  ChannelCfg,
  CompanyCfg,
  CompanyGatewayCfg,
  Currency,
  DayType,
  DisputeState,
  EventKind,
  ExtraBase,
  ExtraCfg,
  FeeVersionCfg,
  GatewayCfg,
  ISODate,
  LeanTx,
  Lifecycle,
  Money,
  PayConfig,
  Pct,
  SchemeCfg,
  SchemeVersionCfg,
  TxSnapshot,
} from "@/lib/pasarelas";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * La frontera con la base: qué columnas pide cada lectura y cómo pasa cada fila a los tipos del motor.
 *
 * PostgREST devuelve los `numeric` como números de JSON, y el dinero nunca pasa por `number`: cada lista de
 * columnas pide los de dinero y de porcentaje con `::text`, y los mapeadores devuelven montos canónicos ("90.30")
 * y porcentajes sin ceros de relleno ("2.9"). Aquí no se hace aritmética.
 */

/** El cliente de Supabase, con los tipos de la base. Quien llama lo trae con la sesión del usuario. */
export type Db = SupabaseClient<Database>;

// ─── Lo que se pide ─────────────────────────────────────────────────────────────────────────────────────────

export const COMPANY_COLUMNS = "id, name, currency, default_scheme_id, active";
export const CHANNEL_COLUMNS = "id, company_id, name, platform_fee_pct::text, platform_fee_fixed::text, active";
export const GATEWAY_COLUMNS = "id, name, payout_days, payout_day_type, refunds_return_fee, dispute_fee::text, active";
export const FEE_VERSION_COLUMNS = "id, gateway_id, pct::text, fixed::text, effective_from, note";
export const EXTRA_COLUMNS =
  "id, gateway_id, name, pct::text, fixed::text, base, default_on, payout_days_override, active, sort, kind";
export const COMPANY_GATEWAY_COLUMNS =
  "id, company_id, gateway_id, bank_account_id, payout_days_override, default_extra_ids, active";
export const BANK_ACCOUNT_COLUMNS = "id, alias, last4, currency, active";
export const BENEFICIARY_COLUMNS = "id, name, kind, active";
export const SCHEME_COLUMNS = "id, name, active";
export const SCHEME_VERSION_COLUMNS = "id, scheme_id, version, base, remainder_beneficiary_id, effective_from";
export const SCHEME_LINE_COLUMNS = "scheme_version_id, beneficiary_id, pct::text, sort";
export const HOLIDAY_COLUMNS = "day";
export const SETTLEMENT_COLUMNS =
  "id, beneficiary_id, paid_on, currency, amount::text, method, receipt_path, receipt_mime, receipt_size, note";

/** La fila mínima de un cobro: lo que hace falta para totales, resumen y estados. */
export const LEAN_TX_COLUMNS =
  "id, occurred_on, company_id, channel_id, gateway_id, bank_account_id, currency, gross_original::text, refunded_amount::text, gross_amount::text, fees_total::text, net_amount::text, status, dispute_state, estimated_deposit_on, deposited_on, receipts_count";
/** Lo que pinta la lista de cobros: la fila mínima más sus textos y sus fechas. Sin el desglose. */
export const TX_LIST_COLUMNS =
  `${LEAN_TX_COLUMNS}, occurred_at, scheme_id, reference, note, estimated_is_manual, dispute_opened_on, dispute_closed_on, deleted_at, updated_at` as const;
/** El cobro completo, con su desglose congelado: lo que hace falta para planear un cambio. */
export const TX_COLUMNS = `${TX_LIST_COLUMNS}, breakdown` as const;

export const ALLOCATION_COLUMNS = "beneficiary_id, amount::text, pct::text, is_remainder";
export const RECEIPT_COLUMNS = "id, path, mime, size_bytes, created_at";
export const EVENT_COLUMNS = "id, at, kind, summary, data";

// ─── Lo que llega (una fila por lista de columnas) ──────────────────────────────────────────────────────────

export type CompanyRow = {
  id: string;
  name: string;
  currency: string;
  default_scheme_id: string | null;
  active: boolean;
};
export type ChannelRow = {
  id: string;
  company_id: string;
  name: string;
  platform_fee_pct: string;
  platform_fee_fixed: string;
  active: boolean;
};
export type GatewayRow = {
  id: string;
  name: string;
  payout_days: number;
  payout_day_type: string;
  refunds_return_fee: boolean;
  dispute_fee: string;
  active: boolean;
};
export type FeeVersionRow = {
  id: string;
  gateway_id: string;
  pct: string;
  fixed: string;
  effective_from: string;
  note: string | null;
};
export type ExtraRow = {
  id: string;
  gateway_id: string;
  name: string;
  pct: string;
  fixed: string;
  base: string;
  default_on: boolean;
  payout_days_override: number | null;
  active: boolean;
  sort: number;
  kind: string;
};
export type CompanyGatewayRow = {
  id: string;
  company_id: string;
  gateway_id: string;
  bank_account_id: string | null;
  payout_days_override: number | null;
  default_extra_ids: string[] | null;
  active: boolean;
};
export type BankAccountRow = { id: string; alias: string; last4: string | null; currency: string; active: boolean };
export type BeneficiaryRow = { id: string; name: string; kind: string; active: boolean };
export type SchemeRow = { id: string; name: string; active: boolean };
export type SchemeVersionRow = {
  id: string;
  scheme_id: string;
  version: number;
  base: string;
  remainder_beneficiary_id: string | null;
  effective_from: string;
};
export type SchemeLineRow = { scheme_version_id: string; beneficiary_id: string; pct: string; sort: number };
export type HolidayRow = { day: string };
export type SettlementRow = {
  id: string;
  beneficiary_id: string;
  paid_on: string;
  currency: string;
  amount: string;
  method: string | null;
  receipt_path: string | null;
  receipt_mime: string | null;
  receipt_size: number | null;
  note: string | null;
};

export type LeanTxRow = {
  id: string;
  occurred_on: string;
  company_id: string;
  channel_id: string | null;
  gateway_id: string;
  bank_account_id: string | null;
  currency: string;
  gross_original: string;
  refunded_amount: string;
  gross_amount: string;
  fees_total: string;
  net_amount: string;
  status: string;
  dispute_state: string | null;
  estimated_deposit_on: string | null;
  deposited_on: string | null;
  receipts_count: number;
};
export type TxListRow = LeanTxRow & {
  occurred_at: string;
  scheme_id: string | null;
  reference: string | null;
  note: string | null;
  estimated_is_manual: boolean;
  dispute_opened_on: string | null;
  dispute_closed_on: string | null;
  deleted_at: string | null;
  updated_at: string;
};
export type TxRow = TxListRow & { breakdown: Json };

export type AllocationRow = { beneficiary_id: string; amount: string; pct: string; is_remainder: boolean };
export type ReceiptRow = {
  id: string;
  path: string;
  mime: string;
  size_bytes: number;
  created_at: string;
};
export type EventRow = { id: string; at: string; kind: string; summary: string; data: Json | null };

/** Todas las filas de la configuración de un usuario, tabla por tabla. */
export type ConfigRows = {
  companies: CompanyRow[];
  channels: ChannelRow[];
  gateways: GatewayRow[];
  feeVersions: FeeVersionRow[];
  extras: ExtraRow[];
  companyGateways: CompanyGatewayRow[];
  bankAccounts: BankAccountRow[];
  beneficiaries: BeneficiaryRow[];
  schemes: SchemeRow[];
  schemeVersions: SchemeVersionRow[];
  schemeLines: SchemeLineRow[];
  holidays: HolidayRow[];
};

// ─── Lo que se entrega ──────────────────────────────────────────────────────────────────────────────────────

/** Un cobro en la lista: todo menos el desglose. Los nombres los resuelve la pantalla con `PayConfig`. */
export type TxListItem = Omit<TxSnapshot, "breakdown">;

export type TxAllocation = { beneficiaryId: string; amount: Money; pct: Pct; isRemainder: boolean };
export type TxReceipt = {
  id: string;
  path: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
};
export type TxEvent = {
  id: string;
  at: string;
  kind: EventKind;
  summary: string;
  data: Record<string, unknown> | null;
};

/** El cobro con su reparto, sus comprobantes y su historial (del evento más reciente al más antiguo). */
export type TxDetail = TxSnapshot & { allocations: TxAllocation[]; receipts: TxReceipt[]; events: TxEvent[] };

/** Una liquidación: lo que ya se le pagó a un beneficiario (negativo = lo que devolvió). */
export type Settlement = {
  id: string;
  beneficiaryId: string;
  paidOn: ISODate;
  currency: Currency;
  amount: Money;
  method: string | null;
  receiptPath: string | null;
  receiptMime: string | null;
  receiptSize: number | null;
  note: string | null;
};

// ─── Valores sueltos ────────────────────────────────────────────────────────────────────────────────────────

/** Un `numeric` de dinero → monto canónico. Se lee por su texto: un `number` que se colara no se opera. */
const money = (value: string | number): Money => toMoney(dec(String(value)));
/** Un `numeric` de porcentaje → sin ceros de relleno. */
const pct = (value: string | number): Pct => normPct(String(value));

// Los valores que admite cada columna de texto con lista cerrada. Como `Record`, el compilador exige que estén todos.
const LIFECYCLES: Record<Lifecycle, true> = { registrado: true, en_transito: true, depositado: true, fallido: true };
const DISPUTE_STATES: Record<DisputeState, true> = { abierta: true, ganada: true, perdida: true };
const DAY_TYPES: Record<DayType, true> = { habiles: true, corridos: true };
const EXTRA_BASES: Record<ExtraBase, true> = { bruto: true, despues_de_comision: true };
const EXTRA_KINDS: Record<ExtraCfg["kind"], true> = { opcion: true, internacional: true };
const ALLOC_BASES: Record<AllocBase, true> = { neto: true, bruto: true };
const BENEFICIARY_KINDS: Record<BeneficiaryKind, true> = { persona: true, empresa: true, cartera: true };
const EVENT_KINDS: Record<EventKind, true> = {
  creado: true,
  importado: true,
  editado: true,
  reembolso: true,
  disputa_abierta: true,
  disputa_ganada: true,
  disputa_perdida: true,
  disputa_anulada: true,
  recalculado: true,
  en_transito: true,
  depositado: true,
  deposito_revertido: true,
  fallido: true,
  reabierto: true,
  fecha_estimada: true,
  a_papelera: true,
  restaurado: true,
  comprobante_agregado: true,
  comprobante_quitado: true,
};

/** El valor, si es uno de los que el motor conoce; si no, lanza (`problem` dice de qué columna se trata). */
function known<T extends string>(values: Record<T, true>, value: string, problem: string): T {
  if (!Object.hasOwn(values, value)) throw new RangeError(`${problem}: «${value}»`);
  return value as T;
}

/** Las filas agrupadas por una clave, cada grupo en el orden en que llegaron. */
function groupBy<Row>(rows: readonly Row[], keyOf: (row: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

// ─── La configuración ───────────────────────────────────────────────────────────────────────────────────────

export function toCompanyCfg(row: CompanyRow): CompanyCfg {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    defaultSchemeId: row.default_scheme_id,
    active: row.active,
  };
}

export function toChannelCfg(row: ChannelRow): ChannelCfg {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    platformFeePct: pct(row.platform_fee_pct),
    platformFeeFixed: money(row.platform_fee_fixed),
    active: row.active,
  };
}

export function toFeeVersionCfg(row: FeeVersionRow): FeeVersionCfg {
  return { id: row.id, pct: pct(row.pct), fixed: money(row.fixed), effectiveFrom: row.effective_from, note: row.note };
}

export function toExtraCfg(row: ExtraRow): ExtraCfg {
  return {
    id: row.id,
    name: row.name,
    pct: pct(row.pct),
    fixed: money(row.fixed),
    base: known(EXTRA_BASES, row.base, "Base de la opción desconocida"),
    payoutDaysOverride: row.payout_days_override,
    defaultOn: row.default_on,
    active: row.active,
    sort: row.sort,
    kind: known(EXTRA_KINDS, row.kind, "Tipo de opción desconocido"),
  };
}

/** La pasarela con sus versiones de tarifa y sus opciones, que llegan ya ordenadas. */
export function toGatewayCfg(
  row: GatewayRow,
  feeVersions: readonly FeeVersionRow[],
  extras: readonly ExtraRow[],
): GatewayCfg {
  return {
    id: row.id,
    name: row.name,
    payoutDays: row.payout_days,
    payoutDayType: known(DAY_TYPES, row.payout_day_type, "Tipo de días desconocido"),
    refundsReturnFee: row.refunds_return_fee,
    disputeFee: money(row.dispute_fee),
    active: row.active,
    feeVersions: feeVersions.map(toFeeVersionCfg),
    extras: extras.map(toExtraCfg),
  };
}

export function toCompanyGatewayCfg(row: CompanyGatewayRow): CompanyGatewayCfg {
  return {
    id: row.id,
    companyId: row.company_id,
    gatewayId: row.gateway_id,
    bankAccountId: row.bank_account_id,
    payoutDaysOverride: row.payout_days_override,
    defaultExtraIds: row.default_extra_ids,
    active: row.active,
  };
}

export function toBankAccountCfg(row: BankAccountRow): BankAccountCfg {
  return { id: row.id, alias: row.alias, last4: row.last4, currency: row.currency, active: row.active };
}

export function toBeneficiaryCfg(row: BeneficiaryRow): BeneficiaryCfg {
  return {
    id: row.id,
    name: row.name,
    kind: known(BENEFICIARY_KINDS, row.kind, "Tipo de beneficiario desconocido"),
    active: row.active,
  };
}

/** La versión de un esquema con sus líneas, que llegan ya ordenadas. */
export function toSchemeVersionCfg(row: SchemeVersionRow, lines: readonly SchemeLineRow[]): SchemeVersionCfg {
  return {
    id: row.id,
    version: row.version,
    base: known(ALLOC_BASES, row.base, "Base del reparto desconocida"),
    remainderBeneficiaryId: row.remainder_beneficiary_id,
    effectiveFrom: row.effective_from,
    lines: lines.map((line) => ({ beneficiaryId: line.beneficiary_id, pct: pct(line.pct) })),
  };
}

export function toSchemeCfg(row: SchemeRow, versions: SchemeVersionCfg[]): SchemeCfg {
  return { id: row.id, name: row.name, active: row.active, versions };
}

/**
 * La configuración completa a partir de las filas de cada tabla: cada tarifa y cada opción con su pasarela, cada
 * línea con su versión y cada versión con su esquema. No reordena nada: quien lee las filas ya las pide en orden.
 */
export function toPayConfig(rows: ConfigRows): PayConfig {
  const feeVersions = groupBy(rows.feeVersions, (row) => row.gateway_id);
  const extras = groupBy(rows.extras, (row) => row.gateway_id);
  const schemeLines = groupBy(rows.schemeLines, (row) => row.scheme_version_id);
  const schemeVersions = groupBy(rows.schemeVersions, (row) => row.scheme_id);
  return {
    companies: rows.companies.map(toCompanyCfg),
    channels: rows.channels.map(toChannelCfg),
    gateways: rows.gateways.map((row) => toGatewayCfg(row, feeVersions.get(row.id) ?? [], extras.get(row.id) ?? [])),
    companyGateways: rows.companyGateways.map(toCompanyGatewayCfg),
    bankAccounts: rows.bankAccounts.map(toBankAccountCfg),
    beneficiaries: rows.beneficiaries.map(toBeneficiaryCfg),
    schemes: rows.schemes.map((row) =>
      toSchemeCfg(
        row,
        (schemeVersions.get(row.id) ?? []).map((version) =>
          toSchemeVersionCfg(version, schemeLines.get(version.id) ?? []),
        ),
      ),
    ),
    holidays: rows.holidays.map((row) => row.day),
  };
}

export function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    beneficiaryId: row.beneficiary_id,
    paidOn: row.paid_on,
    currency: row.currency,
    amount: money(row.amount),
    method: row.method,
    receiptPath: row.receipt_path,
    receiptMime: row.receipt_mime,
    receiptSize: row.receipt_size,
    note: row.note,
  };
}

// ─── El cobro ───────────────────────────────────────────────────────────────────────────────────────────────

export function toLeanTx(row: LeanTxRow): LeanTx {
  return {
    id: row.id,
    occurredOn: row.occurred_on,
    companyId: row.company_id,
    channelId: row.channel_id,
    gatewayId: row.gateway_id,
    bankAccountId: row.bank_account_id,
    currency: row.currency,
    grossOriginal: money(row.gross_original),
    refunded: money(row.refunded_amount),
    gross: money(row.gross_amount),
    fees: money(row.fees_total),
    net: money(row.net_amount),
    status: known(LIFECYCLES, row.status, "Estado del cobro desconocido"),
    disputeState:
      row.dispute_state === null ? null : known(DISPUTE_STATES, row.dispute_state, "Estado de la disputa desconocido"),
    estimatedDepositOn: row.estimated_deposit_on,
    depositedOn: row.deposited_on,
    receiptsCount: row.receipts_count,
  };
}

/** `occurred_at` y `updated_at` van tal cual llegan: `updated_at`, con sus microsegundos, es el control optimista. */
export function toTxListItem(row: TxListRow): TxListItem {
  return {
    ...toLeanTx(row),
    occurredAt: row.occurred_at,
    schemeId: row.scheme_id,
    reference: row.reference,
    note: row.note,
    estimatedIsManual: row.estimated_is_manual,
    disputeOpenedOn: row.dispute_opened_on,
    disputeClosedOn: row.dispute_closed_on,
    deletedAt: row.deleted_at,
    updatedAt: row.updated_at,
  };
}

/** El cobro completo. Lanza si su desglose guardado no tiene la forma de la versión 1. */
export function toTxSnapshot(row: TxRow): TxSnapshot {
  return { ...toTxListItem(row), breakdown: parseBreakdown(row.breakdown) };
}

export function toTxAllocation(row: AllocationRow): TxAllocation {
  return {
    beneficiaryId: row.beneficiary_id,
    amount: money(row.amount),
    pct: pct(row.pct),
    isRemainder: row.is_remainder,
  };
}

export function toTxReceipt(row: ReceiptRow): TxReceipt {
  return {
    id: row.id,
    path: row.path,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export function toTxEvent(row: EventRow): TxEvent {
  const { data } = row;
  return {
    id: row.id,
    at: row.at,
    kind: known(EVENT_KINDS, row.kind, "Tipo de evento desconocido"),
    summary: row.summary,
    data: typeof data === "object" && data !== null && !Array.isArray(data) ? data : null,
  };
}

/**
 * El cobro con su reparto, sus comprobantes y su historial. La tabla del reparto no guarda orden: sale en el del
 * desglose congelado (un beneficiario que el desglose no traiga va al final). Comprobantes y eventos, como lleguen.
 */
export function toTxDetail(
  row: TxRow,
  allocations: readonly AllocationRow[],
  receipts: readonly ReceiptRow[],
  events: readonly EventRow[],
): TxDetail {
  const snapshot = toTxSnapshot(row);
  const order = new Map(snapshot.breakdown.alloc.lines.map((line, index) => [line.beneficiaryId, index]));
  const place = (line: TxAllocation): number => order.get(line.beneficiaryId) ?? order.size;
  return {
    ...snapshot,
    allocations: allocations.map(toTxAllocation).sort((a, b) => place(a) - place(b)),
    receipts: receipts.map(toTxReceipt),
    events: events.map(toTxEvent),
  };
}
