import { randomUUID } from "node:crypto";
import { addDays, localInputToInstant, nyDate, planCreate } from "@/lib/pasarelas";
import type { Currency, ISODate, Money, NewTxInput, PayConfig, Pct } from "@/lib/pasarelas";
import type { Db } from "@/server/pasarelas/dto";
import { LIST_LIMIT, RECEIPTS_BUCKET } from "@/server/pasarelas/ops/receipts";
import { depositTx, disputeTx, failTx, refundTx, transitTx } from "@/server/pasarelas/ops/transactions";
import { ensureHolidays, loadPayConfig } from "@/server/pasarelas/queries/config";
import { saveTx } from "@/server/pasarelas/tx-save";
import { zId } from "@/server/pasarelas/zod";

/**
 * Los datos de la semilla demo y cómo se siembran y se borran. Todo es inventado: empresas, cuentas, grupos,
 * montos y referencias. Lo sembrado pasa por el mismo motor (`planCreate`) y las mismas funciones (`saveTx`, las
 * `ops`) que la app, con la sesión del usuario: cumple las mismas restricciones que un cobro de verdad.
 *
 * Es determinista: los cobros salen de un generador entero con semilla fija, los montos de una lista de cadenas
 * (el dinero nunca pasa por `number`) y las fechas se cuentan hacia atrás desde «hoy», que entra como parámetro.
 * Con el mismo «hoy», dos usuarios quedan con los mismos totales y los mismos saldos.
 */

// ─── La configuración ───────────────────────────────────────────────────────────────────────────────────────

const ACCOUNTS = [
  { alias: "Cuenta principal", institution: "Banco Demo", last4: "4821", currency: "USD" },
  { alias: "Cuenta de ahorro", institution: "Cooperativa Demo", last4: "7305", currency: "USD" },
  { alias: "Cuenta en pesos", institution: "Banco Demo", last4: "1962", currency: "MXN" },
] as const;

const BENEFICIARIES = [
  { name: "Grupo A", kind: "persona" },
  { name: "Grupo B", kind: "persona" },
  { name: "Grupo C", kind: "persona" },
  { name: "Fondo de reserva", kind: "cartera" },
] as const;

/** Uno reparte todo el neto 50/30/20; el otro deja el 25 % que no nombra como «Resto» para el fondo. */
const SCHEMES = [
  {
    name: "Reparto 50/30/20",
    lines: [
      { beneficiary: "Grupo A", pct: "50" },
      { beneficiary: "Grupo B", pct: "30" },
      { beneficiary: "Grupo C", pct: "20" },
    ],
    remainder: null,
  },
  {
    name: "Socios y reserva",
    lines: [
      { beneficiary: "Grupo A", pct: "40" },
      { beneficiary: "Grupo B", pct: "35" },
    ],
    remainder: "Fondo de reserva",
  },
] as const;

/** `prefix`: con qué empiezan sus referencias inventadas (`ch_demo_0001`). */
const GATEWAYS = [
  {
    name: "Stripe",
    prefix: "ch",
    payoutDays: 2,
    payoutDayType: "habiles",
    refundsReturnFee: false,
    disputeFee: "15.00",
    fee: { pct: "2.9", fixed: "0.30" },
    extras: [{ name: "Pago rápido", pct: "1.5", base: "bruto", payout_days_override: 0 }],
  },
  {
    name: "PayPal",
    prefix: "pp",
    payoutDays: 1,
    payoutDayType: "habiles",
    refundsReturnFee: false,
    disputeFee: "0.00",
    fee: { pct: "3.49", fixed: "0.49" },
    extras: [{ name: "Transferencia inmediata", pct: "1.75", base: "bruto", payout_days_override: 0 }],
  },
  {
    name: "Zelle",
    prefix: "zl",
    payoutDays: 0,
    payoutDayType: "corridos",
    refundsReturnFee: false,
    disputeFee: "0.00",
    fee: { pct: "0", fixed: "0.00" },
    extras: [],
  },
] as const;

