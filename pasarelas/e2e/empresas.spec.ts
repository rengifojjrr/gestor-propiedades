import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { todayNY } from "../src/lib/pasarelas/dates";
import { adminClient, e1Item, saveTransactions, signInAal1 } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Empresas: la lista, crear una con su canal y su cuenta de Stripe con links, y la ficha con su resumen. En el
 * celular (390×844) y en escritorio (1280×800), con un usuario real del stack local que ya trae «Escuela Demo».
 */

const URL_TEXT = "El link tiene que empezar por http:// o https:// y no llevar espacios";
const PANEL = "https://dashboard.example.com/tienda-demo";
const CHECKOUT = "https://pagar.example.com/tienda-demo";

const BUCKET = "comprobantes";

const admin = adminClient();

/** Un PNG de verdad, de un solo color, armado en memoria (firma, IHDR, IDAT comprimido e IEND). */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits por canal
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([0x2a, 0x7a, 0x5c], 1 + x * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Las rutas de los archivos de una carpeta del bucket, vistas con la clave secreta. */
async function filesIn(folder: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (error) throw new Error(`No se pudo listar ${folder}: ${error.message}`);
  return data.map((file) => `${folder}/${file.name}`).sort();
}

/**
 * El aviso pasajero que deja una acción, ya del todo visible: mientras entra (se desvanece) su texto todavía no
 * tiene el contraste final y axe lo marcaría.
 */
async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text })).toHaveCSS("opacity", "1");
}

