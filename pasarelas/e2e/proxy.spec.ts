import { expect, test } from "@playwright/test";
import { login, newUser, type TestUser } from "./helpers";

/**
 * El proxy (`src/lib/supabase/proxy.ts`), que corre en cada petición: con sesión, abrir la entrada con
 * `?siguiente=` lleva a esa ruta (si es de este sitio), no siempre al Resumen.
 */

let user: TestUser;

test.beforeAll(async () => {
  user = await newUser();
});

test("con sesión, /login?siguiente=<ruta> lleva a esa ruta; una que no es de este sitio, al Resumen", async ({
  page,
}) => {
  await login(page, user);

  await page.goto(`/login?siguiente=${encodeURIComponent("/pasarelas/cuentas?x=1")}`);
  await expect(page).toHaveURL(/\/pasarelas\/cuentas\?x=1$/);
  await expect(page.getByRole("heading", { level: 1, name: "Cuentas destino" })).toBeVisible();

  await page.goto(`/login?siguiente=${encodeURIComponent("//otro.example/pasarelas")}`);
  await expect(page).toHaveURL(/\/pasarelas$/);
  expect(new URL(page.url()).hostname).toBe("127.0.0.1");

  await page.goto("/login");
  await expect(page).toHaveURL(/\/pasarelas$/);
});
