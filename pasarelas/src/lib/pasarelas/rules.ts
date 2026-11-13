/**
 * De la configuración a las reglas que se congelan en un cobro (spec §5.1 y §5.2) y a los días que tarda el dinero
 * en caer (§5.4). Funciones puras: la configuración entra como parámetro.
 *
 * Todo monto sale canónico ("0.30") y todo porcentaje sin ceros de relleno ("2.9"), venga como venga en la
 * configuración: `compute` exige montos canónicos y el desglose se guarda tal cual.
 */
import { dec, normPct, toMoney } from "./decimal";
import { NO_FEE_PAYER_TEXT } from "./schemes";
import type {
  DayType,
  ExtraCfg,
  ExtraRule,
  GatewayCfg,
  GatewayRule,
  ISODate,
  Money,
  PayConfig,
  PlatformRule,
  Rules,
  SchemeRule,
  Selection,
} from "./types";
import { pickVersion } from "./versions";

// ─── Errores ────────────────────────────────────────────────────────────────────────────────────────────────

export type PayRuleCode =
  | "empresa"
  | "pasarela"
  | "canal"
  | "opcion"
  | "esquema"
  | "sin_tarifa"
  | "sin_version"
  | "nadie_paga_comision";

/** El mensaje de cada error de reglas, para mostrarlo tal cual. */
export const PAY_RULE_TEXT: Record<PayRuleCode, string> = {
  empresa: "La empresa ya no existe.",
  pasarela: "La pasarela ya no existe.",
  canal: "El canal no existe o no es de esa empresa.",
  opcion: "Una de las opciones elegidas no es de esa pasarela.",
  esquema: "El esquema de reparto no existe o le falta un beneficiario.",
  sin_tarifa: "La pasarela no tiene ninguna tarifa.",
  sin_version: "El esquema de reparto no tiene ninguna versión.",
  // Lo lanza el reparto (`compute`): todas las partes marcadas «No paga comisión» y sin «Resto» que la pague.
  nadie_paga_comision: NO_FEE_PAYER_TEXT,
};

/** Lo elegido no se puede resolver con la configuración: falta algo o no corresponde. */
export class PayRuleError extends Error {
  readonly code: PayRuleCode;

  constructor(code: PayRuleCode) {
    super(PAY_RULE_TEXT[code]);
    this.name = "PayRuleError";
    this.code = code;
  }
}

// ─── Las piezas de las reglas, una por una ──────────────────────────────────────────────────────────────────

const money = (value: string): Money => toMoney(dec(value));

const bySort = (a: ExtraCfg, b: ExtraCfg): number => a.sort - b.sort;

function gatewayOf(cfg: PayConfig, gatewayId: string): GatewayCfg {
  const gateway = cfg.gateways.find((candidate) => candidate.id === gatewayId);
  if (gateway === undefined) throw new PayRuleError("pasarela");
  return gateway;
}

/** La tarifa de la pasarela que rige en la fecha `on`. */
function feeRule(gateway: GatewayCfg, on: ISODate): Pick<GatewayRule, "feeVersionId" | "pct" | "fixed"> {
  const version = pickVersion(gateway.feeVersions, on);
  if (version === null) throw new PayRuleError("sin_tarifa");
  return { feeVersionId: version.id, pct: normPct(version.pct), fixed: money(version.fixed) };
}

function gatewayRule(cfg: PayConfig, sel: Selection, on: ISODate): GatewayRule {
  const gateway = gatewayOf(cfg, sel.gatewayId);
  return {
    id: gateway.id,
    name: gateway.name,
    ...feeRule(gateway, on),
    refundsReturnFee: gateway.refundsReturnFee,
    disputeFee: money(gateway.disputeFee),
    // Sin comisión informada la clave no existe: el desglose guardado no admite un `undefined`.
    ...(sel.feeOverride === undefined ? {} : { feeOverride: money(sel.feeOverride) }),
  };
}

/** La regla de la pasarela sin comisión informada: la clave no queda (el desglose guardado no admite `undefined`). */
function withoutOverride({ feeOverride: _informed, ...gateway }: GatewayRule): GatewayRule {
  return gateway;
}

/** Las opciones elegidas, en el orden de la configuración. Cada una tiene que ser de esa pasarela. */
function extraRules(cfg: PayConfig, sel: Selection): ExtraRule[] {
  const { extras } = gatewayOf(cfg, sel.gatewayId);
  if (!sel.extraIds.every((id) => extras.some((option) => option.id === id))) throw new PayRuleError("opcion");
  return extras
    .filter((option) => sel.extraIds.includes(option.id))
    .sort(bySort)
    .map((option) => ({
      id: option.id,
      name: option.name,
      pct: normPct(option.pct),
      fixed: money(option.fixed),
      base: option.base,
      payoutDaysOverride: option.payoutDaysOverride,
      // Solo una ventana de verdad deja la clave: un solo día se congela como antes de las ventanas.
      ...(widerThan(option.payoutDaysOverride, option.payoutDaysOverrideMax)
        ? { payoutDaysOverrideMax: option.payoutDaysOverrideMax }
        : {}),
    }));
}