async function expectCleanScreen(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Un enlace externo seguro: va justo a `href`, en otra pestaña y sin darle acceso a esta. */
async function expectExternal(link: Locator, href: string): Promise<void> {
  await expect(link).toHaveAttribute("href", href);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
}

test.describe.serial("empresas", () => {
  let owner: TestUser;
  let tiendaId: string;
  let pageErrors: string[] = [];

  test.beforeAll(async () => {
    owner = await newUser();
  });

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("la lista enseña Escuela Demo y se crea «Tienda Demo»; una web `javascript:` se rechaza con su mensaje", async ({
    page,
  }) => {
    await login(page, owner);
    await page.goto("/pasarelas/empresas");
    await expect(page.getByRole("heading", { level: 1, name: "Empresas" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Escuela Demo/ })).toBeVisible();
    await expectCleanScreen(page);

    await page.getByRole("link", { name: "Nueva empresa" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Nueva empresa" })).toBeVisible();
    await page.getByLabel("Nombre").fill("Tienda Demo");
    await page.getByLabel("Web").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Crear empresa" }).click();
    await expect(page.getByText(URL_TEXT)).toBeVisible();
    await expect(page.getByLabel("Web")).toHaveAttribute("aria-invalid", "true");
    // Lo escrito sigue ahí para corregirlo.
    await expect(page.getByLabel("Nombre")).toHaveValue("Tienda Demo");
    await expectCleanScreen(page);
    const none = await admin.from("pay_companies").select("id").eq("user_id", owner.id).eq("name", "Tienda Demo");
    expect(none.data).toEqual([]);

    await page.getByLabel("Web").fill("https://tienda.example.com");
    await page.getByRole("button", { name: "Crear empresa" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tienda Demo" })).toBeVisible();
    tiendaId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    expect(tiendaId).toMatch(/^[0-9a-f-]{36}$/);
    await expectExternal(page.getByRole("link", { name: /tienda\.example\.com/ }), "https://tienda.example.com");
    // Sin logo, las iniciales.
    await expect(page.getByText("TD", { exact: true })).toBeVisible();
    await expect(page.getByText("Todavía no tiene cobros")).toBeVisible();
    await expectToast(page, "Empresa creada");
    await expectCleanScreen(page);
  });

  test("un canal al 3 % + 0,25", async ({ page }) => {
    await login(page, owner);
    await page.goto(`/pasarelas/empresas/${tiendaId}`);
    await page.getByRole("button", { name: "Agregar canal" }).click();
    const dialog = page.getByRole("dialog", { name: "Agregar canal" });
    await dialog.getByLabel("Nombre").fill("Tienda en línea");
    await dialog.getByLabel("Comisión de la plataforma").fill("3");
    await dialog.getByLabel("Cargo fijo").fill("0,25");
    await expectCleanScreen(page);
    await dialog.getByRole("button", { name: "Guardar canal" }).click();
    await expect(dialog).toBeHidden();

    const channels = page.getByRole("region", { name: "Canales de venta" });
    const channel = channels.getByRole("listitem").filter({ hasText: "Tienda en línea" });
    await expect(channel).toContainText("3 % + $0,25");
    const saved = await admin
      .from("pay_channels")
      .select("name, platform_fee_pct::text, platform_fee_fixed::text")
      .eq("company_id", tiendaId);
    expect(saved.data).toEqual([{ name: "Tienda en línea", platform_fee_pct: "3.0000", platform_fee_fixed: "0.25" }]);
    await expectToast(page, "Canal agregado");
    await expectCleanScreen(page);
  });

  test("su cuenta de Stripe con links: `javascript:alert(1)` se rechaza y los botones abren cada link aparte", async ({
    page,
  }) => {
    await login(page, owner);
    await page.goto(`/pasarelas/empresas/${tiendaId}`);
    await page.getByRole("button", { name: "Agregar pasarela" }).click();
    const dialog = page.getByRole("dialog", { name: "Agregar pasarela" });
    await dialog.getByLabel("Pasarela", { exact: true }).selectOption({ label: "Stripe" });
    await dialog.getByLabel("Link del panel").fill("javascript:alert(1)");
    await dialog.getByLabel("Link de pago").fill(CHECKOUT);
    await dialog.getByLabel("Cuenta destino").selectOption({ label: "Cuenta principal ··4321" });
    await dialog.getByRole("button", { name: "Guardar pasarela" }).click();
    await expect(dialog.getByText(URL_TEXT)).toBeVisible();
    await expect(dialog.getByLabel("Link del panel")).toHaveAttribute("aria-invalid", "true");
    await expectCleanScreen(page);
    const none = await admin.from("pay_company_gateways").select("id").eq("company_id", tiendaId);
    expect(none.data).toEqual([]);

    await dialog.getByLabel("Link del panel").fill(PANEL);
    await dialog.getByRole("button", { name: "Guardar pasarela" }).click();
    await expect(dialog).toBeHidden();

    const gateways = page.getByRole("region", { name: "Pasarelas de la empresa" });
    const stripe = gateways.getByRole("listitem").filter({ hasText: "Stripe" });
    await expectExternal(stripe.getByRole("link", { name: /Abrir panel/ }), PANEL);
    await expectExternal(stripe.getByRole("link", { name: /Abrir link de pago/ }), CHECKOUT);
    await expect(stripe).toContainText("Cuenta principal");
    await expectToast(page, "Pasarela agregada");
    await expectCleanScreen(page);

    // La misma pasarela otra vez en la misma empresa no se ofrece.
    await page.getByRole("button", { name: "Agregar pasarela" }).click();
    await expect(page.getByRole("dialog", { name: "Agregar pasarela" })).toContainText(
      "Ya agregaste todas tus pasarelas",
    );
  });

  test("el logo se sube a la carpeta de la empresa, se ve por su URL firmada y al cambiarlo se borra el anterior", async ({
    page,
  }) => {
    await login(page, owner);
    await page.goto(`/pasarelas/empresas/${tiendaId}`);
    const folder = `${owner.id}/${tiendaId}`;
    // El selector de archivo se habilita cuando la página ya responde (hidratada): antes, elegir no haría nada.
    await expect(page.getByLabel("Subir logo")).toBeEnabled();

    await page
      .getByLabel("Subir logo")
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png(900, 300) });
    const logo = page.getByRole("img", { name: "Logo de Tienda Demo" });
    await expect(logo).toBeVisible();
    const first = await filesIn(folder);
    expect(first).toHaveLength(1);
    // Achicado a 512 px por su lado más largo y recodificado.
    await expect
      .poll(() => logo.evaluate((el: HTMLImageElement) => [el.complete, el.naturalWidth]))
      .toEqual([true, 512]);
    expect(await logo.getAttribute("src")).toContain(`/storage/v1/object/sign/${BUCKET}/${first[0]}`);
    await expect(page.getByText("TD", { exact: true })).toBeHidden();
    await expectToast(page, "Logo guardado");
    await expectCleanScreen(page);

    await page
      .getByLabel("Cambiar logo")
      .setInputFiles({ name: "otro.png", mimeType: "image/png", buffer: png(200, 200) });
    // Queda un solo archivo, el nuevo: el anterior se borró.
    await expect
      .poll(async () => {
        const files = await filesIn(folder);
        return files.length === 1 && files[0] !== first[0];
      })
      .toBe(true);

    // Un PDF no es un logo: se rechaza antes de subir.
    await page
      .getByLabel("Cambiar logo")
      .setInputFiles({ name: "logo.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
    await expect(page.getByText("El logo tiene que ser una imagen JPG, PNG o WebP.")).toBeVisible();
    expect(await filesIn(folder)).toHaveLength(1);

    await page.getByRole("button", { name: "Quitar logo" }).click();
    await expect(page.getByText("TD", { exact: true })).toBeVisible();
    expect(await filesIn(folder)).toEqual([]);
  });

  test("la ficha de Escuela Demo resume lo facturado en el período y en total, y lleva a sus cobros", async ({
    page,
  }) => {
    const client = await signInAal1(owner.email, owner.password);
    const today = todayNY(new Date());
    await saveTransactions(client, [
      e1Item(owner.basics, { occurred_at: `${today}T16:00:00+00:00`, occurred_on: today }),
      e1Item(owner.basics, { occurred_at: "2025-01-15T16:00:00+00:00", occurred_on: "2025-01-15" }),
    ]);

    await login(page, owner);
    await page.goto("/pasarelas/empresas");
    await page.getByRole("link", { name: /Escuela Demo/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Escuela Demo" })).toBeVisible();

    const summary = page.getByRole("region", { name: "Lo facturado" });
    await expect(summary).toContainText("Esta empresa ha facturado $100,00 en el período y $200,00 en total.");
    await expect(summary.getByRole("region", { name: "Por pasarela" })).toContainText("Stripe");
    // Un enlace interno: la lista de cobros filtrada por la empresa, con todo su historial (desde su primer cobro),
    // en la misma pestaña.
    const cobros = page.getByRole("link", { name: "Ver sus cobros" });
    await expect(cobros).toHaveAttribute(
      "href",
      `/pasarelas/cobros?empresa=${owner.basics.companyId}&periodo=personalizado&desde=2025-01-15&hasta=${today}`,
    );
    await expect(cobros).not.toHaveAttribute("target", "_blank");
    await expectCleanScreen(page);

    // El período vive en la URL: en los últimos 30 días solo está el cobro de hoy; en enero de 2025, solo el
    // viejo. Lo de toda la historia no cambia.
    await page.getByLabel("Período").selectOption({ label: "Últimos 30 días" });
    await expect(page).toHaveURL(/periodo=30d/);
    await expect(summary).toContainText("Esta empresa ha facturado $100,00 en el período y $200,00 en total.");
    await page.goto(
      `/pasarelas/empresas/${owner.basics.companyId}?periodo=personalizado&desde=2025-01-01&hasta=2025-01-31`,
    );
    await expect(summary).toContainText("Esta empresa ha facturado $100,00 en el período y $200,00 en total.");
    await expect(summary.getByRole("region", { name: "Por mes" })).toContainText("ene 2025");

    // «Ver sus cobros» no depende del período de la ficha: abre los dos, el de hoy y el de enero de 2025.
    await page.getByRole("link", { name: "Ver sus cobros" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Cobros" })).toBeVisible();
    await expect(page.getByText("Cobros 1–2 de 2")).toBeVisible();
  });

  test("las notas no admiten un número de tarjeta; una empresa con cobros no se borra y una sin cobros sí", async ({
    page,
  }) => {
    await login(page, owner);
    await page.goto(`/pasarelas/empresas/${owner.basics.companyId}`);
    await page.getByRole("button", { name: "Editar ficha" }).click();
    const dialog = page.getByRole("dialog", { name: "Editar ficha" });
    await dialog.getByLabel("Notas").fill("Pagó con 4111 1111 1111 1111");
    await dialog.getByRole("button", { name: "Guardar ficha" }).click();
    await expect(dialog.getByText(/Parece un número de tarjeta/)).toBeVisible();
    await expectCleanScreen(page);
    await dialog.getByLabel("Notas").fill("Inscripciones de otoño");
    await dialog.getByRole("button", { name: "Guardar ficha" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Inscripciones de otoño")).toBeVisible();

    // Escuela Demo ya tiene cobros (la prueba anterior los registró).
    await page.getByRole("button", { name: "Borrar empresa" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Borrar empresa" }).click();
    await expect(page.getByText("Tiene cobros: desactívala en su lugar")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Escuela Demo" })).toBeVisible();

    await page.goto(`/pasarelas/empresas/${tiendaId}`);
    await page.getByRole("button", { name: "Borrar empresa" }).click();
    // La acción misma lleva a la lista (su respuesta es una redirección que ya trae la lista): no vuelve a pintar
    // la ficha borrada, que daría «Esta página no existe», para después ir a la lista.
    const actionResponses: { redirect: string | null; body: string }[] = [];
    await page.route(`**/pasarelas/empresas/${tiendaId}`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      const body = await response.text();
      actionResponses.push({ redirect: response.headers()["x-action-redirect"] ?? null, body });
      return route.fulfill({ response, body });
    });
    await page.getByRole("alertdialog").getByRole("button", { name: "Borrar empresa" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Empresas" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Tienda Demo/ })).toHaveCount(0);
    expect(actionResponses).toHaveLength(1);
    expect(actionResponses[0]?.redirect).toMatch(/^\/pasarelas\/empresas(;|$)/);
    expect(actionResponses[0]?.body).toContain("Nueva empresa");
  });
});
