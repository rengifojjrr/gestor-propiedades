import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ZONE, addDays, todayNY, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import { signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * El detalle de un cobro (/pasarelas/cobros/[id]), su edición y la papelera, en el celular y en el escritorio, con
 * un usuario real del stack local que trae lo de E1 (`newUser()`): «Escuela Demo» con su canal al 5 % y el esquema
 * 50/30/20 sobre el neto; Stripe 2,9 % + 0,30 con «Pago rápido» (1,5 % del bruto, cae el mismo día). Antes de
 * registrar nada, el costo por disputa de Stripe pasa a 15,00: el cobro lo congela al registrarse.
 */

const BUCKET = "comprobantes";

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

/** Los avisos pasajeros con ese texto. */
const toastWith = (page: Page, text: string): Locator =>
  page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: text });

/** Espera el aviso entero (axe mide su contraste, no a medio aparecer). */
async function expectToast(page: Page, text: string): Promise<void> {
  const toast = toastWith(page, text).first();
  await expect(toast).toBeVisible();
  await expect(toast).toHaveCSS("opacity", "1");
}

/** La línea del desglose con ese nombre. */
const feeLine = (page: Page, name: string): Locator =>
  page.getByRole("list", { name: "Comisiones" }).getByRole("listitem").filter({ hasText: name });

/** Lo que le toca a un beneficiario en el reparto. */
const share = (page: Page, name: string): Locator =>
  page.getByRole("list", { name: "Reparto" }).getByRole("listitem").filter({ hasText: name });

const history = (page: Page): Locator => page.getByRole("list", { name: "Historial" });

/** El sello del estado del cobro con ese texto (no el mismo texto en el historial). */
const stamp = (page: Page, text: string): Locator => page.locator("[data-stamp]").getByText(text, { exact: true });

/** Despliega «Más acciones» del detalle, si lo hay y está plegado. */
async function openMoreActions(page: Page): Promise<void> {
  const actions = page.getByRole("region", { name: "Acciones" });
  // Primero la región entera: mientras la página carga no hay botones que contar.
  await expect(actions).toBeVisible();
  const more = actions.getByRole("button", { name: "Más acciones" });
  if ((await more.count()) === 0 || (await more.getAttribute("aria-expanded")) === "true") return;
  // Se habilita al hidratarse la página: antes, tocarlo no haría nada.
  await expect(more).toBeEnabled();
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
}

/**
 * Un botón de las acciones del detalle. La principal está a la vista; las demás, en «Más acciones»: se despliega
 * antes de buscarlas (si ya está desplegado, se queda así), para que «no se ofrece» no sea solo «está plegado».
 */
async function action(page: Page, name: string): Promise<Locator> {
  await openMoreActions(page);
  return page.getByRole("region", { name: "Acciones" }).getByRole("button", { name, exact: true });
}

/** ¿Cabe la tabla del antes y el después sin desplazarse a lo ancho? */
const fitsWidth = (table: Locator): Promise<boolean> => table.evaluate((el) => el.scrollWidth <= el.clientWidth);

/** Las llamadas a Server Actions (POST con la cabecera `Next-Action`). */
const isAction = (request: { method(): string; headers(): Record<string, string> }): boolean =>
  request.method() === "POST" && request.headers()["next-action"] !== undefined;

/** Lo que pide el navegador para volver a pintar la pantalla (`router.refresh`): un GET con la cabecera `RSC`. */
const isRefresh = (request: { method(): string; headers(): Record<string, string> }): boolean =>
  request.method() === "GET" && request.headers()["rsc"] !== undefined;

/** Lo que dice la app cuando la llamada a una acción no vuelve: no se sabe si se guardó. */
const UNSURE_TEXT = "Se perdió la conexión y no se sabe si se guardó. Revisa cómo quedó antes de repetirlo.";

/**
 * Mala señal: las acciones llegan al servidor (y se guardan) pero su respuesta no vuelve, y los refrescos de la
 * pantalla no llegan. Deja una marca en la página: si se recargara entera, se perdería. Devuelve cuántos refrescos
 * se intentaron.
 */
async function badSignal(page: Page): Promise<{ refreshes: () => number }> {
  let refreshes = 0;
  await page.evaluate(() => {
    document.body.dataset.marca = "sin recargar";
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (isAction(request)) {
      await route.fetch();
      return route.abort();
    }
    if (isRefresh(request)) {
      refreshes += 1;
      return route.abort();
    }
    return route.fallback();
  });
  return { refreshes: () => refreshes };
}

/** ¿Sigue la misma página, sin haberse recargado? */
const notReloaded = (page: Page): Promise<string | undefined> => page.evaluate(() => document.body.dataset.marca);