/** ¿Hay un máximo mayor que el mínimo? Es decir: ¿los días son una ventana y no un solo día? */
function widerThan(min: number | null, max: number | null): max is number {
  return min !== null && max !== null && max > min;
}

/** Lo que cobra el canal. La empresa tiene que existir y el canal, si lo hay, ser suyo. */
function platformRule(cfg: PayConfig, sel: Selection): PlatformRule | null {
  if (!cfg.companies.some((company) => company.id === sel.companyId)) throw new PayRuleError("empresa");
  if (sel.channelId === null) return null;
  const channel = cfg.channels.find((candidate) => candidate.id === sel.channelId);
  if (channel === undefined || channel.companyId !== sel.companyId) throw new PayRuleError("canal");
  return {
    channelId: channel.id,
    name: channel.name,
    pct: normPct(channel.platformFeePct),
    fixed: money(channel.platformFeeFixed),
  };
}

/**
 * La versión del esquema que rige en la fecha `on`, con el nombre de cada beneficiario y la marca «No paga
 * comisión» de cada línea: la del esquema o, si el cobro dice otra cosa (`exemptIds`), la de ese cobro.
 */
function schemeRule(
  cfg: PayConfig,
  schemeId: string | null,
  on: ISODate,
  exemptIds: readonly string[] | undefined,
): SchemeRule | null {
  if (schemeId === null) return null;
  const scheme = cfg.schemes.find((candidate) => candidate.id === schemeId);
  if (scheme === undefined) throw new PayRuleError("esquema");
  const version = pickVersion(scheme.versions, on);
  if (version === null) throw new PayRuleError("sin_version");

  const named = (beneficiaryId: string): { beneficiaryId: string; name: string } => {
    const beneficiary = cfg.beneficiaries.find((candidate) => candidate.id === beneficiaryId);
    if (beneficiary === undefined) throw new PayRuleError("esquema");
    return { beneficiaryId, name: beneficiary.name };
  };
  const rule: SchemeRule = {
    schemeId: scheme.id,
    versionId: version.id,
    name: scheme.name,
    base: version.base,
    lines: version.lines.map((line) => ({
      ...named(line.beneficiaryId),
      pct: normPct(line.pct),
      feeExempt: line.feeExempt,
    })),
    remainder: version.remainderBeneficiaryId === null ? null : named(version.remainderBeneficiaryId),
  };
  return exemptIds === undefined ? rule : markFeeExempt(rule, exemptIds);
}

/**
 * El esquema congelado con otras marcas «No paga comisión»: las líneas de esos beneficiarios, y ninguna más. Lo que
 * no es una línea no cuenta (el «Resto» no se marca). Sin esquema no hay nada que marcar.
 */
function markFeeExempt(scheme: SchemeRule | null, exemptIds: readonly string[]): SchemeRule | null {
  if (scheme === null) return null;
  return {
    ...scheme,
    lines: scheme.lines.map((line) => ({ ...line, feeExempt: exemptIds.includes(line.beneficiaryId) })),
  };
}

// ─── Lo que se exporta ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Las opciones que salen marcadas al elegir esa pasarela en esa empresa: la lista de la cuenta de la pasarela de
 * la empresa si tiene una (aunque esté vacía); si no, las «encendidas por defecto». Siempre en el orden de la
 * configuración y solo opciones que existan y estén activas.
 */
export function defaultExtraIds(cfg: PayConfig, companyId: string, gatewayId: string): string[] {
  const { extras } = gatewayOf(cfg, gatewayId);
  const account = cfg.companyGateways.find((link) => link.companyId === companyId && link.gatewayId === gatewayId);
  const chosen = account?.defaultExtraIds ?? null;
  return extras
    .filter((option) => option.active && (chosen === null ? option.defaultOn : chosen.includes(option.id)))
    .sort(bySort)
    .map((option) => option.id);
}

/**
 * Las reglas de un cobro. La tarifa y la versión del esquema son las que rigen en `versionsOn` (por defecto, la
 * fecha del cobro). Lanza `PayRuleError` si algo de lo elegido no existe en la configuración o no corresponde.
 */
export function resolveRules(cfg: PayConfig, sel: Selection, versionsOn: ISODate = sel.occurredOn): Rules {
  const platform = platformRule(cfg, sel);
  return {
    gateway: gatewayRule(cfg, sel, versionsOn),
    extras: extraRules(cfg, sel),
    platform,
    scheme: schemeRule(cfg, sel.schemeId, versionsOn, sel.feeExemptIds),
  };
}

/** Quiénes no pagan comisión según unas reglas congeladas: los beneficiarios de las líneas marcadas, en su orden. */
export function feeExemptIdsOf(rules: Rules): string[] {
  return (rules.scheme?.lines ?? []).filter((line) => line.feeExempt).map((line) => line.beneficiaryId);
}

