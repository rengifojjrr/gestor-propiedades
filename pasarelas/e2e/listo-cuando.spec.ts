import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ZONE, addDays, formatDate, todayNY, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import type { ISODate } from "../src/lib/pasarelas/types";
import { enrollTotp, signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * Los siete «Listo cuando» del encargo, de corrido y en el celular (390×844), con un usuario nuevo que trae lo de E1
 * (`newUser()`): «Escuela Demo» con su canal «Inscripciones en línea» al 5 % y el esquema 50/30/20 sobre el neto;
 * Stripe 2,9 % + 0,30 con «Pago rápido» (1,5 % del bruto, cae el mismo día) y la «Cuenta principal …4321».
 *
 * Lo que cada punto comprueba se hace por las pantallas. La capa de datos (`serverData()`, con la sesión del propio
 * usuario) solo prepara lo que no es el objeto de la prueba: la segunda empresa del Resumen y los cobros viejos que
 * se marcan depositados en lote.
 */
test.skip(({ isMobile }) => !isMobile, "El «Listo cuando» se recorre en el celular (390×844)");

const BUCKET = "comprobantes";
const SIGNED_PREFIX = `/storage/v1/object/sign/${BUCKET}/`;

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
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function expectCleanScreen(page: Page): Promise<void> {
  // Un aviso a medio entrar, a medio pasar detrás del siguiente o a medio irse tiene el texto translúcido y axe lo
  // mide como falta de contraste: se espera a que los avisos queden quietos.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return animation.playState !== "running" || !(target instanceof Element && target.closest("[data-sonner-toaster]"));
    }),
  );
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Una línea de una lista con nombre («Comisiones», «Reparto»…) que contenga ese texto. */
const lineOf = (scope: Page | Locator, list: string, text: string): Locator =>
  scope.getByRole("list", { name: list }).getByRole("listitem").filter({ hasText: text });

/** Elige lo de E1 en «Registrar cobro»: Escuela Demo, su canal y Stripe. */
async function chooseE1(page: Page): Promise<void> {
  await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
  await page.getByLabel("Canal").selectOption({ label: "Inscripciones en línea" });
  await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
}

/** Lo que trae el token de una URL firmada de Storage (un JWT): cuándo se emitió y cuándo caduca, en segundos. */
function signedTokenTimes(src: string): { iat: number; exp: number } {
  const token = new URL(src).searchParams.get("token") ?? "";
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iat: number; exp: number };
}

