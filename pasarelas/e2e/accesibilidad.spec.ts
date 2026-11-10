import { expect, test, type Page } from "@playwright/test";
import { todayNY } from "../src/lib/pasarelas/dates";
import { createUser, enrollTotp, signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow, expectNoSeriousAxe } from "./axe";
import { login } from "./helpers";
import { demoData, serverData } from "./server-data";

/**
 * Accesibilidad de todas las pantallas (spec §8, más la entrada, el código y Ajustes), con el libro de la semilla
 * demo, en claro y en oscuro y en los dos tamaños del proyecto (celular 390×844 y escritorio 1280×800): sin
 * violaciones serias ni críticas de axe, sin desbordamiento horizontal, con objetivos táctiles de al menos 44 px y,
 * en el celular, sin tablas a la vista que se corten por la derecha.
 */

type Credentials = { email: string; password: string };

/** Los registros de la semilla que tienen pantalla propia. */
type Ids = {
  tx: string;
  company: { id: string; name: string };
  gateway: { id: string; name: string };
  scheme: { id: string; name: string };
  beneficiary: { id: string; name: string };
};

type Screen = { name: string; path: (ids: Ids) => string; heading: (ids: Ids) => string | RegExp };

const SCREENS: Screen[] = [
  { name: "Resumen", path: () => "/pasarelas", heading: () => "Resumen" },
  { name: "Registrar cobro", path: () => "/pasarelas/registrar", heading: () => "Registrar cobro" },
  { name: "Cobros", path: () => "/pasarelas/cobros", heading: () => "Cobros" },
  { name: "Detalle del cobro", path: (ids) => `/pasarelas/cobros/${ids.tx}`, heading: () => /^Cobro de / },
  { name: "Editar cobro", path: (ids) => `/pasarelas/cobros/${ids.tx}/editar`, heading: () => "Editar cobro" },
  { name: "Papelera", path: () => "/pasarelas/papelera", heading: () => "Papelera" },
  { name: "Empresas", path: () => "/pasarelas/empresas", heading: () => "Empresas" },
  { name: "Nueva empresa", path: () => "/pasarelas/empresas/nueva", heading: () => "Nueva empresa" },
  { name: "Empresa", path: (ids) => `/pasarelas/empresas/${ids.company.id}`, heading: (ids) => ids.company.name },
  { name: "Pasarelas", path: () => "/pasarelas/pasarelas", heading: () => "Pasarelas" },
  { name: "Agregar pasarela", path: () => "/pasarelas/pasarelas/nueva", heading: () => "Agregar pasarela" },
  { name: "Pasarela", path: (ids) => `/pasarelas/pasarelas/${ids.gateway.id}`, heading: (ids) => ids.gateway.name },
  { name: "Repartos", path: () => "/pasarelas/repartos", heading: () => "Repartos" },
  { name: "Nuevo esquema", path: () => "/pasarelas/repartos/esquemas/nuevo", heading: () => "Nuevo esquema" },
  {
    name: "Esquema",
    path: (ids) => `/pasarelas/repartos/esquemas/${ids.scheme.id}`,
    heading: (ids) => ids.scheme.name,
  },
  {
    name: "Beneficiario",
    path: (ids) => `/pasarelas/repartos/beneficiarios/${ids.beneficiary.id}`,
    heading: (ids) => ids.beneficiary.name,
  },
  { name: "Cuentas destino", path: () => "/pasarelas/cuentas", heading: () => "Cuentas destino" },
  { name: "Feriados", path: () => "/pasarelas/feriados", heading: () => "Feriados" },
  { name: "Importar CSV", path: () => "/pasarelas/importar", heading: () => "Importar CSV" },
  { name: "Ajustes", path: () => "/ajustes", heading: () => "Ajustes" },
];

/** El dueño del libro demo (sin segundo factor) y uno con segundo factor, para la pantalla del código. */
let owner: Credentials;
let withFactor: Credentials;
let ids: Ids;

/** El registro de esa tabla con ese nombre: la semilla los nombra a todos. */
async function named(
  client: Db,
  table: "pay_companies" | "pay_gateways" | "pay_schemes" | "pay_beneficiaries",
  name: string,
): Promise<{ id: string; name: string }> {
  return unwrap(await client.from(table).select("id, name").eq("name", name).single(), `${table} «${name}»`);
}

