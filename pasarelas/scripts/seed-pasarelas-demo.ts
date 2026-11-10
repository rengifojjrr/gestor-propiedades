import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { todayNY } from "@/lib/pasarelas";
import type { Database } from "@/lib/supabase/types";
import { NotEmptyError, seedDemo, wipeUserData, type SeedSummary } from "./demo-data";

/**
 * La semilla demo, desde la línea de comandos:
 *
 *   npm run seed              siembra el libro demo en un usuario SIN datos
 *   npm run seed -- --reset   borra antes todo lo de ese usuario (solo contra el stack local)
 *
 * Contra el stack local, con `SUPABASE_SECRET_KEY`, crea (o reutiliza) el usuario demo y le pone una contraseña
 * nueva, que imprime al final. Sin la clave secreta entra con `SEED_EMAIL` y `SEED_PASSWORD`. Las variables salen
 * de `.env.local` (las carga `npm run seed`). Qué se siembra y cómo: `demo-data.ts`.
 *
 * Si `NEXT_PUBLIC_SUPABASE_URL` no es el stack local (127.0.0.1 o localhost) se niega a correr, salvo con
 * `SEED_ALLOW_REMOTE=1`; ahí entra siempre con `SEED_EMAIL` y `SEED_PASSWORD`, y `--reset` no se admite nunca.
 */

const DEMO_EMAIL = "demo@example.com";
const RESET_FLAG = "--reset";
const NO_STORED_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
/** Lo más que devuelve la API de administración por página al listar usuarios. */
const USERS_PER_PAGE = 1000;

type Db = SupabaseClient<Database>;
type Credentials = { email: string; password: string; generated: boolean };

/** Un motivo para no seguir, que se le explica a quien corrió el comando (sin traza). */
class Refusal extends Error {}

const STACK_HINT = "Corre `npm run db:start`: escribe .env.local con el stack local.";
const LOGIN_HINT = "Sin la clave secreta del stack local, la semilla entra con SEED_EMAIL y SEED_PASSWORD.";

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) throw new Refusal(`Falta ${name}. ${hint}`);
  return value;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Refusal(`NEXT_PUBLIC_SUPABASE_URL no es una URL: ${url}`);
  }
}

/** El id del usuario con ese correo. La API de administración no busca por correo: se recorre la lista. */
async function userIdByEmail(admin: Db, email: string): Promise<string> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
    if (error) throw error;
    const found = data.users.find((user) => user.email === email);
    if (found) return found.id;
    if (data.users.length < USERS_PER_PAGE) throw new Error(`El usuario ${email} existe pero no aparece en la lista.`);
  }
}

/** Crea el usuario demo, o lo reutiliza, y le deja una contraseña recién generada (no hay ninguna en el repo). */
async function demoUser(url: string, secretKey: string): Promise<Credentials> {
  const admin: Db = createClient<Database>(url, secretKey, NO_STORED_SESSION);
  const password = randomBytes(18).toString("base64url");
  const created = await admin.auth.admin.createUser({ email: DEMO_EMAIL, password, email_confirm: true });
  if (created.error) {
    if (created.error.code !== "email_exists") throw created.error;
    const id = await userIdByEmail(admin, DEMO_EMAIL);
    const updated = await admin.auth.admin.updateUserById(id, { password });
    if (updated.error) throw updated.error;
  }
  return { email: DEMO_EMAIL, password, generated: true };
}

function printSummary(summary: SeedSummary, today: string): void {
  const lines = [
    `Semilla demo lista (hoy en Nueva York: ${today}).`,
    `  Empresas: ${summary.companies} · canales: ${summary.channels} · pasarelas: ${summary.gateways} · ` +
      `cuentas destino: ${summary.bankAccounts}`,
    `  Beneficiarios: ${summary.beneficiaries} · esquemas: ${summary.schemes} · liquidaciones: ${summary.settlements}`,
    `  Cobros: ${summary.transactions} · depositados: ${summary.deposited} · por caer: ${summary.pending} ` +
      `(en tránsito: ${summary.inTransit}, atrasados: ${summary.overdue}) · fallidos: ${summary.failed}`,
    `  Reembolsos parciales: ${summary.partialRefunds} · reembolsos totales: ${summary.fullRefunds} · ` +
      `disputas abiertas: ${summary.disputes}`,
  ];
  console.log(lines.join("\n"));
}

