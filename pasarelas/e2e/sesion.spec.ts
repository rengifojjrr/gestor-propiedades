import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { enrollTotp, signInAal1, totp } from "../tests/integration/helpers";
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

/** Un corte en el que repetir es seguro (entrar, el código, empezar el alta de un dispositivo). */
const RETRY_TEXT = "Se perdió la conexión. Revisa tu señal y vuelve a intentarlo.";
/** La duda de un corte: no se sabe si se guardó. Al lado va «Ver cómo quedó». */
const UNSURE_TEXT = "Se perdió la conexión y no se sabe si se guardó. Revisa cómo quedó antes de repetirlo.";
const PASSWORD_UNSURE_TEXT =
  "Se perdió la conexión y no se sabe si se cambió la contraseña. Vuelve a intentarlo: si te dice que la actual no es correcta, es que ya se cambió y vale la nueva.";
/** El título de `global-error.tsx`, que reemplaza la página entera. */
const GLOBAL_ERROR = "Algo salió mal";

/**
 * Corta la red a las Server Actions de una pantalla: los POST a `pathname`, y solo a esa ruta (`/login` no corta
 * `/login/verificar`). Con `arrives`, la llamada llega al servidor y lo que se pierde es la respuesta. Devuelve cómo
 * volver a tener señal.
 */