type GatewayName = (typeof GATEWAYS)[number]["name"];
type AccountAlias = (typeof ACCOUNTS)[number]["alias"];

type CompanySpec = {
  name: string;
  scheme: (typeof SCHEMES)[number]["name"];
  /** Lo que cobra cada canal (la plataforma por la que entra la venta). */
  channels: readonly { name: string; pct: Pct; fixed: Money }[];
  /** Sus cuentas en las pasarelas, cada una con la cuenta destino donde cae el dinero. */
  gateways: readonly { gateway: GatewayName; account: AccountAlias }[];
};

const COMPANIES: readonly CompanySpec[] = [
  {
    name: "Tienda Demo",
    scheme: "Reparto 50/30/20",
    channels: [
      { name: "Tienda en línea", pct: "0", fixed: "0.00" },
      { name: "Mercado en línea", pct: "8", fixed: "0.00" },
    ],
    gateways: [
      { gateway: "Stripe", account: "Cuenta principal" },
      { gateway: "PayPal", account: "Cuenta de ahorro" },
    ],
  },
  {
    name: "Escuela Demo",
    scheme: "Reparto 50/30/20",
    channels: [
      { name: "Inscripciones en línea", pct: "5", fixed: "0.00" },
      { name: "Cursos grabados", pct: "10", fixed: "0.00" },
    ],
    gateways: [
      { gateway: "Stripe", account: "Cuenta principal" },
      { gateway: "Zelle", account: "Cuenta de ahorro" },
    ],
  },
  {
    name: "Estudio Demo",
    scheme: "Socios y reserva",
    channels: [
      { name: "Reservas del sitio", pct: "0", fixed: "0.00" },
      { name: "Agenda externa", pct: "3", fixed: "0.50" },
    ],
    gateways: [
      { gateway: "PayPal", account: "Cuenta de ahorro" },
      { gateway: "Zelle", account: "Cuenta principal" },
    ],
  },
];

/** Tarifas y esquemas rigen «desde el inicio»: cualquier fecha de cobro tiene su versión. */
const SINCE_THE_START = "2000-01-01";

// ─── Los cobros ─────────────────────────────────────────────────────────────────────────────────────────────

const CHARGE_COUNT = 60;
/** Los cobros van de 89 días atrás a ayer. */
const OLDEST_DAYS_AGO = 89;
/** La semilla del generador. Cambiarla cambia todos los cobros sembrados. */
const GENERATOR_SEED = 20261110;
/** Los montos posibles de un cobro: se elige uno con un índice entero, nunca se calcula. */
const AMOUNTS: readonly Money[] = [
  "49.00",
  "100.00",
  "33.33",
  "250.00",
  "75.50",
  "19.99",
  "120.00",
  "310.00",
  "64.00",
  "15.00",
  "89.90",
  "499.00",
];
const PARTIAL_REFUND: Money = "40.00";

/**
 * Qué pasa con el cobro después de registrarlo. `normal`: se deposita en su fecha estimada si ya pasó y, si no,
 * queda por caer. `atrasado`: nunca se deposita. Los reembolsos y la disputa llegan después del depósito.
 */
type Fate = "normal" | "atrasado" | "reembolso_parcial" | "reembolso_total" | "disputa" | "fallido";

type Charge = {
  daysAgo: number;
  /** Hora de Nueva York, `HH:mm`. */
  time: string;
  company: string;
  channel: string | null;
  gateway: GatewayName;
  /** Con la opción de la pasarela encendida («Pago rápido», «Transferencia inmediata»). */
  extra: boolean;
  currency: Currency;
  amount: Money;
  /** Cuenta destino elegida a mano; `null` = la de la cuenta de la pasarela en la empresa. */
  account: AccountAlias | null;
  fate: Fate;
  /** Si no llega a depositarse, queda «en tránsito» en vez de «registrado». */
  transit: boolean;
};

