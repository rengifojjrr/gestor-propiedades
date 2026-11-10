import { expect, type Page } from "@playwright/test";
import { createUser, seedBasics, totp, type Basics } from "../tests/integration/helpers";

export { expectNoSeriousAxe } from "./axe";

/**
 * Apoyo de las pruebas de punta a punta. Los usuarios son reales, del Supabase LOCAL: cada archivo crea los
 * suyos (correo único `@example.com`) y entra por la pantalla de verdad.
 */

/** Un usuario de prueba con la configuración mínima del spec ya cargada (`seedBasics`). Sin segundo factor. */
export type TestUser = { id: string; email: string; password: string; basics: Basics };

/** Estas pruebas crean usuarios con la clave secreta: nunca contra un proyecto que no sea el stack local. */
function assertLocalStack(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL. Corre `npm run db:start` (escribe .env.local).");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Las pruebas de punta a punta solo corren contra el stack local, no contra ${host}.`);
  }
}

/** Crea un usuario nuevo y le carga empresa, canal, pasarela, cuenta destino, beneficiarios y esquema. */
export async function newUser(): Promise<TestUser> {
  assertLocalStack();
  const { id, email, password, client } = await createUser();
  const basics = await seedBasics(client);
  return { id, email, password, basics };
}

/** Escribe correo y contraseña en la entrada y envía. No espera a dónde lleva: eso lo hace quien llama. */
async function submitCredentials(page: Page, u: Pick<TestUser, "email" | "password">): Promise<void> {
  if (new URL(page.url()).pathname !== "/login") await page.goto("/login");
  await page.getByLabel("Correo").fill(u.email);
  await page.getByLabel("Contraseña").fill(u.password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/**
 * Entra por la pantalla de entrada con un usuario SIN segundo factor y espera a estar dentro.
 * Si la página ya está en `/login` (p. ej. con `?siguiente=…`), entra desde ahí sin volver a cargarla.
 */
export async function login(page: Page, u: Pick<TestUser, "email" | "password">): Promise<void> {
  await submitCredentials(page, u);
  await expect(page).not.toHaveURL(/\/login/);
}

/** Entra con un usuario que tiene segundo factor: correo y contraseña, y después el código de `secret`. */
export async function loginWithTotp(
  page: Page,
  u: Pick<TestUser, "email" | "password">,
  secret: string,
): Promise<void> {
  await submitCredentials(page, u);
  await expect(page).toHaveURL(/\/login\/verificar/);
  await page.getByLabel("Código").fill(totp(secret));
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