async function cutActions(page: Page, pathname: string, { arrives = false } = {}): Promise<() => Promise<void>> {
  const here = (url: URL) => url.pathname === pathname;
  await page.route(here, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    if (arrives) await route.fetch();
    return route.abort("internetdisconnected");
  });
  return () => page.unroute(here);
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

  // La app comprueba la actual por su cuenta: no depende de `require_current_password` en la configuración de Auth.
  test("cambiar la contraseña exige la actual", async ({ page }) => {
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
    const everywhere = page.getByRole("button", { name: "Cerrar sesión en todos los dispositivos" });
    await expect(everywhere).toHaveAccessibleDescription(
      "Los demás dispositivos pierden el acceso a tus datos de inmediato, aunque una pantalla que ya esté abierta puede tardar en notarlo.",
    );
    await everywhere.click();
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

/*
 * Sin señal, la llamada a la acción no llega o su respuesta no vuelve. Se dice en la misma pantalla (no en
 * `global-error.tsx` ni en el error de Ajustes) y no se pierde lo escrito. Si repetir es seguro, se invita a
 * repetir; si no se sabe si quedó, se ofrece «Ver cómo quedó».
 */
test.describe("cortes de red", () => {
  test("entrar: se dice en la misma pantalla con el correo escrito, y al volver la señal se entra", async ({ page }) => {
    const user = await newUser();
    await page.goto("/login");
    const reconnect = await cutActions(page, "/login");
    await page.getByLabel("Correo").fill(user.email);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: RETRY_TEXT })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
    await expect(page.getByText(GLOBAL_ERROR)).toHaveCount(0);
    expect(pathOf(page)).toBe("/login");
    await expect(page.getByLabel("Correo")).toHaveValue(user.email);
    await expect(page.getByLabel("Contraseña")).toHaveValue("");
    await expectNoSeriousAxe(page);

    await reconnect();
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/pasarelas$/);
  });

  test("el código: se dice en la misma pantalla; cerrar sesión ofrece «Ver cómo quedó»; al volver la señal se entra", async ({
    page,
  }) => {
    const user = await newUser();
    const { secret } = await enrollTotp(await signInAal1(user.email, user.password));
    await page.goto("/login");
    await page.getByLabel("Correo").fill(user.email);
    await page.getByLabel("Contraseña").fill(user.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/login\/verificar$/);

    const reconnect = await cutActions(page, "/login/verificar");
    await page.getByLabel("Código").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: RETRY_TEXT })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Código de verificación" })).toBeVisible();
    await expect(page.getByText(GLOBAL_ERROR)).toHaveCount(0);
    await expectNoSeriousAxe(page);

    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: UNSURE_TEXT })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver cómo quedó" })).toBeVisible();
    expect(pathOf(page)).toBe("/login/verificar");
    await expectNoSeriousAxe(page);

    // No había llegado: «Ver cómo quedó» enseña la misma pantalla, que sigue pidiendo el código.
    await reconnect();
    await page.getByRole("button", { name: "Ver cómo quedó" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Código de verificación" })).toBeVisible();
    await page.getByLabel("Código").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar" }).click();
    await expect(page).toHaveURL(/\/pasarelas$/);
  });

  test("Seguridad, activar: un corte al empezar invita a repetir (y repetir no deja restos); uno al confirmar, a «Ver cómo quedó»", async ({
    page,
  }) => {
    const user = await newUser();
    await login(page, user);
    await openSettings(page);

    // Empezar sí llega al servidor (deja un dispositivo sin verificar), pero la respuesta se pierde.
    let reconnect = await cutActions(page, "/ajustes", { arrives: true });
    await page.getByRole("button", { name: "Activar segundo factor" }).click();
    await expect(page.getByRole("alert").filter({ hasText: RETRY_TEXT })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver cómo quedó" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
    await expectNoSeriousAxe(page);

    await reconnect();
    await page.getByRole("button", { name: "Activar segundo factor" }).click();
    const secret = (await page.getByTestId("clave-totp").innerText()).replace(/\s/g, "");

    // Confirmar no llega: no se sabe si quedó.
    reconnect = await cutActions(page, "/ajustes");
    await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar y activar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: UNSURE_TEXT })).toBeVisible();
    await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible();
    await expectNoSeriousAxe(page);

    // «Ver cómo quedó» enseña que no se activó: el alta sigue pidiendo el código, y con él se activa.
    await reconnect();
    await page.getByRole("button", { name: "Ver cómo quedó" }).click();
    await expect(page.getByText(BANNER)).toBeVisible();
    await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar y activar" }).click();
    await expect(page.getByText("Segundo factor activado")).toBeVisible();
    // Uno solo, con su nombre: el intento cortado no dejó un «Autenticador 2».
    await expect(page.getByRole("listitem").filter({ hasText: "Autenticador" })).toHaveCount(1);
    await expect(page.getByText("Autenticador 2")).toHaveCount(0);
  });

  // «Cancelar» con la duda en pantalla también vuelve a pintar la lista, como al cerrar un diálogo con la duda.
  for (const close of ["Ver cómo quedó", "Cancelar"]) {
    test(`Seguridad, activar otro: si se pierde la respuesta al confirmar, «${close}» lo enseña activo y el alta no sigue pidiendo el código`, async ({
      page,
    }) => {
      const user = await newUser();
      const { secret } = await enrollTotp(await signInAal1(user.email, user.password));
      await loginWithTotp(page, user, secret);
      await openSettings(page);
      await page.getByRole("button", { name: "Agregar otro dispositivo" }).click();
      const second = (await page.getByTestId("clave-totp").innerText()).replace(/\s/g, "");

      const reconnect = await cutActions(page, "/ajustes", { arrives: true });
      await page.getByLabel("Código de 6 dígitos").fill(totp(second));
      await page.getByRole("button", { name: "Verificar y activar" }).click();
      await expect(page.getByRole("alert").filter({ hasText: UNSURE_TEXT })).toBeVisible();
      await expect(page.getByRole("listitem").filter({ hasText: "Autenticador" })).toHaveCount(0);
      await expectNoSeriousAxe(page);

      await reconnect();
      await page.getByRole("button", { name: close, exact: true }).click();
      await expect(page.getByRole("listitem").filter({ hasText: "Autenticador" })).toBeVisible();
      // Ya está activo: el alta no se queda pidiendo un código que ya no hace falta.
      await expect(page.getByLabel("Código de 6 dígitos")).toHaveCount(0);
      await expect(page.getByTestId("clave-totp")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Agregar otro dispositivo" })).toBeVisible();
    });
  }

  test("Seguridad, activar el primero: si «Ver cómo quedó» lo enseña activo, el alta terminó y quitarlo no la hace volver", async ({
    page,
  }) => {
    const user = await newUser();
    await login(page, user);
    await openSettings(page);
    await page.getByRole("button", { name: "Activar segundo factor" }).click();
    const secret = (await page.getByTestId("clave-totp").innerText()).replace(/\s/g, "");

    // Confirmar llega (el dispositivo queda activo), pero la respuesta se pierde.
    const reconnect = await cutActions(page, "/ajustes", { arrives: true });
    await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar y activar" }).click();
    await expect(page.getByRole("alert").filter({ hasText: UNSURE_TEXT })).toBeVisible();
    await expectNoSeriousAxe(page);

    await reconnect();
    await page.getByRole("button", { name: "Ver cómo quedó" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Autenticador" })).toBeVisible();
    await expect(page.getByLabel("Código de 6 dígitos")).toHaveCount(0);

    // Por las dudas (¿guardó bien la clave la app tras el corte?), lo quita sin recargar. Es el único: la cuenta vuelve
    // a abrirse solo con la contraseña y la pantalla sigue en Ajustes. No vuelven el QR, la clave, el código ni la duda
    // de un dispositivo que ya no existe: se puede empezar de nuevo.
    await page.getByRole("button", { name: "Quitar Autenticador" }).click();
    await page
      .getByRole("alertdialog", { name: "¿Quitar «Autenticador»?" })
      .getByRole("button", { name: "Quitar", exact: true })
      .click();
    await expect(page.getByText("Dispositivo quitado")).toBeVisible();
    await expect(page.getByText(BANNER)).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "Autenticador" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Activar segundo factor" })).toBeVisible();
    await expect(page.getByLabel("Código de 6 dígitos")).toHaveCount(0);
    await expect(page.getByTestId("clave-totp")).toHaveCount(0);
    await expect(page.getByRole("alert").filter({ hasText: UNSURE_TEXT })).toHaveCount(0);
  });

  test("Seguridad, quitar: si se pierde la respuesta, se dice en la tarjeta y «Ver cómo quedó» enseña que ya no está", async ({
    page,
  }) => {
    const user = await newUser();
    const { secret } = await enrollTotp(await signInAal1(user.email, user.password));
    await loginWithTotp(page, user, secret);
    await openSettings(page);
    const quitar = page.getByRole("button", { name: /^Quitar Prueba / });
    const dialog = page.getByRole("alertdialog");
    // El botón lo maneja un componente de cliente: se reintenta hasta que la página esté lista.
    await expect(async () => {
      await quitar.click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass();

    const reconnect = await cutActions(page, "/ajustes", { arrives: true });
    await dialog.getByRole("button", { name: "Quitar", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: UNSURE_TEXT })).toBeVisible();
    await expect(dialog).toBeHidden();
    // Nada se refresca solo: la tarjeta todavía lo enseña.
    await expect(quitar).toBeVisible();
    await expectNoSeriousAxe(page);

    await reconnect();
    await page.getByRole("button", { name: "Ver cómo quedó" }).click();
    await expect(quitar).toHaveCount(0);
    await expect(page.getByText(BANNER)).toBeVisible();
  });

  test("Seguridad, contraseña: un corte dice cómo saber si cambió, y lo escrito se queda", async ({ page }) => {
    const user = await newUser();
    const nueva = `Nueva-${randomUUID()}`;
    await login(page, user);
    await openSettings(page);
    const { actual, primera, repetida, cambiar } = passwordForm(page);
    await actual.fill(user.password);
    await primera.fill(nueva);
    await repetida.fill(nueva);

    const reconnect = await cutActions(page, "/ajustes", { arrives: true });
    await cambiar.click();
    await expect(page.getByRole("alert").filter({ hasText: PASSWORD_UNSURE_TEXT })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ver cómo quedó" })).toHaveCount(0);
    await expect(actual).toHaveValue(user.password);
    await expect(primera).toHaveValue(nueva);
    await expect(repetida).toHaveValue(nueva);
    await expectNoSeriousAxe(page);

    // Sí había llegado: al repetir, la de antes ya no es la actual, que es lo que el aviso dice que pasaría.
    await reconnect();
    await cambiar.click();
    await expect(page.getByText("La contraseña actual no es correcta.")).toBeVisible();
  });

  test("Seguridad, cerrar sesión: un corte ofrece «Ver cómo quedó», que lleva a la entrada si sí se cerró", async ({
    page,
  }) => {
    const user = await newUser();
    await login(page, user);
    await openSettings(page);

    const reconnect = await cutActions(page, "/ajustes", { arrives: true });
    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: UNSURE_TEXT })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
    await expectNoSeriousAxe(page);

    await reconnect();
    await page.getByRole("button", { name: "Ver cómo quedó" }).click();
    await expect(page).toHaveURL(/\/login\?siguiente=%2Fajustes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
    await login(page, user);
    await expect(page).toHaveURL(/\/ajustes$/);
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
      // Solo este sitio: la app no decide por los subdominios del dueño ni lo inscribe en la lista de precarga.
      expect(headers["strict-transport-security"], path).toBe("max-age=63072000");
      expect(headers["x-powered-by"], path).toBeUndefined();
    }
  });
});