/** Un cobro en pesos mexicanos cae en la cuenta en pesos: las monedas no se mezclan. */
const IN_PESOS = { currency: "MXN", account: "Cuenta en pesos" } as const;

/** Un cobro fijado: empresa, canal, pasarela (sin su opción) y monto; `more` es lo que tenga de particular. */
const fixed = (
  company: string,
  channel: string | null,
  gateway: GatewayName,
  amount: Money,
  more: Partial<Charge> = {},
): Partial<Charge> => ({ company, channel, gateway, extra: false, amount, ...more });

/**
 * Los cobros que no se dejan al azar, por su posición (0 = el más antiguo): los casos que el Resumen tiene que
 * enseñar. Los últimos son de ayer o anteayer con pasarelas que tardan: siguen por caer, en tres cuentas.
 */
const FIXED_CHARGES: ReadonlyMap<number, Partial<Charge>> = new Map([
  [8, fixed("Tienda Demo", null, "PayPal", "1500.00", IN_PESOS)],
  // El cobro E1 del spec; con su reembolso de 40,00 queda como el caso E5.
  [12, fixed("Escuela Demo", "Inscripciones en línea", "Stripe", "100.00", { extra: true, fate: "reembolso_parcial" })],
  [20, fixed("Tienda Demo", "Tienda en línea", "Stripe", "250.00", { fate: "reembolso_total" })],
  [27, fixed("Estudio Demo", "Reservas del sitio", "PayPal", "49.00", { fate: "fallido" })],
  [33, fixed("Escuela Demo", null, "Zelle", "820.00", IN_PESOS)],
  [40, fixed("Tienda Demo", "Mercado en línea", "Stripe", "180.00", { fate: "disputa" })],
  [50, fixed("Escuela Demo", "Cursos grabados", "Stripe", "120.00", { fate: "atrasado" })],
  [52, fixed("Estudio Demo", "Agenda externa", "PayPal", "75.50", { fate: "atrasado", transit: true })],
  [56, fixed("Escuela Demo", "Inscripciones en línea", "Stripe", "310.00", { daysAgo: 2, transit: true })],
  [57, fixed("Tienda Demo", null, "Stripe", "2300.00", { daysAgo: 1, ...IN_PESOS })],
  [58, fixed("Tienda Demo", "Tienda en línea", "PayPal", "64.00", { daysAgo: 1, transit: true })],
  [59, fixed("Tienda Demo", "Mercado en línea", "Stripe", "250.00", { daysAgo: 1 })],
]);

type Settlement = { beneficiary: string; daysAgo: number; currency: Currency; amount: Money; method: string };

/** Lo ya pagado a cada beneficiario. Deja saldos a favor: todavía se les debe una parte. */
const SETTLEMENTS: readonly Settlement[] = [
  { beneficiary: "Grupo A", daysAgo: 60, currency: "USD", amount: "900.00", method: "Transferencia" },
  { beneficiary: "Grupo B", daysAgo: 60, currency: "USD", amount: "500.00", method: "Transferencia" },
  { beneficiary: "Grupo C", daysAgo: 58, currency: "USD", amount: "300.00", method: "Zelle" },
  { beneficiary: "Grupo A", daysAgo: 30, currency: "USD", amount: "1000.00", method: "Transferencia" },
  { beneficiary: "Grupo B", daysAgo: 30, currency: "USD", amount: "600.00", method: "Transferencia" },
  { beneficiary: "Fondo de reserva", daysAgo: 30, currency: "USD", amount: "150.00", method: "Transferencia" },
  { beneficiary: "Grupo A", daysAgo: 20, currency: "MXN", amount: "500.00", method: "Transferencia" },
];

/**
 * Generador entero con semilla (mulberry32, sin pasar a fracción): `next(n)` da un entero de 0 a n − 1, y la
 * misma semilla da la misma secuencia en cualquier máquina.
 */
