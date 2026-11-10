import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

/**
 * Apoyo de las pruebas de integración. Todo corre contra el Supabase LOCAL (lo exige global-setup.ts) con
 * usuarios reales: cada prueba crea los suyos, con correos únicos, y no depende de datos de otra.
 */

export type Db = SupabaseClient<Database>;

export type TestUser = { id: string; email: string; password: string; client: Db };

/** Lo que deja `seedBasics`: los ids de la configuración mínima para registrar el cobro E1 del spec. */
export type Basics = {
  companyId: string;
  channelId: string;
  gatewayId: string;
  /** La cuenta de la pasarela en la empresa (`pay_company_gateways`): Stripe en «Escuela Demo». */
  companyGatewayId: string;
  feeVersionId: string;
  /** La opción «Pago rápido» de la pasarela. */
  extraId: string;
  bankAccountId: string;
  beneficiaryIds: { a: string; b: string; c: string };
  schemeId: string;
  schemeVersionId: string;
};

const SIN_SESION_GUARDADA = { auth: { persistSession: false, autoRefreshToken: false } };

type EnvName = "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" | "SUPABASE_SECRET_KEY";

function env(name: EnvName): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name}. Corre \`npm run db:start\` (escribe .env.local).`);
  return value;
}

/** Devuelve `data` o lanza con el error de Supabase: para preparar datos sin repetir comprobaciones. */
export function unwrap<T>(res: { data: T; error: { message: string } | null }, que: string): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) {
    throw new Error(`${que}: ${res.error?.message ?? "no devolvió datos"}`);
  }
  return res.data;
}

/**
 * Comprueba que la base rechazó la operación con ese SQLSTATE (y, si se pide, con ese texto en el mensaje).
 * Usa `node:assert` y no el `expect` de Vitest: este archivo también lo importan las pruebas de punta a punta
 * (`e2e/helpers.ts`), y Vitest no se puede cargar desde Playwright.
 */
export function expectRejected(
  res: { data: unknown; error: { code?: string; message: string } | null },
  code: string,
  texto?: string,
): void {
  assert.ok(res.error, "la base debió rechazar la operación");
  assert.equal(res.error.code, code);
  if (texto) assert.ok(res.error.message.includes(texto), `«${res.error.message}» debía contener «${texto}»`);
}

/** Cliente con la clave secreta (rol service_role, salta la RLS). Solo para preparar o inspeccionar datos. */
export function adminClient(): Db {
  return createClient<Database>(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), SIN_SESION_GUARDADA);
}

/** Cliente sin sesión: el rol `anon`, como un visitante cualquiera con la clave publicable. */
export function anonClient(): Db {
  return createClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    SIN_SESION_GUARDADA,
  );
}

/** Entra con correo y contraseña en un cliente nuevo. La sesión que resulta siempre es aal1. */
export async function signInAal1(email: string, password: string): Promise<Db> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`No pudo entrar ${email}: ${error.message}`);
  return client;
}

/** Crea un usuario nuevo (correo único @example.com) y devuelve un cliente con su sesión (aal1, sin factor). */
export async function createUser(): Promise<TestUser> {
  const email = `prueba-${randomUUID()}@example.com`;
  const password = `Clave-${randomUUID()}`;
  const { data, error } = await adminClient().auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba: ${error?.message}`);
  return { id: data.user.id, email, password, client: await signInAal1(email, password) };
}

/** RFC 6238: HMAC-SHA1, período de 30 s, 6 dígitos. `secretBase32` es el `totp.secret` que da `mfa.enroll()`. */
export function totp(secretBase32: string, timeMs: number = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secretBase32.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`Carácter Base32 inválido: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 1000 / 30)));
  const hmac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** Inscribe y verifica un factor TOTP. La sesión de `client` queda en aal2 (y sus otras sesiones aal1 se cierran). */
export async function enrollTotp(client: Db): Promise<{ secret: string; factorId: string }> {
  const enroll = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `Prueba ${randomUUID()}` });
  if (enroll.error) throw new Error(`No se pudo inscribir el TOTP: ${enroll.error.message}`);
  const secret = enroll.data.totp.secret;
  const factorId = enroll.data.id;
  const verify = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  if (verify.error) throw new Error(`No se pudo verificar el TOTP: ${verify.error.message}`);
  return { secret, factorId };
}

/**
 * La configuración mínima del spec (caso E1), creada con la sesión de `client`:
 * empresa «Escuela Demo» con un canal al 5 %; Stripe 2,9 % + 0,30 con la opción «Pago rápido» (1,5 % sobre el
 * bruto, 0 días); una cuenta destino; Grupos A, B y C; y un esquema 50/30/20 sobre el neto, que queda como el
 * esquema por defecto de la empresa. La empresa tiene además su cuenta de Stripe (`pay_company_gateways`) con esa
 * cuenta destino, sin días propios y sin opciones propias.
 */
