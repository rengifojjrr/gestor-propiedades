import "server-only";
import type { DayType, ExtraBase, ISODate, Money, Pct } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";

/**
 * Las escrituras de la pantalla Pasarelas: la pasarela, sus tarifas y sus opciones. El cliente llega de fuera, con
 * la sesión del usuario (la RLS aplica): lo de otro usuario no se ve, y se trata como algo que ya no existe.
 *
 * Una tarifa nunca se edita: se agrega otra con su «vigente desde» (cada cobro guarda congelada la que usó). Borrar
 * lo que algún cobro usa falla; aquí se dice qué hacer en su lugar.
 */

export type GatewayFields = {
  name: string;
  payoutDays: number;
  /** El máximo de la ventana («de 3 a 5 días»); `null` = un solo día. */
  payoutDaysMax: number | null;
  payoutDayType: DayType;
  refundsReturnFee: boolean;
  disputeFee: Money;
  notes: string | null;
};

export type ExtraFields = {
  name: string;
  pct: Pct;
  fixed: Money;
  base: ExtraBase;
  defaultOn: boolean;
  payoutDaysOverride: number | null;
  /** El máximo de sus días propios; `null` = un solo día. Sin días propios, `null`. */
  payoutDaysOverrideMax: number | null;
};

/** El recargo de la pasarela a los pagos internacionales: se suma a su tarifa nacional, sobre el bruto. */
export type InternationalFee = { pct: Pct; fixed: Money };

/**
 * Cuánto tarda en caer un pago internacional: `null` en los dos, lo mismo que los nacionales; si no, sus días
 * propios (de `payoutDaysOverride` a `payoutDaysOverrideMax`, o un solo día con el máximo en `null`).
 */
export type InternationalDays = { payoutDaysOverride: number | null; payoutDaysOverrideMax: number | null };

/**
 * Una pasarela nueva con su primera tarifa (que rige «desde el inicio») y sus opciones, en su orden; y, si cobra
 * un recargo a los pagos internacionales, ese recargo (va detrás de las opciones).
 */
export type NewGateway = GatewayFields & {
  pct: Pct;
  fixed: Money;
  extras: ExtraFields[];
  international?: InternationalFee | null;
};

export type NewFeeVersion = { gatewayId: string; pct: Pct; fixed: Money; effectiveFrom: ISODate; note?: string | null };

/** Sin `id`, una opción nueva (va al final); con `id`, la opción de esa pasarela que se edita. */
export type SaveExtraInput = ExtraFields & { id?: string | null; gatewayId: string; active: boolean };

/**
 * Sin `id`, el recargo internacional nuevo de la pasarela; con `id`, el que tiene encendido, que se cambia. Con
 * sus días al depósito (los mismos que los nacionales, o los suyos).
 */
export type SaveInternationalInput = InternationalFee & InternationalDays & { id?: string | null; gatewayId: string };

/**
 * Cómo se guarda el recargo internacional: una opción de tipo `internacional` con este nombre (es el que sale en el
 * desglose), sobre el bruto y apagada por defecto (se aplica solo si el pago fue internacional). Al crear la
 * pasarela nace sin días propios: tarda lo mismo que un pago nacional. Los suyos se ponen en su ficha.
 */
const INTERNATIONAL_NAME = "Pago internacional";
const INTERNATIONAL_COLUMNS = {
  kind: "internacional",
  name: INTERNATIONAL_NAME,
  base: "bruto",
  default_on: false,
  payout_days_override: null,
  payout_days_override_max: null,
} as const;

const GATEWAY_NOT_FOUND = "Esa pasarela ya no existe.";
const FEE_NOT_FOUND = "Esa tarifa ya no existe.";
const EXTRA_NOT_FOUND = "Esa opción ya no existe.";
const INTERNATIONAL_NOT_FOUND = "Ese recargo internacional ya no existe.";
const IN_USE = "Tiene cobros: desactívala en su lugar";
const FEE_IN_USE = "Esta tarifa ya se usó en cobros: agrega una nueva con otra fecha";
const FEE_DATE_TAKEN = "Ya hay una tarifa con esa fecha";

/** La restricción única de las tarifas: una por pasarela y «vigente desde». */
const FEE_DATE_UNIQUE = "pay_gateway_fee_versions_gateway_id_effective_from_key";

/** El código de un error de la base (`23503`, `23505`…), o `null` si no lo es. */
function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : null;
}

/** ¿Lo rechazó una clave foránea? Al borrar: algo (un cobro) todavía lo usa. Al insertar: lo apuntado no existe. */
const isForeignKey = (error: unknown): boolean => codeOf(error) === "23503";