function integerGenerator(seed: number): (n: number) => number {
  let state = seed >>> 0;
  return (n) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

/** El elemento con ese nombre (o lo que diga `key`). Si falta es un error de la semilla, no de quien la corre. */
function find<T>(items: readonly T[], key: (item: T) => string, wanted: string): T {
  const found = items.find((item) => key(item) === wanted);
  if (found === undefined) throw new Error(`La semilla nombra «${wanted}» y no existe.`);
  return found;
}

const byName = <T extends { name: string }>(items: readonly T[], name: string): T =>
  find(items, (item) => item.name, name);

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Los 60 cobros, del más antiguo al más reciente: al azar (con la semilla fija) salvo los fijados arriba. */
function demoCharges(): Charge[] {
  const next = integerGenerator(GENERATOR_SEED);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[next(items.length)];
    if (item === undefined) throw new Error("La semilla eligió de una lista vacía.");
    return item;
  };
  return Array.from({ length: CHARGE_COUNT }, (_, i): Charge => {
    // Todas las tiradas se hacen siempre y en este orden, también para un cobro fijado: así fijar o soltar uno
    // no cambia los demás.
    const company = pick(COMPANIES);
    const channel = pick(company.channels);
    const gateway = byName(GATEWAYS, pick(company.gateways).gateway);
    const wantsExtra = next(4) === 0;
    const amount = pick(AMOUNTS);
    const jitter = next(2);
    const time = `${pad2(8 + next(13))}:${pad2(next(60))}`;
    return {
      // Uno cada día y medio, con un día de vaivén; nunca hoy (su hora podría no haber llegado).
      daysAgo: Math.max(1, OLDEST_DAYS_AGO - Math.floor((i * 3) / 2) - jitter),
      time,
      company: company.name,
      channel: channel.name,
      gateway: gateway.name,
      extra: wantsExtra && gateway.extras.length > 0,
      currency: "USD",
      amount,
      account: null,
      fate: "normal",
      transit: false,
      ...FIXED_CHARGES.get(i),
    };
  });
}

/** El cobro como lo recibe `planCreate`, con los ids de la configuración recién sembrada. */
function toInput(cfg: PayConfig, charge: Charge, index: number, today: ISODate): NewTxInput {
  const company = byName(cfg.companies, charge.company);
  const gateway = byName(cfg.gateways, charge.gateway);
  // Dos empresas pueden tener un canal con el mismo nombre: se busca el de esta.
  const channelKey = (channel: { companyId: string; name: string }): string => `${channel.companyId}/${channel.name}`;
  const channel =
    charge.channel === null ? null : find(cfg.channels, channelKey, `${company.id}/${charge.channel}`);
  const account =
    charge.account === null ? null : find(cfg.bankAccounts, (candidate) => candidate.alias, charge.account);
  const occurredAt = localInputToInstant(`${addDays(today, -charge.daysAgo)}T${charge.time}`);
  return {
    id: randomUUID(),
    companyId: company.id,
    channelId: channel?.id ?? null,
    gatewayId: gateway.id,
    extraIds: charge.extra ? gateway.extras.map((option) => option.id) : [],
    schemeId: company.defaultSchemeId,
    occurredAt,
    occurredOn: nyDate(occurredAt),
    currency: charge.currency,
    grossOriginal: charge.amount,
    reference: `${byName(GATEWAYS, charge.gateway).prefix}_demo_${String(index + 1).padStart(4, "0")}`,
    note: null,
    bankAccountId: account?.id ?? null,
  };
}

// ─── Sembrar ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Las tablas de las que cuelga todo lo demás, en el orden en que se pueden vaciar: los cobros se llevan su
 * reparto, sus comprobantes y su historial; las empresas, sus canales y sus cuentas de pasarela; las pasarelas,
 * sus tarifas y opciones; los esquemas, sus versiones y líneas. Un usuario sin filas aquí no tiene ninguna.
 */
