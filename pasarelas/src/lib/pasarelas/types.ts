/**
 * Contrato del motor de Pasarelas. Todo el dinero viaja como cadena decimal; nunca como number.
 * Este archivo solo declara tipos: no importa nada que toque red, reloj ni base.
 */

/** Monto canónico con 2 decimales y punto: "90.30", "-3.20", "0.00". */
export type Money = string;
/** Porcentaje entre 0 y 100 como decimal sin ceros de relleno: "2.9", "33.3333", "50". */
export type Pct = string;
/** Fecha de calendario AAAA-MM-DD (en America/New_York salvo que se diga otra cosa). */
export type ISODate = string;
/** Código ISO 4217 en mayúsculas: "USD". */
export type Currency = string;

export type ExtraBase = 'bruto' | 'despues_de_comision';
export type AllocBase = 'neto' | 'bruto';
export type DayType = 'habiles' | 'corridos';
export type Lifecycle = 'registrado' | 'en_transito' | 'depositado' | 'fallido';
export type DisputeState = 'abierta' | 'ganada' | 'perdida';
export type DisplayStatus = 'fallido' | 'en_disputa' | 'reembolsado' | 'depositado' | 'en_transito' | 'registrado';
export type BeneficiaryKind = 'persona' | 'empresa' | 'cartera';

// ─── Reglas congeladas ──────────────────────────────────────────────────────────────────────────────────────

export type GatewayRule = {
  id: string;
  name: string;
  feeVersionId: string;
  pct: Pct;
  fixed: Money;
  refundsReturnFee: boolean;
  disputeFee: Money;
  /** Comisión real informada por la pasarela (importación). Si existe, reemplaza a pct + fixed. */
  feeOverride?: Money;
};

export type ExtraRule = {
  id: string;
  name: string;
  pct: Pct;
  fixed: Money;
  base: ExtraBase;
  payoutDaysOverride: number | null;
  /**
   * El máximo de la ventana con esta opción («de 1 a 3 días»), solo si es mayor que `payoutDaysOverride`. Sin la
   * clave, un solo día: así quedan los desgloses congelados antes de las ventanas, y así se siguen escribiendo.
   */
  payoutDaysOverrideMax?: number;
};

export type PlatformRule = { channelId: string; name: string; pct: Pct; fixed: Money };

export type SchemeRule = {
  schemeId: string;
  versionId: string;
  name: string;
  base: AllocBase;
  lines: { beneficiaryId: string; name: string; pct: Pct }[];
  remainder: { beneficiaryId: string; name: string } | null;
};

export type Rules = {
  gateway: GatewayRule;
  /** Solo las opciones encendidas, en su orden. */
  extras: ExtraRule[];
  platform: PlatformRule | null;
  scheme: SchemeRule | null;
};

export type State = {
  grossOriginal: Money;
  refunded: Money;
  dispute: DisputeState | null;
  failed: boolean;
};

// ─── Desglose congelado (lo que se guarda en pay_transactions.breakdown) ────────────────────────────────────

export type LineKind = 'pasarela' | 'opcion' | 'plataforma' | 'reembolso' | 'disputa';

export type BreakdownLine = {
  kind: LineKind;
  /** id de la opción o del canal cuando aplica. */
  refId: string | null;
  name: string;
  baseKind: ExtraBase | 'fijo' | 'informado';
  baseAmount: Money;
  pct: Pct;
  fixed: Money;
  amount: Money;
};

export type AllocLine = {
  beneficiaryId: string;
  name: string;
  pct: Pct;
  amount: Money;
  isRemainder: boolean;
};

export type Breakdown = {
  v: 1;
  currency: Currency;
  rules: Rules;
  state: State;
  /** Bruto vigente = grossOriginal − refunded (0 si falló). */
  gross: Money;
  lines: BreakdownLine[];
  feesTotal: Money;
  net: Money;
  alloc: { baseKind: AllocBase | null; baseAmount: Money; lines: AllocLine[] };
};

export type DiffRow = { key: string; label: string; before: string; after: string };

// ─── Configuración (lo que la app lee de la base y le pasa al motor) ────────────────────────────────────────

export type FeeVersionCfg = { id: string; pct: Pct; fixed: Money; effectiveFrom: ISODate; note: string | null };

export type ExtraCfg = Omit<ExtraRule, "payoutDaysOverrideMax"> & {
  /** El máximo de sus días propios (`payoutDaysOverride` a 60); `null` = igual al mínimo, un solo día. */
  payoutDaysOverrideMax: number | null;
  defaultOn: boolean;
  active: boolean;
  sort: number;
  /**
   * `opcion`: una opción que se elige al registrar (p. ej. «Pago rápido»). `internacional`: el recargo de la
   * pasarela a los pagos internacionales (a lo más una activa por pasarela); se aplica si el pago fue internacional.
   * Para el motor las dos son iguales: porcentaje y fijo sobre su base.
   */
  kind: "opcion" | "internacional";
};

export type GatewayCfg = {
  id: string;
  name: string;
  payoutDays: number;
  /** El máximo de la ventana («de 3 a 5 días»), de `payoutDays` a 60; `null` = igual al mínimo, un solo día. */
  payoutDaysMax: number | null;
  payoutDayType: DayType;
  refundsReturnFee: boolean;
  disputeFee: Money;
  active: boolean;
  feeVersions: FeeVersionCfg[];
  extras: ExtraCfg[];
};