function printLogin(credentials: Credentials): void {
  const password = credentials.generated
    ? `${credentials.password}   (recién generada: no queda guardada en ningún sitio)`
    : "la de SEED_PASSWORD";
  console.log(["", "Para entrar:", `  correo:     ${credentials.email}`, `  contraseña: ${password}`].join("\n"));
}

/** Lo que se negó se explica en una línea; lo inesperado sale entero, para poder buscarlo. */
function report(error: unknown): void {
  if (error instanceof Refusal || error instanceof NotEmptyError) console.error(error.message);
  else console.error("La semilla falló (contra el stack local, `npm run seed -- --reset` empieza de cero):", error);
  process.exitCode = 1;
}

/** Entra como ese usuario y siembra su libro; con `reset`, borra antes todo lo que tuviera. */
async function seedAs(url: string, publishableKey: string, credentials: Credentials, reset: boolean): Promise<void> {
  const supabase: Db = createClient<Database>(url, publishableKey, NO_STORED_SESSION);
  const { email, password } = credentials;
  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Refusal(`No se pudo entrar como ${email}: ${signedIn.error.message}`);
  // Con un segundo factor activo, esta sesión (sin código) no ve ni escribe nada: la base lo exige.
  const factors = await supabase.auth.mfa.listFactors();
  if (factors.error) throw factors.error;
  if (factors.data.all.some((factor) => factor.status === "verified")) {
    throw new Refusal(
      `${email} tiene activo el segundo factor y la semilla entra solo con contraseña: la base no le ` +
        "dejaría leer ni escribir. Quita el factor en Ajustes → Seguridad o usa otro usuario.",
    );
  }

  if (reset) {
    await wipeUserData(supabase, signedIn.data.user.id);
    console.log(`Borrado todo lo que tenía ${email}.`);
  }
  const today = todayNY(new Date());
  printSummary(await seedDemo(supabase, { today }), today);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== RESET_FLAG);
  if (unknown.length > 0) {
    throw new Refusal(`No conozco la opción ${unknown.join(" ")}. Uso: npm run seed [-- ${RESET_FLAG}]`);
  }
  const reset = args.includes(RESET_FLAG);

  const url = required("NEXT_PUBLIC_SUPABASE_URL", STACK_HINT);
  const host = hostOf(url);
  const local = host === "127.0.0.1" || host === "localhost";
  // Lo primero, antes de tocar la red: una base remota puede ser el libro real de quien corre el comando.
  if (!local && reset) {
    throw new Refusal(
      `${RESET_FLAG} borra todo lo del usuario y nunca se permite contra una base remota (${host}). ` +
        "Para volver a sembrar ahí, usa un usuario sin datos.",
    );
  }
  if (!local && process.env.SEED_ALLOW_REMOTE !== "1") {
    throw new Refusal(
      `NEXT_PUBLIC_SUPABASE_URL apunta a ${host}, que no es el stack local. La semilla escribe datos de ejemplo ` +
        "en el libro del usuario con el que entra: si de verdad lo quieres ahí, corre con SEED_ALLOW_REMOTE=1.",
    );
  }
  const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", STACK_HINT);

  // La clave secreta solo se usa contra el stack local. Fuera de él se entra como un usuario que ya existe.
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const credentials: Credentials =
    local && secretKey
      ? await demoUser(url, secretKey)
      : {
          email: required("SEED_EMAIL", LOGIN_HINT),
          password: required("SEED_PASSWORD", LOGIN_HINT),
          generated: false,
        };

  try {
    await seedAs(url, publishableKey, credentials, reset);
  } catch (error) {
    report(error);
    // La contraseña del usuario demo ya cambió aunque la siembra no haya salido: sin esto se quedaría sin entrada.
    if (!credentials.generated) return;
  }
  printLogin(credentials);
}

main().catch(report);