const ROOT_TABLES = [
  "pay_transactions",
  "pay_settlements",
  "pay_companies",
  "pay_gateways",
  "pay_schemes",
  "pay_beneficiaries",
  "pay_bank_accounts",
  "pay_holidays",
] as const;

/** Lo que dejó la semilla. Los cobros se cuentan por su ciclo del dinero. */
export type SeedSummary = {
  companies: number;
  channels: number;
  gateways: number;
  bankAccounts: number;
  beneficiaries: number;
  schemes: number;
  transactions: number;
  deposited: number;
  /** Por caer: registrados y en tránsito, atrasados incluidos. */
  pending: number;
  inTransit: number;
  /** Por caer con la fecha estimada ya pasada. */
  overdue: number;
  partialRefunds: number;
  fullRefunds: number;
  disputes: number;
  failed: number;
  settlements: number;
};

/** El usuario ya tiene datos de Pasarelas: la semilla no siembra encima de un libro que no está vacío. */
export class NotEmptyError extends Error {
  constructor() {
    super(
      "Ese usuario ya tiene datos de Pasarelas y la semilla solo siembra sobre un libro vacío. Contra el stack " +
        "local, `npm run seed -- --reset` borra antes TODO lo de ese usuario; si no, usa un usuario sin datos.",
    );
    this.name = "NotEmptyError";
  }
}

/** ¿Tiene ya algún dato de Pasarelas el usuario de esa sesión? */
async function hasData(supabase: Db): Promise<boolean> {
  const found = await Promise.all(
    ROOT_TABLES.map(async (table) => {
      const { data } = await supabase.from(table).select("id").limit(1).throwOnError();
      return data.length > 0;
    }),
  );
  return found.includes(true);
}

/** Cuentas destino, beneficiarios, esquemas, empresas con sus canales, pasarelas y la cuenta de cada una. */
async function seedConfig(supabase: Db): Promise<void> {
  const accounts = await supabase.from("pay_bank_accounts").insert([...ACCOUNTS]).select("id, alias").throwOnError();
  const beneficiaries = await supabase
    .from("pay_beneficiaries")
    .insert([...BENEFICIARIES])
    .select("id, name")
    .throwOnError();
  const beneficiaryId = (name: string): string => byName(beneficiaries.data, name).id;

  const schemes: { name: string; id: string }[] = [];
  for (const scheme of SCHEMES) {
    const saved = await supabase
      .rpc("pay_save_scheme", {
        p: {
          name: scheme.name,
          base: "neto",
          effective_from: SINCE_THE_START,
          remainder_beneficiary_id: scheme.remainder === null ? null : beneficiaryId(scheme.remainder),
          lines: scheme.lines.map((line) => ({ beneficiary_id: beneficiaryId(line.beneficiary), pct: line.pct })),
        },
      })
      .throwOnError();
    schemes.push({ name: scheme.name, id: (saved.data as { scheme_id: string }).scheme_id });
  }

  const companies = await supabase
    .from("pay_companies")
    .insert(COMPANIES.map((company) => ({ name: company.name, default_scheme_id: byName(schemes, company.scheme).id })))
    .select("id, name")
    .throwOnError();
  const companyId = (name: string): string => byName(companies.data, name).id;
  await supabase
    .from("pay_channels")
    .insert(
      COMPANIES.flatMap((company) =>
        company.channels.map((channel) => ({
          company_id: companyId(company.name),
          name: channel.name,
          platform_fee_pct: channel.pct,
          platform_fee_fixed: channel.fixed,
        })),
      ),
    )
    .throwOnError();

  // La primera tarifa de una pasarela nace con «vigente desde» 2000-01-01.
  const gateways: { name: string; id: string }[] = [];
  for (const gateway of GATEWAYS) {
    const created = await supabase
      .rpc("pay_create_gateway", {
        p: {
          name: gateway.name,
          payout_days: gateway.payoutDays,
          payout_day_type: gateway.payoutDayType,
          refunds_return_fee: gateway.refundsReturnFee,
          dispute_fee: gateway.disputeFee,
          fee: gateway.fee,
          extras: [...gateway.extras],
        },
      })
      .throwOnError();
    gateways.push({ name: gateway.name, id: created.data });
  }

  await supabase
    .from("pay_company_gateways")
    .insert(
      COMPANIES.flatMap((company) =>
        company.gateways.map((link) => ({
          company_id: companyId(company.name),
          gateway_id: byName(gateways, link.gateway).id,
          bank_account_id: find(accounts.data, (account) => account.alias, link.account).id,
        })),
      ),
    )
    .throwOnError();
}