/** Corre `write` y, si la base lo rechaza por una clave foránea, lanza `text` para la persona. */
async function onForeignKey<T>(write: () => PromiseLike<T>, text: string): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isForeignKey(error)) throw new UserError(text);
    throw error;
  }
}

/** Si la escritura no tocó ninguna fila, lo que se quería cambiar no existe (o es de otro usuario). */
function touched(rows: readonly unknown[], text: string): void {
  if (rows.length === 0) throw new UserError(text);
}

const gatewayColumns = (g: GatewayFields) => ({
  name: g.name,
  payout_days: g.payoutDays,
  payout_days_max: g.payoutDaysMax,
  payout_day_type: g.payoutDayType,
  refunds_return_fee: g.refundsReturnFee,
  dispute_fee: g.disputeFee,
  notes: g.notes,
});

// ─── La pasarela ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Crea la pasarela, su primera tarifa, sus opciones y su recargo internacional (si lo tiene) en una sola
 * transacción (`pay_create_gateway`).
 */
export async function createGateway(supabase: Db, input: NewGateway): Promise<{ id: string }> {
  const extras = input.extras.map((extra) => ({
    name: extra.name,
    pct: extra.pct,
    fixed: extra.fixed,
    base: extra.base,
    default_on: extra.defaultOn,
    payout_days_override: extra.payoutDaysOverride,
    payout_days_override_max: extra.payoutDaysOverrideMax,
  }));
  const international = input.international
    ? [{ ...INTERNATIONAL_COLUMNS, pct: input.international.pct, fixed: input.international.fixed }]
    : [];
  const { data } = await supabase
    .rpc("pay_create_gateway", {
      p: {
        ...gatewayColumns(input),
        fee: { pct: input.pct, fixed: input.fixed },
        extras: [...extras, ...international],
      },
    })
    .throwOnError();
  return { id: data };
}

/** Cambia los datos de la pasarela. Sus tarifas y sus opciones no se tocan. */
export async function updateGateway(supabase: Db, id: string, input: GatewayFields): Promise<void> {
  const { data } = await supabase
    .from("pay_gateways")
    .update(gatewayColumns(input))
    .eq("id", id)
    .select("id")
    .throwOnError();
  touched(data, GATEWAY_NOT_FOUND);
}

/** Desactiva (deja de ofrecerse al registrar) o vuelve a activar la pasarela. Sus cobros no cambian. */
export async function setGatewayActive(supabase: Db, id: string, active: boolean): Promise<void> {
  const { data } = await supabase.from("pay_gateways").update({ active }).eq("id", id).select("id").throwOnError();
  touched(data, GATEWAY_NOT_FOUND);
}

/**
 * Borra la pasarela con sus tarifas, sus opciones y sus cuentas en las empresas. Si tiene cobros (también en la
 * papelera), la base no la deja borrar: se dice que se desactive.
 */
export async function deleteGateway(supabase: Db, id: string): Promise<void> {
  const { data } = await onForeignKey(
    () => supabase.from("pay_gateways").delete().eq("id", id).select("id").throwOnError(),
    IN_USE,
  );
  touched(data, GATEWAY_NOT_FOUND);
}

// ─── Las tarifas ────────────────────────────────────────────────────────────────────────────────────────────

/** Agrega una tarifa que rige desde `effectiveFrom`. La misma fecha que otra de la pasarela no se admite. */
export async function addFeeVersion(supabase: Db, input: NewFeeVersion): Promise<{ id: string }> {
  try {
    const { data } = await supabase
      .from("pay_gateway_fee_versions")
      .insert({
        gateway_id: input.gatewayId,
        pct: input.pct,
        fixed: input.fixed,
        effective_from: input.effectiveFrom,
        note: input.note ?? null,
      })
      .select("id")
      .single()
      .throwOnError();
    return { id: data.id };
  } catch (error) {
    if (isForeignKey(error)) throw new UserError(GATEWAY_NOT_FOUND);
    const message = (error as { message?: unknown } | null)?.message;
    if (codeOf(error) === "23505" && typeof message === "string" && message.includes(FEE_DATE_UNIQUE)) {
      throw new UserError(FEE_DATE_TAKEN);
    }
    throw error;
  }
}

/** Borra una tarifa que ningún cobro usa. La que ya se usó queda: se agrega otra con otra fecha. */
export async function deleteFeeVersion(supabase: Db, id: string): Promise<void> {
  const { data } = await onForeignKey(
    () => supabase.from("pay_gateway_fee_versions").delete().eq("id", id).select("id").throwOnError(),
    FEE_IN_USE,
  );
  touched(data, FEE_NOT_FOUND);
}

// ─── Las opciones ───────────────────────────────────────────────────────────────────────────────────────────