test.beforeAll(async () => {
  const user = await createUser();
  owner = user;
  await demoData().seedDemo(user.client, { today: todayNY(new Date()) });

  // El detalle y la edición: el cobro más reciente con reparto. La papelera, con el más viejo dentro.
  const [recent] = unwrap(
    await user.client
      .from("pay_transactions")
      .select("id")
      .not("scheme_id", "is", null)
      .neq("status", "fallido")
      .order("occurred_at", { ascending: false })
      .limit(1),
    "el cobro más reciente con reparto",
  );
  const [oldest] = unwrap(
    await user.client.from("pay_transactions").select("id").order("occurred_at").limit(1),
    "el cobro más viejo",
  );
  if (!recent || !oldest) throw new Error("La semilla no dejó cobros");
  expect(await serverData().trashTx(user.client, [oldest.id])).toBe(1);

  ids = {
    tx: recent.id,
    company: await named(user.client, "pay_companies", "Tienda Demo"),
    gateway: await named(user.client, "pay_gateways", "Stripe"),
    scheme: await named(user.client, "pay_schemes", "Reparto 50/30/20"),
    beneficiary: await named(user.client, "pay_beneficiaries", "Grupo A"),
  };

  const other = await createUser();
  await enrollTotp(await signInAal1(other.email, other.password));
  withFactor = other;
});

/** Espera a que los avisos pasajeros queden quietos: a medio animar, axe mide su texto translúcido como contraste. */
async function waitForStillToasts(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return animation.playState !== "running" || !(target instanceof Element && target.closest("[data-sonner-toaster]"));
    }),
  );
}

/** Los controles visibles que miden menos de 44 px de alto o de ancho (la misma medida que la galería del kit). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector =
      "button, select, textarea, a[href], summary, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), label:has(input[type=checkbox])";
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => el.getClientRects().length > 0 && !el.closest("[data-sonner-toaster], .sr-only"))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 43.5 || box.width < 43.5)
      .map(
        ({ el, box }) =>
          `${el.tagName.toLowerCase()} «${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}» ${Math.round(box.width)}×${Math.round(box.height)}`,
      );
  });
}

/**
 * Las tablas a la vista que no caben a lo ancho. La tabla del kit se desplaza ella y no la página, así que la
 * página no desborda, pero en el celular las columnas de la derecha (las cifras) quedan fuera de la vista. Las que
 * están dentro de un desplegable cerrado (los datos de cada gráfico, que se abren a pedido) no cuentan.
 */
async function clippedTables(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[role=region]:has(> table)")]
      .filter((region) => region.checkVisibility() && region.scrollWidth > region.clientWidth + 1)
      .map((region) => `«${region.getAttribute("aria-label")}» mide ${region.scrollWidth} px en ${region.clientWidth} px`),
  );
}

/** Lo que se exige en cada pantalla: objetivos de 44 px, tablas que caben, nada que se salga de lado y axe limpio. */
async function expectAccessible(page: Page): Promise<void> {
  await waitForStillToasts(page);
  const small = await smallTargets(page);
  expect(small, `Controles de menos de 44 px en ${page.url()}:\n${small.join("\n")}`).toEqual([]);
  if ((page.viewportSize()?.width ?? 0) < 768) {
    const clipped = await clippedTables(page);
    expect(clipped, `Tablas que no caben en el celular en ${page.url()}:\n${clipped.join("\n")}`).toEqual([]);
  }
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

for (const scheme of ["light", "dark"] as const) {
  const mode = scheme === "light" ? "claro" : "oscuro";

  test.describe(`en modo ${mode}`, () => {
    test.use({ colorScheme: scheme });

    test("Entrar", async ({ page }) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { level: 1, name: "Entrar" })).toBeVisible();
      await expectAccessible(page);
    });

    test("Código de verificación", async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Correo").fill(withFactor.email);
      await page.getByLabel("Contraseña").fill(withFactor.password);
      await page.getByRole("button", { name: "Entrar" }).click();
      await expect(page).toHaveURL(/\/login\/verificar$/);
      await expect(page.getByRole("heading", { level: 1, name: "Código de verificación" })).toBeVisible();
      await expectAccessible(page);
    });

    for (const screen of SCREENS) {
      test(screen.name, async ({ page }) => {
        await login(page, owner);
        await page.goto(screen.path(ids));
        await expect(page.getByRole("heading", { level: 1, name: screen.heading(ids) })).toBeVisible();
        await expectAccessible(page);
      });
    }
  });
}
