import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createUser, totp } from "../tests/integration/helpers";
import { expectNoSeriousAxe, login, loginWithTotp, newUser, type TestUser } from "./helpers";

/**
 * Entrada, segundo factor y Ajustes → Seguridad, en el celular (390×844) y contra usuarios reales del stack local.
 */
test.skip(({ isMobile }) => !isMobile, "La sesión se prueba en el celular (390×844)");

const BANNER = "Activa el segundo factor";
const BAD_CREDENTIALS = "Correo o contraseña incorrectos.";

const pathOf = (page: Page) => new URL(page.url()).pathname;

/** Un código de 6 dígitos que seguro no vale: ni el de ahora ni los de las ventanas vecinas. */
function wrongCode(secret: string): string {
  const now = Date.now();
  const valid = new Set([-30_000, 0, 30_000].map((shift) => totp(secret, now + shift)));
  return ["000000", "111111", "222222", "333333"].find((code) => !valid.has(code)) ?? "444444";
}

/** Junta lo que el navegador bloquee por la política de contenido (CSP): tiene que quedar vacío. */
function watchCsp(page: Page): string[] {
  const blocked: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) blocked.push(message.text());
  });
  return blocked;
}

async function openSettings(page: Page): Promise<void> {
  await page.goto("/ajustes");
  await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
}