const extraColumns = (e: SaveExtraInput) => ({
  name: e.name,
  pct: e.pct,
  fixed: e.fixed,
  base: e.base,
  default_on: e.defaultOn,
  payout_days_override: e.payoutDaysOverride,
  payout_days_override_max: e.payoutDaysOverrideMax,
  active: e.active,
});

/** El orden que le toca a una opción nueva de la pasarela: detrás de la última. */
async function nextSort(supabase: Db, gatewayId: string): Promise<number> {
  const { data } = await supabase
    .from("pay_gateway_extras")
    .select("sort")
    .eq("gateway_id", gatewayId)
    .order("sort", { ascending: false })
    .limit(1)
    .throwOnError();
  const last = data[0];
  return last === undefined ? 0 : last.sort + 1;
}

/**
 * Agrega una opción a la pasarela (al final) o edita una suya. Lo ya registrado no cambia: cada cobro la congeló.
 * El recargo internacional no es una opción más: se cambia con `saveInternational`.
 */
export async function saveExtra(supabase: Db, input: SaveExtraInput): Promise<{ id: string }> {
  if (input.id) {
    const { data } = await supabase
      .from("pay_gateway_extras")
      .update(extraColumns(input))
      .eq("id", input.id)
      .eq("gateway_id", input.gatewayId)
      .eq("kind", "opcion")
      .select("id")
      .throwOnError();
    touched(data, EXTRA_NOT_FOUND);
    return { id: input.id };
  }
  const sort = await nextSort(supabase, input.gatewayId);
  const { data } = await onForeignKey(
    () =>
      supabase
        .from("pay_gateway_extras")
        .insert({ ...extraColumns(input), gateway_id: input.gatewayId, sort })
        .select("id")
        .single()
        .throwOnError(),
    GATEWAY_NOT_FOUND,
  );
  return { id: data.id };
}

/**
 * Borra una opción que ningún cobro usa. Un cobro guarda la opción dentro de su desglose congelado (no hay clave
 * foránea que la proteja): se busca ahí, también en la papelera, y si alguno la usa se dice que se desactive.
 */
export async function deleteExtra(supabase: Db, id: string): Promise<void> {
  const { count } = await supabase
    .from("pay_transactions")
    .select("id", { count: "exact", head: true })
    .contains("breakdown", { rules: { extras: [{ id }] } })
    .throwOnError();
  if (count === null) throw new Error("deleteExtra: la cuenta de cobros llegó sin total");
  if (count > 0) throw new UserError(IN_USE);
  const { data } = await supabase.from("pay_gateway_extras").delete().eq("id", id).select("id").throwOnError();
  touched(data, EXTRA_NOT_FOUND);
}

// ─── El recargo internacional ───────────────────────────────────────────────────────────────────────────────

/**
 * Agrega el recargo internacional a la pasarela (sin `id`) o cambia el que tiene encendido (con `id`): su porcentaje,
 * su fijo y sus días al depósito. Lo ya registrado no cambia: cada cobro internacional congeló el recargo (y sus
 * días) con el que se calculó. Si la pasarela ya tiene uno encendido (otra pestaña lo agregó), la base no deja
 * agregar otro: lo dice `errors.ts`.
 */
export async function saveInternational(supabase: Db, input: SaveInternationalInput): Promise<{ id: string }> {
  const fee = {
    pct: input.pct,
    fixed: input.fixed,
    payout_days_override: input.payoutDaysOverride,
    payout_days_override_max: input.payoutDaysOverrideMax,
  };
  if (input.id) {
    const { data } = await supabase
      .from("pay_gateway_extras")
      .update(fee)
      .eq("id", input.id)
      .eq("gateway_id", input.gatewayId)
      .eq("kind", "internacional")
      .eq("active", true)
      .select("id")
      .throwOnError();
    touched(data, INTERNATIONAL_NOT_FOUND);
    return { id: input.id };
  }
  const sort = await nextSort(supabase, input.gatewayId);
  const { data } = await onForeignKey(
    () =>
      supabase
        .from("pay_gateway_extras")
        .insert({ ...INTERNATIONAL_COLUMNS, ...fee, gateway_id: input.gatewayId, sort })
        .select("id")
        .single()
        .throwOnError(),
    GATEWAY_NOT_FOUND,
  );
  return { id: data.id };
}

/**
 * Quita el recargo internacional: lo apaga, no lo borra (los cobros internacionales lo guardan en su desglose).
 * Desde ese momento, al registrar ya no se pregunta si el pago fue nacional o internacional.
 */
export async function removeInternational(supabase: Db, id: string): Promise<void> {
  const { data } = await supabase
    .from("pay_gateway_extras")
    .update({ active: false })
    .eq("id", id)
    .eq("kind", "internacional")
    .eq("active", true)
    .select("id")
    .throwOnError();
  touched(data, INTERNATIONAL_NOT_FOUND);
}