/**
 * Las reglas de un cobro que se edita: solo se vuelve a resolver lo que cambió y lo demás conserva lo congelado
 * en `prev`, aunque la configuración ya sea otra (spec §5.2).
 *  - `gateway`: la pasarela entera (con la tarifa de la fecha) y sus opciones; la comisión informada vieja no se
 *    arrastra.
 *  - `date`: solo la tarifa de la pasarela y la versión del esquema que rigen en la fecha nueva.
 *  - `extras`: las opciones. `channel`: la plataforma. `scheme`: el esquema.
 *  - `amount`: cambió el monto o la moneda. La comisión informada era la de otro monto (o de otra moneda): se
 *    descarta y vale la tarifa congelada.
 *  - `exempt`: cambió quién no paga comisión (`sel.feeExemptIds`; sin decirlo, quedan las que había): solo las
 *    marcas del esquema congelado. Si además
 *    se vuelve a resolver el esquema (`scheme` o `date`), las marcas de la selección van a la versión nueva; sin
 *    ellas, las de esa versión.
 */
export function reResolve(
  prev: Rules,
  cfg: PayConfig,
  sel: Selection,
  changed: {
    gateway: boolean;
    channel: boolean;
    extras: boolean;
    scheme: boolean;
    date: boolean;
    amount?: boolean;
    exempt?: boolean;
  },
): Rules {
  const on = sel.occurredOn;
  let { gateway } = prev;
  if (changed.amount === true) gateway = withoutOverride(gateway);
  if (changed.gateway) gateway = gatewayRule(cfg, sel, on);
  else if (changed.date) gateway = { ...gateway, ...feeRule(gatewayOf(cfg, sel.gatewayId), on) };
  let { scheme } = prev;
  if (changed.scheme || changed.date) scheme = schemeRule(cfg, sel.schemeId, on, sel.feeExemptIds);
  else if (changed.exempt === true) scheme = markFeeExempt(scheme, sel.feeExemptIds ?? feeExemptIdsOf(prev));
  return {
    gateway,
    extras: changed.gateway || changed.extras ? extraRules(cfg, sel) : prev.extras,
    platform: changed.channel ? platformRule(cfg, sel) : prev.platform,
    scheme,
  };
}

/** Los días al depósito: un mínimo y, si es una ventana, un máximo (`null` = igual al mínimo, un solo día). */
export type PayoutDays = { days: number; daysMax: number | null };

/** ¿Llega antes `a` que `b`? Por su mínimo y, a igual mínimo, por su máximo (un solo día gana a una ventana). */
const fasterThan = (a: PayoutDays, b: PayoutDays): boolean =>
  a.days !== b.days ? a.days < b.days : (a.daysMax ?? a.days) < (b.daysMax ?? b.days);

/**
 * Cuántos días tarda en caer el dinero y a qué cuenta (spec §5.4): los de la opción encendida más rápida que los
 * cambie → los de la cuenta de la pasarela de esa empresa → los de la pasarela. Cada uno es un mínimo y un máximo
 * opcional (una ventana, «de 3 a 5 días»): manda el que corresponde, entero, sin mezclar el mínimo de uno con el
 * máximo de otro. Hábiles o corridos según la pasarela. `bankAccountId` es la cuenta destino de esa cuenta de
 * pasarela (o `null`).
 *
 * Entre opciones, la más rápida es la de menor mínimo (la regla de antes de las ventanas) y, a igual mínimo, la de
 * menor máximo. El recargo internacional es una opción más: si un pago internacional que tarda de 7 a 10 días se
 * registra además con «Pago rápido» (0 días), manda la más rápida y cae el mismo día. Así lo decide la regla de
 * siempre: lo que pidió el pago rápido es justamente que llegue antes.
 */
export function resolvePayout(
  cfg: PayConfig,
  sel: Pick<Selection, "companyId" | "gatewayId">,
  extras: readonly ExtraRule[],
): PayoutDays & { dayType: DayType; source: "opcion" | "cuenta" | "pasarela"; bankAccountId: string | null } {
  const gateway = gatewayOf(cfg, sel.gatewayId);
  const account = cfg.companyGateways.find(
    (link) => link.companyId === sel.companyId && link.gatewayId === sel.gatewayId,
  );
  const rest = { dayType: gateway.payoutDayType, bankAccountId: account?.bankAccountId ?? null };

  const fromOptions = extras.flatMap((option): PayoutDays[] =>
    option.payoutDaysOverride === null
      ? []
      : [{ days: option.payoutDaysOverride, daysMax: option.payoutDaysOverrideMax ?? null }],
  );
  const fastest = fromOptions.reduce<PayoutDays | null>(
    (best, next) => (best === null || fasterThan(next, best) ? next : best),
    null,
  );
  if (fastest !== null) return { ...fastest, source: "opcion", ...rest };
  if (account !== undefined && account.payoutDaysOverride !== null) {
    return { days: account.payoutDaysOverride, daysMax: account.payoutDaysOverrideMax, source: "cuenta", ...rest };
  }
  return { days: gateway.payoutDays, daysMax: gateway.payoutDaysMax, source: "pasarela", ...rest };
}