export type CompanyCfg = {
  id: string;
  name: string;
  currency: Currency;
  defaultSchemeId: string | null;
  active: boolean;
};

export type ChannelCfg = {
  id: string;
  companyId: string;
  name: string;
  platformFeePct: Pct;
  platformFeeFixed: Money;
  active: boolean;
};

export type CompanyGatewayCfg = {
  id: string;
  companyId: string;
  gatewayId: string;
  bankAccountId: string | null;
  payoutDaysOverride: number | null;
  /** El máximo de los días propios de esta empresa; `null` = igual al mínimo. Sin mínimo no hay máximo. */
  payoutDaysOverrideMax: number | null;
  /** null = usar el «encendida por defecto» de cada opción. */
  defaultExtraIds: string[] | null;
  active: boolean;
};

export type BankAccountCfg = { id: string; alias: string; last4: string | null; currency: Currency; active: boolean };

export type BeneficiaryCfg = { id: string; name: string; kind: BeneficiaryKind; active: boolean };

export type SchemeVersionCfg = {
  id: string;
  version: number;
  base: AllocBase;
  remainderBeneficiaryId: string | null;
  effectiveFrom: ISODate;
  lines: { beneficiaryId: string; pct: Pct }[];
};

export type SchemeCfg = { id: string; name: string; active: boolean; versions: SchemeVersionCfg[] };

export type PayConfig = {
  companies: CompanyCfg[];
  channels: ChannelCfg[];
  gateways: GatewayCfg[];
  companyGateways: CompanyGatewayCfg[];
  bankAccounts: BankAccountCfg[];
  beneficiaries: BeneficiaryCfg[];
  schemes: SchemeCfg[];
  /** Días sin movimiento bancario. */
  holidays: ISODate[];
};

/** Lo que el dueño elige al registrar o editar un cobro. */
export type Selection = {
  companyId: string;
  channelId: string | null;
  gatewayId: string;
  extraIds: string[];
  schemeId: string | null;
  occurredOn: ISODate;
  feeOverride?: Money;
};

// ─── El cobro tal como lo ve el motor ───────────────────────────────────────────────────────────────────────

/** Fila mínima para totales, resumen y estados. */
export type LeanTx = {
  id: string;
  occurredOn: ISODate;
  companyId: string;
  channelId: string | null;
  gatewayId: string;
  bankAccountId: string | null;
  currency: Currency;
  grossOriginal: Money;
  refunded: Money;
  gross: Money;
  fees: Money;
  net: Money;
  status: Lifecycle;
  disputeState: DisputeState | null;
  /** La fecha estimada: la MÁS TARDÍA de la ventana. Con ella se decide lo atrasado y los próximos depósitos. */
  estimatedDepositOn: ISODate | null;
  /** La más temprana de la ventana; `null` = la misma que `estimatedDepositOn` (un solo día). */
  estimatedDepositFrom: ISODate | null;
  depositedOn: ISODate | null;
  receiptsCount: number;
};

/** El cobro completo guardado (lo que hace falta para planear un cambio). */
export type TxSnapshot = LeanTx & {
  occurredAt: string;
  schemeId: string | null;
  reference: string | null;
  note: string | null;
  estimatedIsManual: boolean;
  disputeOpenedOn: ISODate | null;
  disputeClosedOn: ISODate | null;
  deletedAt: string | null;
  updatedAt: string;
  breakdown: Breakdown;
};

export type EventKind =
  | 'creado' | 'importado' | 'editado' | 'reembolso' | 'disputa_abierta' | 'disputa_ganada' | 'disputa_perdida'
  | 'disputa_anulada'
  | 'recalculado' | 'en_transito' | 'depositado' | 'deposito_revertido' | 'fallido' | 'reabierto'
  | 'fecha_estimada' | 'a_papelera' | 'restaurado' | 'comprobante_agregado' | 'comprobante_quitado';

/** Columnas del cobro que se escriben. En una actualización solo van las que cambian. */
export type TxFields = {
  occurredAt: string;
  occurredOn: ISODate;
  companyId: string;
  channelId: string | null;
  gatewayId: string;
  currency: Currency;
  grossOriginal: Money;
  refundedAmount: Money;
  grossAmount: Money;
  feesTotal: Money;
  netAmount: Money;
  allocBase: AllocBase | null;
  allocBaseAmount: Money;
  breakdown: Breakdown;
  feeVersionId: string;
  schemeId: string | null;
  schemeVersionId: string | null;
  reference: string | null;
  note: string | null;
  status: Lifecycle;
  disputeState: DisputeState | null;
  disputeOpenedOn: ISODate | null;
  disputeClosedOn: ISODate | null;
  estimatedDepositOn: ISODate | null;
  /** `null` = la misma que `estimatedDepositOn`: un solo día (también la puesta a mano). */
  estimatedDepositFrom: ISODate | null;
  estimatedIsManual: boolean;
  depositedOn: ISODate | null;
  bankAccountId: string | null;
  deletedAt: string | null;
};

export type AllocWrite = { beneficiaryId: string; amount: Money; base: AllocBase; pct: Pct; isRemainder: boolean };

/** Una escritura lista para la función pay_save_transactions. */
export type TxWrite = {
  mode: 'insert' | 'update';
  id: string;
  fields: Partial<TxFields>;
  /** Control optimista: el updated_at que se leyó. */
  expectedUpdatedAt: string | null;
  /** null = no tocar el reparto. */
  allocations: AllocWrite[] | null;
  event: { kind: EventKind; summary: string; data: Record<string, unknown> | null };
};