type Registered = { id: string; charge: Charge; occurredOn: ISODate; estimatedOn: ISODate; deposited: boolean };

/** Registra los cobros en un solo lote: o entran todos o ninguno. */
async function registerCharges(supabase: Db, cfg: PayConfig, today: ISODate): Promise<Registered[]> {
  const planned = demoCharges().map((charge, index) => {
    const input = toInput(cfg, charge, index, today);
    return { charge, input, write: planCreate(cfg, input) };
  });
  const writes = planned.map((item) => item.write);
  await saveTx(supabase, writes);
  return planned.map(({ charge, input, write }) => {
    const estimatedOn = write.fields.estimatedDepositOn;
    if (typeof estimatedOn !== "string") throw new Error("Un cobro sembrado quedó sin fecha estimada.");
    const lands = charge.fate !== "atrasado" && charge.fate !== "fallido";
    return { id: input.id, charge, occurredOn: input.occurredOn, estimatedOn, deposited: lands && estimatedOn < today };
  });
}

/** Marca como depositados, fecha por fecha, los cobros cuya fecha estimada ya pasó. Devuelve cuántos. */
async function depositByDate(supabase: Db, charges: readonly Registered[]): Promise<number> {
  const byDate = new Map<ISODate, string[]>();
  for (const tx of charges) {
    if (tx.deposited) byDate.set(tx.estimatedOn, [...(byDate.get(tx.estimatedOn) ?? []), tx.id]);
  }
  let deposited = 0;
  for (const date of [...byDate.keys()].sort()) {
    deposited += await depositTx(supabase, byDate.get(date) ?? [], date);
  }
  return deposited;
}

/**
 * Siembra el libro demo con la sesión que trae `supabase`: la configuración, los feriados, unos 60 cobros en
 * los tres meses anteriores a `today` (con sus depósitos, lo que está en tránsito, por caer y atrasado, un
 * reembolso parcial, uno total, una disputa abierta y un fallido) y las liquidaciones. No crea usuarios ni lee
 * variables de entorno. Si ese usuario ya tiene algún dato de Pasarelas, lanza `NotEmptyError` sin tocar nada.
 */