async function signOutHere(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe("entrada", () => {
  let user: TestUser;

  test.beforeAll(async () => {
    user = await newUser();
  });

  test("sin sesión, /pasarelas manda a /login, y la entrada no ofrece registro", async ({ page }) => {
    const blocked = watchCsp(page);
    await page.goto("/pasarelas");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
    await expect(page.getByLabel("Correo")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
    await expect(page.getByRole("link", { name: /regístrate|registrarse|crear cuenta/i })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expectNoSeriousAxe(page);
    expect(blocked).toEqual([]);
  });

  test("sin sesión, una pantalla de adentro manda a /login recordando a dónde se iba", async ({ page }) => {
    await page.goto("/pasarelas/cobros?estado=depositado");
    await expect(page).toHaveURL(/\/login\?siguiente=%2Fpasarelas%2Fcobros%3Festado%3Ddepositado$/);

    await page.goto("/ajustes");
    await expect(page).toHaveURL(/\/login\?siguiente=%2Fajustes$/);
    await login(page, user);
    await expect(page).toHaveURL(/\/ajustes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
  });

  test("con credenciales malas dice lo mismo, sea el correo o la contraseña", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Correo").fill(user.email);
    await page.getByLabel("Contraseña").fill("no-es-la-clave");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: BAD_CREDENTIALS })).toBeVisible();
    expect(pathOf(page)).toBe("/login");
    await expect(page.getByLabel("Correo")).toHaveValue(user.email);
    await expect(page.getByLabel("Contraseña")).toHaveValue("");
    await expectNoSeriousAxe(page);

    await page.getByLabel("Correo").fill(`nadie-${randomUUID()}@example.com`);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: BAD_CREDENTIALS })).toBeVisible();

    // Sigue fuera.
    await page.goto("/pasarelas");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("entrar lleva al Resumen y avisa que falta el segundo factor", async ({ page }) => {
    await login(page, user);
    await expect(page).toHaveURL(/\/pasarelas$/);
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
    await expect(page.getByText(BANNER)).toBeVisible();
    await expectNoSeriousAxe(page);

    // Con sesión, la entrada ya no tiene sentido: manda al Resumen. Y sin factor no hay código que pedir.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/pasarelas$/);
    await page.goto("/login/verificar");
    await expect(page).toHaveURL(/\/pasarelas$/);
  });

  for (const outside of [
    "//evil.example",
    "https://evil.example/pasarelas",
    "/\\evil.example",
    "/..//evil.example",
    "javascript:alert(1)",
  ]) {
    test(`?siguiente=${outside} no saca del sitio`, async ({ page, baseURL }) => {
      await page.goto(`/login?siguiente=${encodeURIComponent(outside)}`);
      await login(page, user);
      await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
      expect(page.url()).toBe(`${baseURL}/pasarelas`);
    });
  }

  test("/login/verificar sin sesión manda a la entrada", async ({ page }) => {
    await page.goto("/login/verificar");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("segundo factor", () => {
  test.describe.configure({ mode: "serial" });

  let user: TestUser;
  let secret: string;

  test.beforeAll(async () => {
    user = await newUser();
  });

  test("se activa en Ajustes con el QR o la clave, y el aviso desaparece", async ({ page }) => {
    const blocked = watchCsp(page);
    await login(page, user);
    await openSettings(page);
    await expect(page.getByText(BANNER)).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.getByRole("button", { name: "Activar segundo factor" }).click();
    const qr = page.getByRole("img", { name: "Código QR para tu app de autenticación" });
    await expect(qr).toBeVisible();
    // La imagen cargó de verdad: la política de contenido deja pintar el QR (`data:`).
    await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    secret = (await page.getByTestId("clave-totp").innerText()).replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    await expectNoSeriousAxe(page);

    await page.getByLabel("Código de 6 dígitos").fill(wrongCode(secret));
    await page.getByRole("button", { name: "Verificar y activar" }).click();
    await expect(page.getByText("Ese código no es correcto")).toBeVisible();
    await expect(page.getByText(BANNER)).toBeVisible();

    await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar y activar" }).click();
    await expect(page.getByText("Segundo factor activado")).toBeVisible();
    await expect(page.getByText(BANNER)).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Autenticador" })).toBeVisible();
    await expect(qr).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Agregar otro dispositivo" })).toBeVisible();
    expect(blocked).toEqual([]);

    await signOutHere(page);
    await page.goto("/pasarelas");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("al volver a entrar pide el código, y sin él no se pasa", async ({ page }) => {
    await page.goto("/login?siguiente=%2Fajustes");
    await page.getByLabel("Correo").fill(user.email);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/login\/verificar\?siguiente=%2Fajustes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Código de verificación" })).toBeVisible();
    await expectNoSeriousAxe(page);

    // Con la contraseña sola no se entra a ninguna pantalla.
    await page.goto("/pasarelas");
    await expect(page).toHaveURL(/\/login\/verificar$/);
    await page.goto("/ajustes");
    await expect(page).toHaveURL(/\/login\/verificar$/);

    await page.goto("/login/verificar?siguiente=%2Fajustes");
    await page.getByLabel("Código").fill(wrongCode(secret));
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Ese código no es correcto" })).toBeVisible();
    expect(pathOf(page)).toBe("/login/verificar");

    await page.getByLabel("Código").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page).toHaveURL(/\/ajustes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
    await expect(page.getByText(BANNER)).toHaveCount(0);
  });

  test("desde el código se puede salir para entrar con otra cuenta", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Correo").fill(user.email);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/login\/verificar$/);
    await signOutHere(page);
    await page.goto("/pasarelas");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("un segundo dispositivo también sirve para entrar, y al quitarlo queda el primero", async ({ page }) => {
    await loginWithTotp(page, user, secret);
    await openSettings(page);
    await page.getByRole("button", { name: "Agregar otro dispositivo" }).click();
    const second = (await page.getByTestId("clave-totp").innerText()).replace(/\s/g, "");
    expect(second).not.toBe(secret);
    await page.getByLabel("Código de 6 dígitos").fill(totp(second));
    await page.getByRole("button", { name: "Verificar y activar" }).click();
    await expect(page.getByText("Segundo factor activado")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Autenticador 2" })).toBeVisible();

    // El código del segundo dispositivo vale para entrar, sin tener que decir de cuál es.
    await signOutHere(page);
    await loginWithTotp(page, user, second);
    await expect(page).toHaveURL(/\/pasarelas$/);

    // Quitar el dispositivo con el que se entró deja la sesión sin su código: pide el del que queda.
    await openSettings(page);
    const dialog = page.getByRole("alertdialog", { name: "¿Quitar «Autenticador 2»?" });
    await expect(async () => {
      await page.getByRole("button", { name: "Quitar Autenticador 2" }).click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(dialog).toContainText("se te pedirá el de otro");
    await dialog.getByRole("button", { name: "Quitar", exact: true }).click();
    await expect(page).toHaveURL(/\/login\/verificar$/);
    await page.getByLabel("Código").fill(totp(second));
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Ese código no es correcto" })).toBeVisible();
    await page.getByLabel("Código").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page).toHaveURL(/\/pasarelas$/);

    // Queda el primero, y el aviso no vuelve.
    await openSettings(page);
    await expect(page.getByRole("listitem").filter({ hasText: "Autenticador" })).toHaveCount(1);
    await expect(page.getByText("Autenticador 2")).toHaveCount(0);
    await expect(page.getByText(BANNER)).toHaveCount(0);
  });

  test("se quita desde Ajustes, y el aviso vuelve", async ({ page }) => {
    await loginWithTotp(page, user, secret);
    await expect(page).toHaveURL(/\/pasarelas$/);
    await openSettings(page);

    const dialog = page.getByRole("alertdialog", { name: "¿Quitar «Autenticador»?" });
    // El botón lo maneja un componente de cliente: se reintenta hasta que la página esté lista.
    await expect(async () => {
      await page.getByRole("button", { name: "Quitar Autenticador" }).click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expectNoSeriousAxe(page);
    await dialog.getByRole("button", { name: "Quitar", exact: true }).click();
    await expect(page.getByText("Dispositivo quitado")).toBeVisible();
    await expect(page.getByText(BANNER)).toBeVisible();
    await expect(page.getByRole("button", { name: "Activar segundo factor" })).toBeVisible();

    // Sin factor, la sesión sigue valiendo y la próxima entrada ya no pide código.
    await page.goto("/pasarelas");
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
    await openSettings(page);
    await signOutHere(page);
    await login(page, user);
    await expect(page).toHaveURL(/\/pasarelas$/);
  });
});

/**
 * ¿Auth exige la contraseña actual para cambiarla (`require_current_password` en `supabase/config.toml`)? El ajuste
 * no surte efecto hasta reiniciar el stack, y el stack local es compartido: una prueba no lo reinicia. Se le
 * pregunta a Auth con un usuario de usar y tirar: sin la contraseña actual, o rechaza el cambio o lo hace.
 */
async function stackRequiresCurrentPassword(): Promise<boolean> {
  const { client } = await createUser();
  const { error } = await client.auth.updateUser({ password: `Sonda-${randomUUID()}` });
  if (!error) return false;
  if (error.code === "current_password_required") return true;
  throw new Error(`No se pudo saber si el stack exige la contraseña actual: ${error.code ?? error.message}`);
}

function passwordForm(page: Page) {
  return {
    actual: page.getByLabel("Contraseña actual"),
    primera: page.getByLabel("Contraseña nueva", { exact: true }),
    repetida: page.getByLabel("Repite la contraseña nueva"),
    cambiar: page.getByRole("button", { name: "Cambiar contraseña" }),
  };
}

test.describe("contraseña y sesión", () => {
  test("cambiar la contraseña: avisa por campo, y después solo vale la nueva", async ({ page }) => {
    const user = await newUser();
    const nueva = `Nueva-${randomUUID()}`;
    await login(page, user);
    await openSettings(page);
    const { actual, primera, repetida, cambiar } = passwordForm(page);

    await actual.fill(user.password);
    await primera.fill(nueva);
    await repetida.fill(`${nueva}-otra`);
    await cambiar.click();
    await expect(page.getByText("Las dos contraseñas nuevas no coinciden.")).toBeVisible();
    // Lo escrito se queda: no hay que volver a escribir las tres por un error en una.
    await expect(actual).toHaveValue(user.password);
    await expect(primera).toHaveValue(nueva);
    await expectNoSeriousAxe(page);

    await actual.fill(user.password);
    await primera.fill(user.password);
    await repetida.fill(user.password);
    await cambiar.click();
    await expect(page.getByText("La contraseña nueva tiene que ser distinta de la actual.")).toBeVisible();

    await actual.fill(user.password);
    await primera.fill(nueva);
    await repetida.fill(nueva);
    await cambiar.click();
    await expect(page.getByText("Contraseña cambiada")).toBeVisible();
    await expect(actual).toHaveValue("");

    await signOutHere(page);
    await page.getByLabel("Correo").fill(user.email);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: BAD_CREDENTIALS })).toBeVisible();
    await login(page, { email: user.email, password: nueva });
    await expect(page).toHaveURL(/\/pasarelas$/);
  });

  test("cambiar la contraseña exige la actual (con require_current_password activo en el stack)", async ({ page }) => {
    test.skip(
      !(await stackRequiresCurrentPassword()),
      "Pendiente de configuración: el stack local arrancó sin `require_current_password` (supabase/config.toml). " +
        "Corre de nuevo tras reiniciarlo (`npm run db:stop` y `npm run db:start`) cuando nadie más lo esté usando.",
    );
    const user = await newUser();
    const nueva = `Nueva-${randomUUID()}`;
    await login(page, user);
    await openSettings(page);
    const { actual, primera, repetida, cambiar } = passwordForm(page);

    await actual.fill("no-es-la-actual");
    await primera.fill(nueva);
    await repetida.fill(nueva);
    await cambiar.click();
    await expect(page.getByText("La contraseña actual no es correcta.")).toBeVisible();
    await expect(primera).toHaveValue(nueva);
    await expectNoSeriousAxe(page);

    // No se cambió: la nueva no abre la cuenta y la de antes sí.
    await signOutHere(page);
    await page.getByLabel("Correo").fill(user.email);
    await page.getByLabel("Contraseña").fill(nueva);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: BAD_CREDENTIALS })).toBeVisible();
    await login(page, user);
    await expect(page).toHaveURL(/\/pasarelas$/);
  });

  test("cerrar sesión en todos los dispositivos saca también al otro", async ({ page, browser, baseURL }) => {
    const user = await newUser();
    const otherContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
    const other = await otherContext.newPage();
    await login(other, user);
    await expect(other.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();

    await login(page, user);
    await openSettings(page);
    await page.getByRole("button", { name: "Cerrar sesión en todos los dispositivos" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/pasarelas");
    await expect(page).toHaveURL(/\/login$/);

    // En el otro dispositivo la sesión ya no existe: no entra a nada y se le dice que vuelva a entrar.
    await other.goto("/pasarelas");
    await expect(other.getByRole("heading", { level: 1, name: "Tu sesión se cerró" })).toBeVisible();
    await expectNoSeriousAxe(other);
    await other.getByRole("button", { name: "Volver a entrar" }).click();
    await expect(other).toHaveURL(/\/login$/);
    await login(other, user);
    await expect(other).toHaveURL(/\/pasarelas$/);
    await otherContext.close();
  });
});

test.describe("cabeceras", () => {
  test("toda respuesta lleva la política de contenido y las cabeceras de seguridad", async ({ request }) => {
    const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    for (const path of ["/login", "/pasarelas", "/manifest.webmanifest"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      const csp = headers["content-security-policy"] ?? "";
      expect(csp, path).toContain("default-src 'self'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).toContain("object-src 'none'");
      expect(csp, path).toContain("base-uri 'self'");
      expect(csp, path).toContain("form-action 'self'");
      expect(csp, path).toContain(`connect-src 'self' ${supabaseOrigin}`);
      expect(csp, path).toMatch(new RegExp(`img-src 'self' blob: data: ${supabaseOrigin.replaceAll(".", "\\.")}(;|$)`));
      // Solo el propio sitio y el host de Supabase: ningún otro origen aparece en la política.
      const origins = csp.match(/\b(?:https?|wss?):\/\/[^\s;]+/g) ?? [];
      expect(new Set(origins), path).toEqual(new Set([supabaseOrigin, supabaseOrigin.replace(/^http/, "ws")]));
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
      expect(headers["permissions-policy"], path).toContain("camera=()");
      expect(headers["x-powered-by"], path).toBeUndefined();
    }
  });
});