test.describe.serial("«Listo cuando»", () => {
  let owner: TestUser;
  let ownerDb: Db;
  let today: ISODate;
  /** El cobro E1, registrado por la pantalla en el punto 1. */
  let e1Id = "";
  /** Su fecha estimada, la que dio la vista previa. */
  let e1EstimatedOn = "";

  /** Los errores sin atrapar de la página y los de consola: cada prueba termina sin ninguno. */
  let pageErrors: string[] = [];

  test.beforeAll(async () => {
    owner = await newUser();
    ownerDb = await signInAal1(owner.email, owner.password);
    today = todayNY(new Date());
  });

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(`${message.text()} (${message.location().url})`);
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("1. E1 desde «Registrar cobro»: la vista previa y el detalle dan 9,70 · 90,30 · 45,15 / 27,09 / 18,06 y la fecha estimada", async ({
    page,
  }) => {
    await login(page, owner);
    await page.getByRole("link", { name: "Registrar cobro" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Registrar cobro" })).toBeVisible();
    await chooseE1(page);
    await page.getByRole("switch", { name: "Pago rápido" }).check();
    await expect(page.getByLabel("Moneda")).toHaveValue("USD");
    await page.getByLabel("Monto").fill("100");
    await page.getByLabel("Referencia").fill(`E1-${randomUUID().slice(0, 8)}`);

    const preview = page.getByRole("region", { name: "Vista previa" });
    await expect(lineOf(preview, "Comisiones", "Stripe")).toContainText("$3,20");
    await expect(lineOf(preview, "Comisiones", "Pago rápido")).toContainText("$1,50");
    await expect(lineOf(preview, "Comisiones", "Inscripciones en línea")).toContainText("$5,00");
    await expect(preview.getByTestId("comisiones")).toHaveText("$9,70");
    await expect(preview.getByTestId("neto")).toHaveText("$90,30");
    await expect(lineOf(preview, "Reparto", "Grupo A")).toContainText("$45,15");
    await expect(lineOf(preview, "Reparto", "Grupo B")).toContainText("$27,09");
    await expect(lineOf(preview, "Reparto", "Grupo C")).toContainText("$18,06");
    // «Pago rápido» cae el mismo día: la fecha estimada es la del cobro, en Nueva York.
    const occurredOn = (await page.getByLabel("Fecha y hora").inputValue()).slice(0, 10);
    await expect(preview.getByTestId("fecha-estimada").locator("time")).toHaveAttribute("datetime", occurredOn);
    e1EstimatedOn = occurredOn;

    // La foto del comprobante, elegida desde el celular (el punto 2 comprueba quién la ve).
    await page.getByLabel("Elegir archivo").setInputFiles({
      name: "recibo-demo.png",
      mimeType: "image/png",
      buffer: png(800, 400),
    });
    await expectCleanScreen(page);

    await page.getByRole("button", { name: "Guardar" }).click();
    const toast = page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: "Cobro guardado" });
    await toast.getByRole("button", { name: "Ver cobro" }).click();
    await expect(page).toHaveURL(/\/pasarelas\/cobros\/[0-9a-f-]{36}$/);
    e1Id = new URL(page.url()).pathname.split("/").at(-1) ?? "";

    // Guardado, el detalle muestra lo mismo.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("$100,00");
    await expect(lineOf(page, "Comisiones", "Stripe")).toContainText("$3,20");
    await expect(lineOf(page, "Comisiones", "Pago rápido")).toContainText("$1,50");
    await expect(lineOf(page, "Comisiones", "Inscripciones en línea")).toContainText("$5,00");
    await expect(page.getByTestId("comisiones")).toHaveText("$9,70");
    await expect(page.getByTestId("neto")).toHaveText("$90,30");
    await expect(lineOf(page, "Reparto", "Grupo A")).toContainText("$45,15");
    await expect(lineOf(page, "Reparto", "Grupo B")).toContainText("$27,09");
    await expect(lineOf(page, "Reparto", "Grupo C")).toContainText("$18,06");
    await expect(page.getByTestId("fecha-estimada").locator("time")).toHaveAttribute("datetime", e1EstimatedOn);
    await expect(lineOf(page, "Comprobantes", "recibo-demo.png")).toBeVisible();
    await expectCleanScreen(page);
  });

  test("2. la foto del comprobante la ve solo el dueño, con un enlace que caduca a los 60 s", async ({ page }) => {
    // Otro usuario, con su propia sesión, no abre el cobro: para él no existe. (La página llega con el estado 200
    // porque `loading.tsx` ya empezó a enviarla cuando la lectura no encuentra el cobro; Next lo documenta así.)
    const other = await newUser();
    const otherDb = await signInAal1(other.email, other.password);
    const detail = `/pasarelas/cobros/${e1Id}`;
    await login(page, other);
    await page.goto(detail);
    await expect(page.getByRole("heading", { level: 1, name: "Esta página no existe" })).toBeVisible();
    await expect(page.getByText("recibo-demo.png")).toHaveCount(0);
    await expect(page.getByText("$90,30")).toHaveCount(0);
    await page.context().clearCookies();

    // El dueño la abre: la imagen llega con una URL firmada, pedida al abrirla.
    await login(page, owner);
    await page.goto(detail);
    await lineOf(page, "Comprobantes", "recibo-demo.png").getByRole("button", { name: "Ver" }).click();
    const viewer = page.getByRole("dialog", { name: "recibo-demo.png" });
    const image = viewer.getByRole("img", { name: "Comprobante recibo-demo.png" });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    await expectCleanScreen(page);

    const src = (await image.getAttribute("src")) ?? "";
    const { pathname } = new URL(src);
    expect(pathname.startsWith(SIGNED_PREFIX)).toBe(true);
    const path = decodeURIComponent(pathname.slice(SIGNED_PREFIX.length));
    expect(path.startsWith(`${owner.id}/${e1Id}/`)).toBe(true);
    // El enlace firmado del dueño caduca a los 60 s.
    const { iat, exp } = signedTokenTimes(src);
    expect(exp - iat).toBe(60);

    // Con su propia sesión, el otro usuario no puede firmar esa ruta; el dueño sí (la ruta es la buena).
    const foreignSign = await otherDb.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(foreignSign.error !== null || !foreignSign.data?.signedUrl).toBe(true);
    const ownSign = await ownerDb.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(ownSign.error).toBeNull();
    expect(ownSign.data?.signedUrl).toBeTruthy();
  });

  test("3. una tarifa de Stripe vigente desde mañana no mueve el cobro viejo; un cobro de mañana ya la usa", async ({
    page,
  }) => {
    const tomorrow = addDays(today, 1);
    await login(page, owner);
    await page.goto("/pasarelas/pasarelas");
    await page.getByRole("article", { name: "Stripe" }).getByRole("link", { name: "Stripe" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Stripe" })).toBeVisible();
    const fees = page.getByRole("region", { name: "Tarifas" });
    await expect(fees.getByLabel("Vigente desde")).toHaveValue(tomorrow);
    await fees.getByLabel("Comisión", { exact: true }).fill("3,5");
    await fees.getByLabel("Cuota fija", { exact: true }).fill("0,30");
    await fees.getByRole("button", { name: "Agregar tarifa" }).click();
    const added = fees.getByRole("listitem").filter({ hasText: "3,5 % + 0,30" });
    await expect(added).toBeVisible();
    await expect(added).not.toContainText("Vigente");
    await expectCleanScreen(page);

    // El cobro viejo sigue con su tarifa congelada.
    await page.goto(`/pasarelas/cobros/${e1Id}`);
    await expect(lineOf(page, "Comisiones", "Stripe")).toContainText("$3,20");
    await expect(page.getByTestId("comisiones")).toHaveText("$9,70");
    await expect(page.getByTestId("neto")).toHaveText("$90,30");

    // La vista previa de un cobro de hoy usa la de hoy; la de uno de mañana, la nueva: 100 × 3,5 % + 0,30.
    await page.goto("/pasarelas/registrar");
    await chooseE1(page);
    await page.getByLabel("Monto").fill("100");
    const preview = page.getByRole("region", { name: "Vista previa" });
    await page.getByLabel("Fecha y hora").fill(`${today}T12:00`);
    await expect(lineOf(preview, "Comisiones", "Stripe")).toContainText("$3,20");
    await page.getByLabel("Fecha y hora").fill(`${tomorrow}T12:00`);
    await expect(lineOf(preview, "Comisiones", "Stripe")).toContainText("$3,80");
    await expectCleanScreen(page);
  });

  test("4. el Resumen: lo facturado por empresa, las comisiones por pasarela, qué cae en 14 días y dónde, y lo que se debe", async ({
    page,
  }) => {
    // Preparación: una segunda empresa con otra pasarela y otra cuenta, y un cobro suyo de hoy.
    const shopId = unwrap(
      await ownerDb.from("pay_companies").insert({ name: "Tienda Demo" }).select("id").single(),
      "Tienda Demo",
    ).id;
    const savingsId = unwrap(
      await ownerDb
        .from("pay_bank_accounts")
        .insert({ alias: "Cuenta de ahorro", institution: "Cooperativa Demo", last4: "7305" })
        .select("id")
        .single(),
      "cuenta de ahorro",
    ).id;
    const paypalId = unwrap(
      await ownerDb.rpc("pay_create_gateway", {
        p: { name: "PayPal Demo", payout_days: 1, payout_day_type: "corridos", fee: { pct: "3.49", fixed: "0.49" } },
      }),
      "PayPal Demo",
    );
    unwrap(
      await ownerDb
        .from("pay_company_gateways")
        .insert({ company_id: shopId, gateway_id: paypalId, bank_account_id: savingsId })
        .select("id")
        .single(),
      "PayPal Demo en Tienda Demo",
    );
    const paypalTx = randomUUID();
    // 50,00 por PayPal Demo: comisión 2,24, neto 47,76, cae mañana (1 día corrido).
    await serverData().createTx(ownerDb, {
      id: paypalTx,
      companyId: shopId,
      channelId: null,
      gatewayId: paypalId,
      extraIds: [],
      schemeId: null,
      occurredOn: today,
      occurredAt: wallTimeToInstant(`${today}T12:00`, ZONE),
      currency: "USD",
      grossOriginal: "50.00",
      reference: null,
      note: null,
    });
    const [paypal] = await serverData().getSnapshots(ownerDb, [paypalTx]);
    const paypalOn = paypal?.estimatedDepositOn ?? "";

    await login(page, owner);
    await page.goto("/pasarelas");
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
    const card = (name: string) => page.getByRole("group", { name, exact: true });
    await expect(card("Bruto")).toContainText("$150,00");
    await expect(card("Comisiones")).toContainText("$11,94");
    await expect(card("Neto")).toContainText("$138,06");
    await expect(card("Por caer")).toContainText("$138,06");

    // Cuánto facturó cada empresa.
    const companies = page.getByRole("figure", { name: "Empresas por bruto" });
    await companies.getByText("Ver los datos en una tabla").click();
    await expect(companies.getByRole("row", { name: /Escuela Demo/ })).toContainText("$100,00");
    await expect(companies.getByRole("row", { name: /Tienda Demo/ })).toContainText("$50,00");

    // Cuánto se fue en comisiones por pasarela.
    const cost = page.getByRole("figure", { name: "Costo efectivo por pasarela" });
    await cost.getByText("Ver los datos en una tabla").click();
    await expect(cost.getByRole("row", { name: /Stripe/ })).toContainText("$9,70");
    await expect(cost.getByRole("row", { name: /PayPal Demo/ })).toContainText("$2,24");

    // Qué cae en los próximos 14 días y en qué cuenta.
    const deposits = page.getByRole("region", { name: "Próximos depósitos" });
    await expect(deposits.getByRole("article")).toHaveCount(2);
    const e1Group = deposits.getByRole("article", { name: `${formatDate(e1EstimatedOn)} · Cuenta principal (…4321)` });
    await expect(e1Group).toContainText("$90,30");
    const paypalGroup = deposits.getByRole("article", { name: `${formatDate(paypalOn)} · Cuenta de ahorro (…7305)` });
    await expect(paypalGroup).toContainText("$47,76");

    // Cuánto se le debe a cada grupo.
    // En el celular, una tarjeta por beneficiario (la tabla no cabe a 390 px; ver resumen.spec.ts).
    const splits = page.getByRole("list", { name: "Repartos por beneficiario" });
    const split = (name: string) => splits.getByRole("listitem").filter({ hasText: name });
    await expect(split("Grupo A")).toContainText("$45,15");
    await expect(split("Grupo B")).toContainText("$27,09");
    await expect(split("Grupo C")).toContainText("$18,06");
    // Los dibujos llegan después de la página: axe y el ancho se miran con ellos ya pintados.
    await expect(page.locator("figure .recharts-surface")).toHaveCount(5);
    await expectCleanScreen(page);
  });

  test("5. marcar depositados varios cobros de una vez desde Cobros actualiza el tiempo promedio de la pasarela", async ({
    page,
  }) => {
    // Preparación: dos cobros de Stripe de hace 2 y 4 días, sin depositar.
    const tag = randomUUID().slice(0, 8);
    const references = [`LC5-${tag}-1`, `LC5-${tag}-2`];
    for (const [index, reference] of references.entries()) {
      const on = addDays(today, -(2 + index * 2));
      await serverData().createTx(ownerDb, {
        id: randomUUID(),
        companyId: owner.basics.companyId,
        channelId: null,
        gatewayId: owner.basics.gatewayId,
        extraIds: [],
        schemeId: owner.basics.schemeId,
        occurredOn: on,
        occurredAt: wallTimeToInstant(`${on}T12:00`, ZONE),
        currency: "USD",
        grossOriginal: "100.00",
        reference,
        note: null,
      });
    }

    await login(page, owner);
    await page.goto("/pasarelas/pasarelas");
    const stripe = page.getByRole("article", { name: "Stripe" });
    await expect(stripe).toContainText("Sin depósitos todavía");

    await page.goto(`/pasarelas/cobros?periodo=30d&q=LC5-${tag}`);
    await expect(page.getByRole("heading", { level: 1, name: "Cobros" })).toBeVisible();
    for (const reference of references) {
      await page.getByRole("checkbox", { name: `Seleccionar el cobro ${reference}` }).check();
    }
    await expect(page.getByText("2 seleccionados")).toBeVisible();
    await page.getByRole("button", { name: "Marcar depositado" }).click();
    const dialog = page.getByRole("dialog", { name: "Marcar depositado" });
    await dialog.getByLabel("Fecha del depósito").fill(today);
    await expectCleanScreen(page);
    await dialog.getByRole("button", { name: "Marcar depositado" }).click();
    await expect(page.getByText("2 cobros marcados como depositados.")).toBeVisible();
    for (const reference of references) {
      await expect(page.getByRole("listitem").filter({ hasText: reference })).toContainText("Depositado");
    }

    // Cobrados hace 2 y 4 días y depositados hoy: 3 días en promedio, 3 de mediana.
    await page.goto("/pasarelas/pasarelas");
    await expect(stripe).toContainText("Promedio 3 días · mediana 3 días");
    await expectCleanScreen(page);
  });

  test("6. un reembolso parcial de 40 sobre E1 deja todo cuadrado al centavo", async ({ page }) => {
    await login(page, owner);
    await page.goto(`/pasarelas/cobros/${e1Id}`);
    const actions = page.getByRole("region", { name: "Acciones" });
    await actions.getByRole("button", { name: "Registrar reembolso" }).click();
    const refund = page.getByRole("dialog", { name: "Reembolso" });
    await refund.getByLabel("Monto del reembolso").fill("40");
    const changes = refund.getByRole("region", { name: "Antes y después" });
    await expect(changes.getByRole("row").filter({ hasText: "Neto" })).toContainText("$52,90");
    await expectCleanScreen(page);
    await refund.getByRole("button", { name: "Registrar reembolso" }).click();
    await expect(refund).toBeHidden();

    await expect(page.getByTestId("bruto")).toHaveText("$60,00");
    await expect(lineOf(page, "Comisiones", "Stripe")).toContainText("$2,04");
    await expect(lineOf(page, "Comisiones", "Costo del reembolso")).toContainText("$1,16");
    await expect(lineOf(page, "Comisiones", "Pago rápido")).toContainText("$0,90");
    await expect(lineOf(page, "Comisiones", "Inscripciones en línea")).toContainText("$3,00");
    await expect(page.getByTestId("comisiones")).toHaveText("$7,10");
    await expect(page.getByTestId("neto")).toHaveText("$52,90");
    await expect(lineOf(page, "Reparto", "Grupo A")).toContainText("$26,45");
    await expect(lineOf(page, "Reparto", "Grupo B")).toContainText("$15,87");
    await expect(lineOf(page, "Reparto", "Grupo C")).toContainText("$10,58");
    await expectCleanScreen(page);
  });

  test("7. nada público: sin sesión, todo manda a la entrada; con segundo factor y sin el código, a verificar", async ({
    page,
  }) => {
    const routesOf = (u: TestUser, txId: string): string[] => [
      "/pasarelas",
      "/pasarelas/registrar",
      "/pasarelas/cobros",
      `/pasarelas/cobros/${txId}`,
      `/pasarelas/cobros/${txId}/editar`,
      "/pasarelas/cobros/exportar",
      "/pasarelas/empresas",
      "/pasarelas/empresas/nueva",
      `/pasarelas/empresas/${u.basics.companyId}`,
      "/pasarelas/pasarelas",
      "/pasarelas/pasarelas/nueva",
      `/pasarelas/pasarelas/${u.basics.gatewayId}`,
      "/pasarelas/repartos",
      `/pasarelas/repartos/beneficiarios/${u.basics.beneficiaryIds.a}`,
      `/pasarelas/repartos/esquemas/${u.basics.schemeId}`,
      "/pasarelas/repartos/esquemas/nuevo",
      "/pasarelas/cuentas",
      "/pasarelas/importar",
      "/pasarelas/feriados",
      "/pasarelas/papelera",
      "/ajustes",
      "/ajustes/exportar",
    ];
    /** Espera a que la página termine en esa ruta (la redirección puede llegar ya con la página en camino). */
    const expectLandsOn = (pathname: string, message: string) =>
      expect(page, message).toHaveURL((url) => url.pathname === pathname);

    // Sin sesión: cada ruta del módulo manda a la entrada.
    for (const route of routesOf(owner, e1Id)) {
      await page.goto(route);
      await expectLandsOn("/login", `sin sesión, ${route}`);
    }

    // Un usuario con segundo factor y un cobro suyo.
    const guarded = await newUser();
    const guardedDb = await signInAal1(guarded.email, guarded.password);
    const guardedTx = randomUUID();
    await serverData().createTx(guardedDb, {
      id: guardedTx,
      companyId: guarded.basics.companyId,
      channelId: null,
      gatewayId: guarded.basics.gatewayId,
      extraIds: [],
      schemeId: guarded.basics.schemeId,
      occurredOn: today,
      occurredAt: wallTimeToInstant(`${today}T12:00`, ZONE),
      currency: "USD",
      grossOriginal: "100.00",
      reference: null,
      note: null,
    });
    await enrollTotp(guardedDb);
    // Con el código (la sesión que lo inscribió) ve su cobro.
    expect(unwrap(await guardedDb.from("pay_transactions").select("id"), "cobros con el código")).toHaveLength(1);

    // Con la contraseña sola queda en la verificación, vaya a donde vaya.
    await page.goto("/login");
    await page.getByLabel("Correo").fill(guarded.email);
    await page.getByLabel("Contraseña").fill(guarded.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/login\/verificar$/);
    await expectCleanScreen(page);
    for (const route of routesOf(guarded, guardedTx)) {
      await page.goto(route);
      await expectLandsOn("/login/verificar", `con la contraseña sola, ${route}`);
    }

    // Y la base no le devuelve nada a esa sesión, aunque tenga cobros.
    const aal1 = await signInAal1(guarded.email, guarded.password);
    expect(unwrap(await aal1.from("pay_transactions").select("id"), "cobros sin el código")).toEqual([]);
  });
});