export async function seedDemo(supabase: Db, opts: { today: ISODate }): Promise<SeedSummary> {
  const { today } = opts;
  if (await hasData(supabase)) throw new NotEmptyError();

  await seedConfig(supabase);
  // Antes de registrar: la fecha estimada de cada cobro cuenta días hábiles.
  await ensureHolidays(supabase);
  const cfg = await loadPayConfig(supabase);

  const charges = await registerCharges(supabase, cfg, today);
  const expected = charges.filter((tx) => tx.deposited).length;
  const deposited = await depositByDate(supabase, charges);
  if (deposited !== expected) throw new Error(`La semilla depositó ${deposited} cobros y esperaba ${expected}.`);

  const stuck = charges.filter((tx) => !tx.deposited && tx.charge.fate !== "fallido");
  const toTransit = stuck.filter((tx) => tx.charge.transit).map((tx) => tx.id);
  const inTransit = toTransit.length === 0 ? 0 : await transitTx(supabase, toTransit);

  const withFate = (fate: Fate): Registered[] => charges.filter((tx) => tx.charge.fate === fate);
  for (const tx of withFate("reembolso_parcial")) {
    await refundTx(supabase, tx.id, {
      amount: PARTIAL_REFUND,
      on: addDays(tx.occurredOn, 5),
      note: "Devolución de una parte del pedido",
    });
  }
  for (const tx of withFate("reembolso_total")) {
    await refundTx(supabase, tx.id, { amount: tx.charge.amount, on: addDays(tx.occurredOn, 7) });
  }
  for (const tx of withFate("disputa")) {
    await disputeTx(supabase, tx.id, { action: "abrir", on: addDays(tx.occurredOn, 10) });
  }
  for (const tx of withFate("fallido")) await failTx(supabase, tx.id);

  await supabase
    .from("pay_settlements")
    .insert(
      SETTLEMENTS.map((settlement) => ({
        beneficiary_id: byName(cfg.beneficiaries, settlement.beneficiary).id,
        paid_on: addDays(today, -settlement.daysAgo),
        currency: settlement.currency,
        amount: settlement.amount,
        method: settlement.method,
      })),
    )
    .throwOnError();

  return {
    companies: cfg.companies.length,
    channels: cfg.channels.length,
    gateways: cfg.gateways.length,
    bankAccounts: cfg.bankAccounts.length,
    beneficiaries: cfg.beneficiaries.length,
    schemes: cfg.schemes.length,
    transactions: charges.length,
    deposited,
    pending: stuck.length,
    inTransit,
    overdue: stuck.filter((tx) => tx.estimatedOn < today).length,
    partialRefunds: withFate("reembolso_parcial").length,
    fullRefunds: withFate("reembolso_total").length,
    disputes: withFate("disputa").length,
    failed: withFate("fallido").length,
    settlements: SETTLEMENTS.length,
  };
}

// ─── Borrar ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Borra todos los archivos de esa carpeta del bucket de comprobantes, y los de sus subcarpetas. La base no puede
 * borrarlos: se hace por la API. Storage no da error cuando no borra (dice qué borró): si deja alguno, lanza.
 */
async function emptyFolder(supabase: Db, folder: string): Promise<void> {
  const bucket = supabase.storage.from(RECEIPTS_BUCKET);
  for (;;) {
    const listed = await bucket.list(folder, { limit: LIST_LIMIT });
    if (listed.error) throw listed.error;
    // Una subcarpeta viene con `id` nulo; al quedar vacía deja de existir.
    for (const entry of listed.data) if (entry.id === null) await emptyFolder(supabase, `${folder}/${entry.name}`);
    const paths = listed.data.filter((entry) => entry.id !== null).map((entry) => `${folder}/${entry.name}`);
    if (paths.length > 0) {
      const removed = await bucket.remove(paths);
      if (removed.error) throw removed.error;
      if (removed.data.length !== paths.length) {
        throw new Error(
          `Storage borró ${removed.data.length} de ${paths.length} archivos de ${folder}: no se borra nada más.`,
        );
      }
    }
    // Si la lista no vino llena, la carpeta se vio entera. Si vino llena, puede haber más.
    if (listed.data.length < LIST_LIMIT) return;
  }
}

/**
 * Borra todo lo de Pasarelas de ese usuario: primero sus archivos del bucket de comprobantes (carpeta
 * `{userId}/`) y después sus filas, en un orden que respeta las claves foráneas. Cada borrado va filtrado por
 * `user_id`: con cualquier cliente, solo toca lo de ese usuario. No borra al usuario.
 */
export async function wipeUserData(supabase: Db, userId: string): Promise<void> {
  // Sin un id de verdad, la «carpeta del usuario» sería el bucket entero.
  if (!zId.safeParse(userId).success) throw new Error(`wipeUserData: «${userId}» no es el id de un usuario.`);
  await emptyFolder(supabase, userId);
  for (const table of ROOT_TABLES) {
    await supabase.from(table).delete().eq("user_id", userId).throwOnError();
  }
}
