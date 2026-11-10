import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/types";
import {
  anonClient,
  createUser,
  e1Item,
  enrollTotp,
  expectRejected,
  saveTransactions,
  seedBasics,
  signInAal1,
  totp,
  type Db,
  type TestUser,
} from "./helpers";

/**
 * Una sesión que Auth cerró deja de leer y de escribir en ese mismo momento, aunque su token siga firmado hasta que
 * caduca (1 h): la política restrictiva de las tablas y de Storage (`private.pay_mfa_ok()`) exige además que la
 * sesión del token siga en `auth.sessions`. Cada caso abre dos sesiones del mismo usuario, como dos dispositivos.
 *
 * Qué sesiones borra Auth (comprobado en el stack local):
 *  - cambiar la contraseña: todas menos la que la cambió;
 *  - cerrar sesión en todos los dispositivos (`scope: 'global'`): todas, también la propia;
 *  - cerrar sesión en este dispositivo (`scope: 'local'`): solo la propia.
 */

const BUCKET = "comprobantes";

/** El token de acceso de la sesión de `client`. */
async function tokenDe(client: Db): Promise<string> {
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) throw new Error("El cliente no tiene sesión");
  return token;
}

/**
 * Un cliente que manda siempre ese token, como quien lo copió de la cookie y llama a la API directamente. Sirve
 * para seguir usando el token de una sesión que ya se cerró (supabase-js lo olvida al cerrar sesión).
 */
function conToken(token: string): Db {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
}

/** Comprueba que el token todavía no caducó: lo que lo deja fuera es la sesión cerrada, no el reloj. */
function expectVigente(token: string): void {
  const { exp } = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as { exp: number };
  expect(exp * 1000).toBeGreaterThan(Date.now() + 60_000);
}

/** Un usuario con el cobro E1 ya guardado, para tener algo que leer. */
async function usuarioConCobro(): Promise<TestUser> {
  const user = await createUser();
  await saveTransactions(user.client, [e1Item(await seedBasics(user.client))]);
  return user;
}

let dia = 0;
/** Escribe una fila nueva (un feriado con una fecha que no se repite). */
const escribir = (client: Db) =>
  client
    .from("pay_holidays")
    .insert({ day: new Date(Date.UTC(2003, 0, 1 + ++dia)).toISOString().slice(0, 10), name: "Feriado de prueba" })
    .select("id");

async function expectConAcceso(client: Db): Promise<void> {
  const lectura = await client.from("pay_transactions").select("id");
  expect(lectura.error).toBeNull();
  expect(lectura.data).toHaveLength(1);
  const escritura = await escribir(client);
  expect(escritura.error).toBeNull();
  expect(escritura.data).toHaveLength(1);
}

async function expectSinAcceso(client: Db): Promise<void> {
  const lectura = await client.from("pay_transactions").select("id");
  expect(lectura.error).toBeNull();
  expect(lectura.data).toEqual([]);
  expectRejected(await escribir(client), "42501");
}

describe("una sesión cerrada deja de leer y de escribir de inmediato", () => {
  it("al cerrar sesión en todos los dispositivos, ninguna sesión sigue entrando", async () => {
    const user = await usuarioConCobro();
    const otra = await signInAal1(user.email, user.password);
    const tokenPropio = await tokenDe(user.client);
    await expectConAcceso(user.client);
    await expectConAcceso(otra);

    const { error } = await user.client.auth.signOut({ scope: "global" });
    expect(error).toBeNull();

    expectVigente(await tokenDe(otra));
    await expectSinAcceso(otra);
    await expectSinAcceso(conToken(tokenPropio));
  });

  it("al cambiar la contraseña, las demás sesiones quedan fuera y la que la cambió sigue", async () => {
    const user = await usuarioConCobro();
    const otra = await signInAal1(user.email, user.password);
    await expectConAcceso(otra);

    const { error } = await user.client.auth.updateUser({
      password: `Otra-${randomUUID()}`,
      current_password: user.password,
    });
    expect(error).toBeNull();

    expectVigente(await tokenDe(otra));
    await expectSinAcceso(otra);
    await expectConAcceso(user.client);
  });

  it("al cerrar sesión en este dispositivo, su token deja de servir y los demás siguen", async () => {
    const user = await usuarioConCobro();
    const otra = await signInAal1(user.email, user.password);
    const tokenPropio = await tokenDe(user.client);
    await expectConAcceso(user.client);

    const { error } = await user.client.auth.signOut({ scope: "local" });
    expect(error).toBeNull();

    expectVigente(tokenPropio);
    await expectSinAcceso(conToken(tokenPropio));
    await expectConAcceso(otra);
  });

  it("con segundo factor, una sesión aal2 de otro dispositivo pierde las tablas y Storage al cambiar la contraseña", async () => {
    const user = await usuarioConCobro();
    const { secret, factorId } = await enrollTotp(user.client);
    const otra = await signInAal1(user.email, user.password);
    const verificada = await otra.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
    expect(verificada.error).toBeNull();
    const recibo = `${user.id}/${randomUUID()}/recibo.png`;
    const subida = await otra.storage
      .from(BUCKET)
      .upload(recibo, Buffer.from("89504e470d0a1a0a", "hex"), { contentType: "image/png" });
    expect(subida.error).toBeNull();
    await expectConAcceso(otra);

    const { error } = await user.client.auth.updateUser({
      password: `Otra-${randomUUID()}`,
      current_password: user.password,
    });
    expect(error).toBeNull();

    expectVigente(await tokenDe(otra));
    await expectSinAcceso(otra);
    expect((await otra.storage.from(BUCKET).download(recibo)).data).toBeNull();
    expect((await user.client.storage.from(BUCKET).download(recibo)).error).toBeNull();
  });
});

describe("el registro público", () => {
  it("está apagado: con la clave publicable no se puede crear una cuenta", async () => {
    const email = `registro-${randomUUID()}@example.com`;
    const password = `Clave-${randomUUID()}`;

    const { data, error } = await anonClient().auth.signUp({ email, password });

    expect(error?.code).toBe("signup_disabled");
    expect(data.user).toBeNull();
    const entrada = await anonClient().auth.signInWithPassword({ email, password });
    expect(entrada.error?.code).toBe("invalid_credentials");
  });
});