/** Los archivos de la carpeta del cobro en Storage, como los ve su dueño. */
async function storedFiles(client: Db, userId: string, txId: string): Promise<string[]> {
  const { data, error } = await client.storage.from(BUCKET).list(`${userId}/${txId}`);
  if (error) throw new Error(`No se pudo listar la carpeta del cobro: ${error.message}`);
  return data.filter((entry) => entry.id !== null).map((entry) => entry.name);
}

async function receiptRows(client: Db, txId: string): Promise<number> {
  const { data, error } = await client.from("pay_transaction_receipts").select("id").eq("transaction_id", txId);
  if (error) throw new Error(`No se pudieron leer los comprobantes: ${error.message}`);
  return data.length;
}

test.describe.serial("detalle del cobro", () => {
  let user: TestUser;
  let client: Db;
  /** El cobro E1 registrado por la pantalla en la primera prueba. */
  let e1Id = "";
  let e1Reference = "";

  test.beforeAll(async () => {
    user = await newUser();
    client = await signInAal1(user.email, user.password);
    unwrap(
      await client
        .from("pay_gateways")
        .update({ dispute_fee: "15.00" })
        .eq("id", user.basics.gatewayId)
        .select("id")
        .single(),
      "costo por disputa de Stripe",
    );
  });

  /** Un cobro de 100,00 USD por Stripe, sin opciones ni canal, repartido 50/30/20, hoy al mediodía. */
  async function charge(reference: string): Promise<string> {
    const id = randomUUID();
    const today = todayNY(new Date());
    await serverData().createTx(client, {
      id,
      companyId: user.basics.companyId,
      channelId: null,
      gatewayId: user.basics.gatewayId,
      extraIds: [],
      schemeId: user.basics.schemeId,
      occurredOn: today,
      occurredAt: wallTimeToInstant(`${today}T12:00`, ZONE),
      currency: "USD",
      grossOriginal: "100.00",
      reference,
      note: null,
    });
    return id;
  }

  test("viene de «Registrar cobro»: E1 con comprobante, «Ver cobro» y el detalle cuadra", async ({ page }) => {
    await login(page, user);
    await page.goto("/pasarelas/registrar");
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Canal").selectOption({ label: "Inscripciones en línea" });
    await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
    await page.getByRole("switch", { name: "Pago rápido" }).check();
    await page.getByLabel("Monto").fill("100");
    e1Reference = `E1-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(e1Reference);
    const occurredOn = (await page.getByLabel("Fecha y hora").inputValue()).slice(0, 10);
    await page.getByLabel("Elegir archivo").setInputFiles({
      name: "recibo-demo.png",
      mimeType: "image/png",
      buffer: png(800, 400),
    });
    await page.getByRole("button", { name: "Guardar" }).click();
    await toastWith(page, "Cobro guardado").getByRole("button", { name: "Ver cobro" }).click();
    await expect(page).toHaveURL(/\/pasarelas\/cobros\/[0-9a-f-]{36}$/);
    e1Id = new URL(page.url()).pathname.split("/").at(-1) ?? "";

    await expect(page.getByRole("heading", { level: 1 })).toContainText("$100,00");
    await expect(feeLine(page, "Stripe")).toContainText("$3,20");
    await expect(feeLine(page, "Pago rápido")).toContainText("$1,50");
    await expect(feeLine(page, "Inscripciones en línea")).toContainText("$5,00");
    await expect(page.getByTestId("comisiones")).toHaveText("$9,70");
    await expect(page.getByTestId("neto")).toHaveText("$90,30");
    await expect(share(page, "Grupo A")).toContainText("$45,15");
    await expect(share(page, "Grupo B")).toContainText("$27,09");
    await expect(share(page, "Grupo C")).toContainText("$18,06");
    // «Pago rápido» cae el mismo día del cobro.
    await expect(page.getByTestId("fecha-estimada").locator("time")).toHaveAttribute("datetime", occurredOn);
    await expect(history(page)).toContainText("Cobro de $100,00 por Stripe");
    // Las fotos se achican y se recodifican antes de subir: el tipo guardado es el que dice Storage.
    await expect(history(page)).toContainText("Comprobante agregado");

    // El comprobante se ve con una URL firmada, pedida al abrirlo.
    const receipts = page.getByRole("list", { name: "Comprobantes" }).getByRole("listitem");
    await expect(receipts).toHaveCount(1);
    await expect(receipts.first()).toContainText("Imagen · ");
    await expectCleanScreen(page);
    await receipts.first().getByRole("button", { name: "Ver" }).click();
    const viewer = page.getByRole("dialog", { name: /^Comprobante 1: Imagen · / });
    const image = viewer.getByRole("img", { name: /^Comprobante 1: Imagen · / });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/comprobantes\//);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    await expectCleanScreen(page);
    await viewer.getByRole("button", { name: "Cerrar" }).first().click();
    await expect(viewer).toBeHidden();
  });

  test("«Listo cuando» n.º 6: reembolso parcial, disputa, papelera y borrar del todo", async ({ page }) => {
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${e1Id}`);
    // Lo primero son los datos y el desglose: de las acciones, solo la principal y «Más acciones» a la vista.
    const actions = page.getByRole("region", { name: "Acciones" });
    await expect(actions.getByRole("button", { name: "Marcar depositado" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Más acciones" })).toHaveAttribute("aria-expanded", "false");
    await expect(actions.getByRole("button", { name: "Registrar reembolso" })).toBeHidden();
    await expectCleanScreen(page);

    // Reembolso parcial de 40,00: antes de confirmar se ve el antes y el después.
    await (await action(page, "Registrar reembolso")).click();
    const refund = page.getByRole("dialog", { name: "Reembolso" });
    await refund.getByLabel("Monto del reembolso").fill("40");
    await refund.getByLabel("Nota").fill("Devolución de una clase");
    const changes = refund.getByRole("region", { name: "Antes y después" });
    await expect(changes.getByRole("row").filter({ hasText: "Bruto" })).toContainText("$100,00");
    await expect(changes.getByRole("row").filter({ hasText: "Bruto" })).toContainText("$60,00");
    await expect(changes.getByRole("row").filter({ hasText: "Costo del reembolso" })).toContainText("$1,16");
    await expect(changes.getByRole("row").filter({ hasText: "Neto" })).toContainText("$52,90");
    // El antes y el después cabe entero, también a 390 px.
    expect(await fitsWidth(changes)).toBe(true);
    await expectCleanScreen(page);
    await refund.getByRole("button", { name: "Registrar reembolso" }).click();
    await expect(refund).toBeHidden();

    await expect(page.getByTestId("bruto")).toHaveText("$60,00");
    await expect(feeLine(page, "Costo del reembolso")).toContainText("$1,16");
    await expect(page.getByTestId("comisiones")).toHaveText("$7,10");
    await expect(page.getByTestId("neto")).toHaveText("$52,90");
    await expect(share(page, "Grupo A")).toContainText("$26,45");
    await expect(share(page, "Grupo B")).toContainText("$15,87");
    await expect(share(page, "Grupo C")).toContainText("$10,58");
    await expect(history(page).getByRole("listitem").first()).toContainText("Reembolso de $40,00");
    await expect(history(page).getByRole("listitem").first()).toContainText("Devolución de una clase");
    await expect(stamp(page, "Reembolso parcial")).toBeVisible();
    await expectToast(page, "Reembolso registrado");
    await expectCleanScreen(page);

    // Abrir la disputa suma su costo (15,00, el de Stripe congelado en el cobro).
    await (await action(page, "Abrir disputa")).click();
    const opening = page.getByRole("dialog", { name: "Abrir disputa" });
    await expect(opening).toContainText("$15,00");
    await expect(opening.getByRole("region", { name: "Antes y después" }).getByRole("row").filter({ hasText: "Neto" })).toContainText(
      "$37,90",
    );
    await expectCleanScreen(page);
    await opening.getByRole("button", { name: "Abrir disputa" }).click();
    await expect(opening).toBeHidden();
    await expect(feeLine(page, "Costo de disputa")).toContainText("$15,00");
    await expect(page.getByTestId("comisiones")).toHaveText("$22,10");
    await expect(page.getByTestId("neto")).toHaveText("$37,90");
    await expect(stamp(page, "En disputa")).toBeVisible();
    await expect((await action(page, "Abrir disputa"))).toHaveCount(0);

    // Ganarla la revierte.
    await (await action(page, "Resolver disputa")).click();
    const resolving = page.getByRole("dialog", { name: "Resolver disputa" });
    await resolving.getByLabel("Ganada").check();
    await expectCleanScreen(page);
    await resolving.getByRole("button", { name: "Guardar" }).click();
    await expect(resolving).toBeHidden();
    await expect(feeLine(page, "Costo de disputa")).toHaveCount(0);
    await expect(page.getByTestId("neto")).toHaveText("$52,90");
    await expect(history(page)).toContainText("Disputa abierta");
    await expect(history(page)).toContainText("Disputa ganada");

    // Corregir el total reembolsado de 40,00 a 30,00: reemplaza lo reembolsado, no le suma.
    await (await action(page, "Registrar reembolso")).click();
    await refund.getByLabel("Corregir el total reembolsado").check();
    const totalField = refund.getByLabel("Total reembolsado", { exact: true });
    await expect(totalField).toHaveValue("40,00");
    await expect(refund.getByLabel("Monto del reembolso")).toHaveCount(0);
    await totalField.fill("30");
    const correction = refund.getByRole("region", { name: "Antes y después" });
    await expect(correction.getByRole("row").filter({ hasText: "Bruto" })).toContainText("$60,00");
    await expect(correction.getByRole("row").filter({ hasText: "Bruto" })).toContainText("$70,00");
    await expect(correction.getByRole("row").filter({ hasText: "Costo del reembolso" })).toContainText("$0,87");
    await expect(correction.getByRole("row").filter({ hasText: "Neto" })).toContainText("$62,25");
    await expectCleanScreen(page);
    await refund.getByRole("button", { name: "Guardar el total" }).click();
    await expect(refund).toBeHidden();
    await expect(page.getByTestId("bruto")).toHaveText("$70,00");
    await expect(feeLine(page, "Costo del reembolso")).toContainText("$0,87");
    await expect(page.getByTestId("comisiones")).toHaveText("$7,75");
    await expect(page.getByTestId("neto")).toHaveText("$62,25");
    await expect(share(page, "Grupo A")).toContainText("$31,13");
    await expect(share(page, "Grupo B")).toContainText("$18,67");
    await expect(share(page, "Grupo C")).toContainText("$12,45");
    await expect(history(page).getByRole("listitem").first()).toContainText("Reembolso corregido a $30,00");
    await expectToast(page, "Total reembolsado corregido");

    // Reembolsado del todo ya no admite otro reembolso: el botón pasa a «Corregir reembolso», solo con el total.
    await (await action(page, "Registrar reembolso")).click();
    await refund.getByLabel("Monto del reembolso").fill("70");
    await refund.getByRole("button", { name: "Registrar reembolso" }).click();
    await expect(refund).toBeHidden();
    await expect(page.getByTestId("bruto")).toHaveText("$0,00");
    await expect(stamp(page, "Reembolsado")).toBeVisible();
    await expect((await action(page, "Registrar reembolso"))).toHaveCount(0);
    await (await action(page, "Corregir reembolso")).click();
    await expect(refund.getByRole("radio")).toHaveCount(0);
    await expect(refund.getByLabel("Total reembolsado", { exact: true })).toHaveValue("100,00");
    await refund.getByLabel("Total reembolsado", { exact: true }).fill("30");
    await expect(refund.getByRole("region", { name: "Antes y después" }).getByRole("row").filter({ hasText: "Neto" })).toContainText(
      "$62,25",
    );
    await expectCleanScreen(page);
    await refund.getByRole("button", { name: "Guardar el total" }).click();
    await expect(refund).toBeHidden();
    await expect(page.getByTestId("bruto")).toHaveText("$70,00");
    await expect(page.getByTestId("neto")).toHaveText("$62,25");
    await expect(stamp(page, "Reembolso parcial")).toBeVisible();
    await expect((await action(page, "Registrar reembolso"))).toBeVisible();

    // A la papelera: sale de la lista; restaurarlo lo devuelve.
    await (await action(page, "A la papelera")).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Enviar a la papelera" }).click();
    await expect(page.getByText("Este cobro está en la papelera")).toBeVisible();
    await expect((await action(page, "Restaurar"))).toBeVisible();
    await expect((await action(page, "Registrar reembolso"))).toHaveCount(0);
    await page.goto(`/pasarelas/cobros?q=${e1Reference}`);
    await expect(page.getByText("No hay cobros con estos filtros")).toBeVisible();

    await page.goto("/pasarelas/papelera");
    const trashed = page.getByRole("list", { name: "Cobros en la papelera" }).getByRole("listitem").filter({ hasText: e1Reference });
    await expect(trashed).toBeVisible();
    await expectCleanScreen(page);
    await trashed.getByRole("button", { name: "Restaurar" }).click();
    await expect(trashed).toHaveCount(0);
    await page.goto(`/pasarelas/cobros?q=${e1Reference}`);
    await expect(page.getByRole("link", { name: e1Reference }).first()).toBeVisible();

    // Borrar del todo se lleva también el comprobante de Storage.
    expect(await storedFiles(client, user.id, e1Id)).toHaveLength(1);
    await page.goto(`/pasarelas/cobros/${e1Id}`);
    await (await action(page, "A la papelera")).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Enviar a la papelera" }).click();
    await expect(page.getByText("Este cobro está en la papelera")).toBeVisible();
    await page.goto("/pasarelas/papelera");
    await trashed.getByRole("button", { name: "Borrar del todo" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("también sus comprobantes");
    await expectCleanScreen(page);
    await confirm.getByRole("button", { name: "Borrar del todo" }).click();
    await expect(trashed).toHaveCount(0);
    await expect(page.getByText("La papelera está vacía")).toBeVisible();
    await expectCleanScreen(page);
    expect(await storedFiles(client, user.id, e1Id)).toEqual([]);
    expect(await serverData().getSnapshots(client, [e1Id])).toEqual([]);
    await page.goto(`/pasarelas/cobros/${e1Id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Esta página no existe" })).toBeVisible();
  });

  test("Foco 3: agregar un comprobante desde el detalle y quitarlo borra archivo y fila", async ({ page }) => {
    const id = await charge(`FOCO3-${randomUUID().slice(0, 8)}`);
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${id}`);
    const card = page.getByRole("region", { name: "Comprobantes" });
    await expect(card).toContainText("Sin comprobantes");
    await card.getByLabel("Elegir archivo").setInputFiles({ name: "factura.png", mimeType: "image/png", buffer: png(300, 200) });
    const receipts = card.getByRole("list", { name: "Comprobantes" }).getByRole("listitem");
    await expect(receipts).toHaveCount(1);
    await expect(receipts.first()).toContainText("Imagen · ");
    await expectToast(page, "Comprobante agregado");
    expect(await storedFiles(client, user.id, id)).toHaveLength(1);
    expect(await receiptRows(client, id)).toBe(1);
    await expectCleanScreen(page);

    await receipts.first().getByRole("button", { name: "Quitar" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("archivo");
    await confirm.getByRole("button", { name: "Quitar comprobante" }).click();
    await expect(receipts).toHaveCount(0);
    await expect(card).toContainText("Sin comprobantes");
    await expect(history(page)).toContainText("Comprobante quitado");
    expect(await storedFiles(client, user.id, id)).toEqual([]);
    expect(await receiptRows(client, id)).toBe(0);

    // Un archivo que no se admite no se sube.
    await card.getByLabel("Elegir archivo").setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
    await expect(card.getByText("Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.")).toBeVisible();
    expect(await storedFiles(client, user.id, id)).toEqual([]);
    await expectCleanScreen(page);
  });

  test("el camino del dinero, la fecha estimada y el fallido: solo se ofrece lo que el estado admite", async ({ page }) => {
    const id = await charge(`CAMINO-${randomUUID().slice(0, 8)}`);
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${id}`);
    await expect((await action(page, "Revertir depósito"))).toHaveCount(0);
    await expect((await action(page, "Reabrir"))).toHaveCount(0);

    // La fecha estimada a mano, y de vuelta a la automática.
    const estimated = page.getByTestId("fecha-estimada");
    const automatic = await estimated.locator("time").getAttribute("datetime");
    await (await action(page, "Cambiar fecha estimada")).click();
    const dateDialog = page.getByRole("dialog", { name: "Fecha estimada" });
    await dateDialog.getByLabel("Fecha estimada del depósito").fill("2031-01-15");
    await dateDialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dateDialog).toBeHidden();
    await expect(estimated.locator("time")).toHaveAttribute("datetime", "2031-01-15");
    await expect(estimated).toContainText("puesta a mano");
    await (await action(page, "Cambiar fecha estimada")).click();
    await expectCleanScreen(page);
    await dateDialog.getByRole("button", { name: "Volver a la automática" }).click();
    await expect(dateDialog).toBeHidden();
    await expect(estimated.locator("time")).toHaveAttribute("datetime", automatic ?? "");
    await expect(estimated).not.toContainText("puesta a mano");

    // En tránsito → depositado → revertir.
    await (await action(page, "Marcar en tránsito")).click();
    await expect(stamp(page, "En tránsito")).toBeVisible();
    await expect((await action(page, "Marcar en tránsito"))).toHaveCount(0);
    await (await action(page, "Marcar depositado")).click();
    const deposit = page.getByRole("dialog", { name: "Marcar depositado" });
    const today = todayNY(new Date());
    // Ni antes del cobro ni un día que todavía no llegó.
    await deposit.getByLabel("Fecha del depósito").fill("2026-01-02");
    await deposit.getByRole("button", { name: "Marcar depositado" }).click();
    await expect(deposit.getByText("La fecha del depósito no puede ser anterior a la del cobro.")).toBeVisible();
    await deposit.getByLabel("Fecha del depósito").fill("2099-01-02");
    await deposit.getByRole("button", { name: "Marcar depositado" }).click();
    await expect(deposit.getByText("La fecha del depósito no puede ser futura.")).toBeVisible();
    await deposit.getByLabel("Fecha del depósito").fill(today);
    await deposit.getByRole("button", { name: "Marcar depositado" }).click();
    await expect(page.getByTestId("depositado-el").locator("time")).toHaveAttribute("datetime", today);
    // Ya depositado, el detalle (y solo el detalle) puede cambiar la fecha del depósito.
    await expect(await action(page, "Cambiar la fecha del depósito")).toBeVisible();
    await expect((await action(page, "Marcar fallido"))).toHaveCount(0);
    await (await action(page, "Revertir depósito")).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Revertir depósito" }).click();
    await expect(page.getByTestId("depositado-el")).toHaveCount(0);
    await expect((await action(page, "Marcar fallido"))).toBeVisible();

    // Fallido: todo en cero, y se puede reabrir.
    await (await action(page, "Marcar fallido")).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Marcar fallido" }).click();
    await expect(stamp(page, "Fallido")).toBeVisible();
    await expect(page.getByTestId("neto")).toHaveText("$0,00");
    await expect((await action(page, "Registrar reembolso"))).toHaveCount(0);
    await expect((await action(page, "Abrir disputa"))).toHaveCount(0);
    await expectToast(page, "Cobro marcado como fallido");
    await expectCleanScreen(page);
    await (await action(page, "Reabrir")).click();
    await expect(page.getByTestId("neto")).not.toHaveText("$0,00");
    await expect(history(page)).toContainText("Marcado como fallido");
    await expect(history(page)).toContainText("Reabierto");
  });

  test("con mala señal no se pierde nada: si no vuelven ni la acción ni el refresco, el diálogo, lo escrito y el aviso siguen; «Ver cómo quedó» enseña que se guardó y reintentarlo no lo suma otra vez", async ({
    page,
  }) => {
    const id = await charge(`CORTE-${randomUUID().slice(0, 8)}`);
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${id}`);
    await (await action(page, "Registrar reembolso")).click();
    const refund = page.getByRole("dialog", { name: "Reembolso" });
    await refund.getByLabel("Monto del reembolso").fill("30");
    await refund.getByLabel("Nota").fill("Devolución parcial");

    const signal = await badSignal(page);
    await refund.getByRole("button", { name: "Registrar reembolso" }).click();
    await expect(refund.getByRole("alert")).toHaveText(UNSURE_TEXT);
    // Nada se refresca solo: con mala señal, el refresco fallido recargaría la página entera.
    await page.waitForTimeout(1_000);
    expect(signal.refreshes()).toBe(0);
    expect(await notReloaded(page)).toBe("sin recargar");
    await expect(refund.getByRole("alert")).toHaveText(UNSURE_TEXT);
    await expect(refund.getByLabel("Monto del reembolso")).toHaveValue("30");
    await expect(refund.getByLabel("Nota")).toHaveValue("Devolución parcial");
    await expect(page.getByTestId("reembolsado")).toHaveCount(0);
    await expectCleanScreen(page);

    // Vuelve la señal: «Ver cómo quedó» pinta la pantalla de detrás, que enseña que el reembolso sí quedó.
    await page.unroute("**/*");
    await refund.getByRole("button", { name: "Ver cómo quedó" }).click();
    await expect(page.getByTestId("reembolsado")).toHaveText("$30,00");
    await expect(refund.getByLabel("Monto del reembolso")).toHaveValue("30");

    // Repetirlo desde el mismo diálogo da conflicto: no se suma otra vez.
    await refund.getByRole("button", { name: "Registrar reembolso" }).click();
    await expect(refund.getByRole("alert")).toContainText("Este cobro cambió mientras lo editabas");
    const [saved] = await serverData().getSnapshots(client, [id]);
    expect(saved?.refunded).toBe("30.00");
  });

  test("con mala señal, al cerrar el diálogo de la duda se pinta la pantalla de detrás: el depósito sí quedó", async ({
    page,
  }) => {
    const id = await charge(`CORTE-DEP-${randomUUID().slice(0, 8)}`);
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${id}`);
    await page.getByRole("region", { name: "Acciones" }).getByRole("button", { name: "Marcar depositado" }).click();
    const deposit = page.getByRole("dialog", { name: "Marcar depositado" });

    await badSignal(page);
    await deposit.getByRole("button", { name: "Marcar depositado" }).click();
    await expect(deposit.getByRole("alert")).toHaveText(UNSURE_TEXT);
    expect(await notReloaded(page)).toBe("sin recargar");
    await expect(page.getByTestId("depositado-el")).toHaveCount(0);

    await page.unroute("**/*");
    await deposit.getByRole("button", { name: "Cancelar" }).click();
    await expect(deposit).toBeHidden();
    await expect(page.getByTestId("depositado-el")).toBeVisible();
  });

  test("depositar desde una pantalla vieja (otra pestaña abrió una disputa) da conflicto: no se deposita", async ({
    page,
  }) => {
    const id = await charge(`VIEJA-${randomUUID().slice(0, 8)}`);
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${id}`);
    const today = todayNY(new Date());
    // Otra pestaña abre una disputa mientras esta sigue con el cobro por caer.
    await serverData().disputeTx(client, id, { action: "abrir", on: today });

    await page.getByRole("region", { name: "Acciones" }).getByRole("button", { name: "Marcar depositado" }).click();
    const deposit = page.getByRole("dialog", { name: "Marcar depositado" });
    await deposit.getByRole("button", { name: "Marcar depositado" }).click();
    await expect(deposit.getByRole("alert")).toContainText("Este cobro cambió mientras lo editabas");
    const [saved] = await serverData().getSnapshots(client, [id]);
    expect(saved).toMatchObject({ status: "registrado", depositedOn: null, disputeState: "abierta" });
  });

  test("una comisión informada por la pasarela, tras un reembolso parcial, dice que es proporcional", async ({ page }) => {
    const id = randomUUID();
    const today = todayNY(new Date());
    await serverData().createTx(client, {
      id,
      companyId: user.basics.companyId,
      channelId: null,
      gatewayId: user.basics.gatewayId,
      extraIds: [],
      schemeId: null,
      occurredOn: today,
      occurredAt: wallTimeToInstant(`${today}T12:00`, ZONE),
      currency: "USD",
      grossOriginal: "100.00",
      reference: `INFORMADA-${randomUUID().slice(0, 8)}`,
      note: null,
      feeOverride: "3.20",
    });
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${id}`);
    await expect(feeLine(page, "Stripe")).toContainText("Informada por la pasarela");

    await serverData().refundTx(client, id, { amount: "40.00", on: today });
    await page.reload();
    await expect(feeLine(page, "Stripe")).toContainText("$1,92");
    await expect(feeLine(page, "Stripe")).not.toContainText("Informada por la pasarela");
    await expect(feeLine(page, "Stripe")).toContainText(
      "Proporcional a lo no reembolsado de la comisión informada ($3,20)",
    );
    await expectCleanScreen(page);
  });

  test("editar: el monto y la nota se guardan y el desglose se vuelve a calcular", async ({ page }) => {
    const reference = `EDITAR-${randomUUID().slice(0, 8)}`;
    const id = await charge(reference);
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${id}`);
    await expect(page.getByTestId("neto")).toHaveText("$96,80");
    // En un cobro por caer, la principal es «Marcar depositado»: «Editar» va en «Más acciones».
    await openMoreActions(page);
    await page.getByRole("region", { name: "Acciones" }).getByRole("link", { name: "Editar" }).click();
    await expect(page).toHaveURL(new RegExp(`/pasarelas/cobros/${id}/editar$`));
    await expect(page.getByRole("heading", { level: 1, name: "Editar cobro" })).toBeVisible();
    await expect(page.getByLabel("Referencia")).toHaveValue(reference);
    await expectCleanScreen(page);

    // Sin cambios no se guarda nada.
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "No hay cambios que guardar." })).toBeVisible();

    await page.getByLabel("Monto").fill("50");
    await page.getByLabel("Nota").fill("Mitad de la cuota");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(new RegExp(`/pasarelas/cobros/${id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("$50,00");
    // Stripe sobre 50,00: 1,75 de comisión; neto 48,25 repartido 50/30/20.
    await expect(feeLine(page, "Stripe")).toContainText("$1,75");
    await expect(page.getByTestId("neto")).toHaveText("$48,25");
    await expect(share(page, "Grupo A")).toContainText("$24,13");
    await expect(page.getByText("Mitad de la cuota")).toBeVisible();
    await expect(history(page).getByRole("listitem").first()).toContainText("Editado: monto, nota");
    await expectCleanScreen(page);
  });

  test("editar un cobro ya depositado no deja poner su fecha después del día del depósito", async ({ page }) => {
    const id = await charge(`EDITAR-DEP-${randomUUID().slice(0, 8)}`);
    const today = todayNY(new Date());
    await serverData().depositTx(client, [id], today);
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${id}/editar`);
    // Hasta hidratar, «Guardar cambios» está desactivado: lo que se escribiera antes se perdería al hidratar.
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    const when = page.getByLabel("Fecha y hora");
    await expect(when).toHaveAttribute("max", `${today}T23:59`);

    await when.fill(`${addDays(today, 1)}T12:00`);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("La fecha del depósito no puede ser anterior a la del cobro.")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/pasarelas/cobros/${id}/editar$`));
    await expectCleanScreen(page);
    const [saved] = await serverData().getSnapshots(client, [id]);
    expect(saved?.occurredOn).toBe(today);
  });

  test("vaciar la papelera borra todos sus cobros", async ({ page }) => {
    const ids = [await charge(`VACIAR-${randomUUID().slice(0, 8)}`), await charge(`VACIAR-${randomUUID().slice(0, 8)}`)];
    expect(await serverData().trashTx(client, ids)).toBe(2);
    await login(page, user);
    await page.goto("/pasarelas/papelera");
    await expect(page.getByRole("list", { name: "Cobros en la papelera" }).getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "Vaciar la papelera" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("2 cobros");
    await expect(confirm).toContainText("también sus comprobantes");
    await confirm.getByRole("button", { name: "Vaciar la papelera" }).click();
    await expect(page.getByText("La papelera está vacía")).toBeVisible();
    expect(await serverData().getSnapshots(client, ids)).toEqual([]);
    await expectCleanScreen(page);
  });
});

/**
 * El origen del pago (nacional o internacional) en el detalle y al editar, con otro usuario. Stripe 2,9 % + 0,30
 * cobra 3,20 sobre 100,00; su recargo internacional, 1,5 % del bruto, 1,50 más. Sin canal ni «Pago rápido»: no hay
 * plataforma ni otra opción que sumar.
 */
test.describe.serial("detalle del cobro: nacional o internacional", () => {
  const QUESTION = "¿El pago fue nacional o internacional?";
  let user: TestUser;
  let client: Db;

  test.beforeAll(async () => {
    user = await newUser();
    client = await signInAal1(user.email, user.password);
  });

  /** Un cobro de 100,00 USD por Stripe, sin canal, repartido 50/30/20, hoy al mediodía, con esas opciones. */
  async function charge(extraIds: string[]): Promise<string> {
    const id = randomUUID();
    const today = todayNY(new Date());
    await serverData().createTx(client, {
      id,
      companyId: user.basics.companyId,
      channelId: null,
      gatewayId: user.basics.gatewayId,
      extraIds,
      schemeId: user.basics.schemeId,
      occurredOn: today,
      occurredAt: wallTimeToInstant(`${today}T12:00`, ZONE),
      currency: "USD",
      grossOriginal: "100.00",
      reference: `ORIGEN-${randomUUID().slice(0, 8)}`,
      note: null,
    });
    return id;
  }

  test("el detalle dice el origen solo si la pasarela cobra recargo; editar de nacional a internacional recalcula", async ({
    page,
  }) => {
    const plain = await charge([]);
    await login(page, user);
    await page.goto(`/pasarelas/cobros/${plain}`);
    await expect(page.getByTestId("neto")).toHaveText("$96,80");
    // Stripe todavía no cobra recargo: no hay nada que decir del origen.
    await expect(page.getByTestId("origen")).toHaveCount(0);

    const surcharge = unwrap(
      await client
        .from("pay_gateway_extras")
        .insert({ gateway_id: user.basics.gatewayId, kind: "internacional", name: "Pago internacional", pct: "1.5", sort: 1 })
        .select("id")
        .single(),
      "recargo internacional",
    );
    const id = await charge([]);
    await page.goto(`/pasarelas/cobros/${id}`);
    await expect(page.getByTestId("origen")).toHaveText("Nacional");
    await expect(feeLine(page, "Stripe")).toContainText("$3,20");
    await expect(page.getByTestId("comisiones")).toHaveText("$3,20");
    await expectCleanScreen(page);

    await page.goto(`/pasarelas/cobros/${id}/editar`);
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    const origin = page.getByLabel(QUESTION);
    await expect(origin).toHaveValue("nacional");
    await expect(page.getByRole("group", { name: "Opciones de Stripe" })).not.toContainText("Pago internacional");
    await expectCleanScreen(page);
    await origin.selectOption("internacional");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(page).toHaveURL(new RegExp(`/pasarelas/cobros/${id}$`));
    await expect(page.getByTestId("origen")).toHaveText("Internacional");
    await expect(feeLine(page, "Stripe")).toContainText("$3,20");
    await expect(feeLine(page, "Pago internacional")).toContainText("$1,50");
    await expect(page.getByTestId("comisiones")).toHaveText("$4,70");
    await expect(page.getByTestId("neto")).toHaveText("$95,30");
    await expect(share(page, "Grupo A")).toContainText("$47,65");
    await expect(history(page).getByRole("listitem").first()).toContainText("Editado: opciones");
    const [saved] = await serverData().getSnapshots(client, [id]);
    expect(saved?.breakdown.rules.extras.map((option) => option.id)).toEqual([surcharge.id]);
    expect(saved?.fees).toBe("4.70");
    await expectCleanScreen(page);

    // Al volver a editarlo, la pregunta parte de lo guardado.
    await page.goto(`/pasarelas/cobros/${id}/editar`);
    await expect(page.getByLabel(QUESTION)).toHaveValue("internacional");
  });
});