export async function seedBasics(client: Db): Promise<Basics> {
  const company = unwrap(
    await client.from("pay_companies").insert({ name: "Escuela Demo" }).select("id").single(),
    "empresa",
  );
  const channel = unwrap(
    await client
      .from("pay_channels")
      .insert({ company_id: company.id, name: "Inscripciones en línea", platform_fee_pct: "5" })
      .select("id")
      .single(),
    "canal",
  );

  const gatewayId = unwrap(
    await client.rpc("pay_create_gateway", {
      p: {
        name: "Stripe",
        fee: { pct: "2.9", fixed: "0.30" },
        extras: [{ name: "Pago rápido", pct: "1.5", base: "bruto", payout_days_override: 0 }],
      },
    }),
    "pasarela",
  );
  const feeVersion = unwrap(
    await client.from("pay_gateway_fee_versions").select("id").eq("gateway_id", gatewayId).single(),
    "versión de tarifa",
  );
  const extra = unwrap(
    await client.from("pay_gateway_extras").select("id").eq("gateway_id", gatewayId).single(),
    "opción «Pago rápido»",
  );

  const bankAccount = unwrap(
    await client
      .from("pay_bank_accounts")
      .insert({ alias: "Cuenta principal", institution: "Banco Demo", last4: "4321" })
      .select("id")
      .single(),
    "cuenta destino",
  );

  const groups = unwrap(
    await client
      .from("pay_beneficiaries")
      .insert([{ name: "Grupo A" }, { name: "Grupo B" }, { name: "Grupo C" }])
      .select("id, name"),
    "beneficiarios",
  );
  const groupId = (name: string): string => {
    const group = groups.find((g) => g.name === name);
    if (!group) throw new Error(`No se creó el beneficiario ${name}`);
    return group.id;
  };
  const beneficiaryIds = { a: groupId("Grupo A"), b: groupId("Grupo B"), c: groupId("Grupo C") };

  const scheme = unwrap(
    await client.rpc("pay_save_scheme", {
      p: {
        name: "Reparto 50/30/20",
        base: "neto",
        lines: [
          { beneficiary_id: beneficiaryIds.a, pct: "50" },
          { beneficiary_id: beneficiaryIds.b, pct: "30" },
          { beneficiary_id: beneficiaryIds.c, pct: "20" },
        ],
      },
    }),
    "esquema",
  ) as { scheme_id: string; version_id: string; version: number };

  unwrap(
    await client
      .from("pay_companies")
      .update({ default_scheme_id: scheme.scheme_id })
      .eq("id", company.id)
      .select("id")
      .single(),
    "esquema por defecto de la empresa",
  );
  const companyGateway = unwrap(
    await client
      .from("pay_company_gateways")
      .insert({ company_id: company.id, gateway_id: gatewayId, bank_account_id: bankAccount.id })
      .select("id")
      .single(),
    "cuenta de la pasarela en la empresa",
  );

  return {
    companyId: company.id,
    channelId: channel.id,
    gatewayId,
    companyGatewayId: companyGateway.id,
    feeVersionId: feeVersion.id,
    extraId: extra.id,
    bankAccountId: bankAccount.id,
    beneficiaryIds,
    schemeId: scheme.scheme_id,
    schemeVersionId: scheme.version_id,
  };
}

/** Un elemento de `pay_save_transactions`. Las columnas van con su nombre de la base y el dinero como cadena. */
export type SaveItem = {
  mode: "insert" | "update";
  tx: { [column: string]: Json };
  expected_updated_at?: string;
  allocations?: { beneficiary_id: string; amount: string; base: string; pct: string; is_remainder: boolean }[] | null;
  event?: { kind: string; summary: string; data: Json };
};

/**
 * El cobro E1 del spec ya calculado, listo para `pay_save_transactions`: 100,00 con Stripe, «Pago rápido» y el
 * canal al 5 % → comisiones 9,70, neto 90,30 y reparto 45,15 · 27,09 · 18,06. `tx` pisa columnas del cobro.
 */
export function e1Item(b: Basics, tx: { [column: string]: Json } = {}): SaveItem {
  return {
    mode: "insert",
    tx: {
      occurred_at: "2026-11-13T15:00:00+00:00",
      occurred_on: "2026-11-13",
      company_id: b.companyId,
      channel_id: b.channelId,
      gateway_id: b.gatewayId,
      currency: "USD",
      gross_original: "100.00",
      refunded_amount: "0.00",
      gross_amount: "100.00",
      fees_total: "9.70",
      net_amount: "90.30",
      alloc_base: "neto",
      alloc_base_amount: "90.30",
      breakdown: { v: 1, currency: "USD", gross: "100.00", feesTotal: "9.70", net: "90.30" },
      fee_version_id: b.feeVersionId,
      scheme_id: b.schemeId,
      scheme_version_id: b.schemeVersionId,
      status: "registrado",
      estimated_deposit_on: "2026-11-13",
      bank_account_id: b.bankAccountId,
      ...tx,
    },
    allocations: [
      { beneficiary_id: b.beneficiaryIds.a, amount: "45.15", base: "neto", pct: "50", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.b, amount: "27.09", base: "neto", pct: "30", is_remainder: false },
      { beneficiary_id: b.beneficiaryIds.c, amount: "18.06", base: "neto", pct: "20", is_remainder: false },
    ],
    event: { kind: "creado", summary: "Cobro registrado", data: null },
  };
}

/** Guarda cobros con `pay_save_transactions` y devuelve su resultado ya tipado. */
export async function saveTransactions(
  client: Db,
  items: SaveItem[],
  skipDuplicates = false,
): Promise<{ id: string; inserted: boolean; skipped: boolean }[]> {
  return unwrap(
    await client.rpc("pay_save_transactions", { p_items: items, p_skip_duplicates: skipDuplicates }),
    "pay_save_transactions",
  ) as { id: string; inserted: boolean; skipped: boolean }[];
}
