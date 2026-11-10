import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { signInAal1, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * «Registrar cobro» (/pasarelas/registrar), en el celular (390×844) y en el escritorio (1280×800), con un usuario
 * real del stack local que trae lo de E1 (`newUser()`): «Escuela Demo» con su canal al 5 % y el esquema 50/30/20
 * sobre el neto; Stripe 2,9 % + 0,30 con la opción «Pago rápido» (1,5 % del bruto, 0 días), apagada por defecto.
 *
 * El detalle del cobro todavía no existe: lo guardado se comprueba en la base, con la sesión del propio usuario.
 */

const MB = 1024 * 1024;

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
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

async function openForm(page: Page): Promise<void> {
  await page.goto("/pasarelas/registrar");
  await expect(page.getByRole("heading", { level: 1, name: "Registrar cobro" })).toBeVisible();
}

/** Elige lo de E1: Escuela Demo, su canal y Stripe (sin tocar las opciones). */
async function chooseE1(page: Page): Promise<void> {
  await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
  await page.getByLabel("Canal").selectOption({ label: "Inscripciones en línea" });
  await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
}

/** Los cobros guardados con esa referencia, leídos con la sesión del usuario (el dinero como texto). */
async function savedWith(client: Db, reference: string) {
  const { data, error } = await client
    .from("pay_transactions")
    .select(
      "id, fees_total::text, net_amount::text, estimated_deposit_on, receipts_count, pay_allocations(beneficiary_id, amount::text)",
    )
    .eq("reference", reference);
  if (error) throw new Error(`No se pudieron leer los cobros: ${error.message}`);
  return data;
}

test.describe.serial("registrar cobro", () => {
  let owner: TestUser;
  let ownerDb: Db;

  /** Los errores sin atrapar de la página y lo que React avisa por consola: cada prueba termina sin ninguno. */
  let pageErrors: string[] = [];

  test.beforeAll(async () => {
    owner = await newUser();
    ownerDb = await signInAal1(owner.email, owner.password);
  });

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      // La pantalla del detalle todavía no existe: su 404 no es un error de esta.
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
        pageErrors.push(message.text());
      }
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("«Listo cuando» n.º 1: E1 con pago rápido; la vista previa cuadra, se guarda igual y con su comprobante", async ({
    page,
  }) => {
    await login(page, owner);
    await openForm(page);
    await expect(page.getByText("hora de Nueva York")).toBeVisible();
    await expectCleanScreen(page);

    await chooseE1(page);
    // Al elegir la pasarela se encienden sus opciones por defecto: «Pago rápido» no lo es.
    const fast = page.getByRole("switch", { name: "Pago rápido" });
    await expect(fast).not.toBeChecked();
    await fast.check();
    await expect(page.getByLabel("Moneda")).toHaveValue("USD");
    await page.getByLabel("Monto").fill("100");
    const reference = `E1-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(reference);

    const preview = page.getByRole("region", { name: "Vista previa" });
    const fees = preview.getByRole("list", { name: "Comisiones" });
    await expect(fees.getByRole("listitem").filter({ hasText: "Stripe" })).toContainText("$3,20");
    await expect(fees.getByRole("listitem").filter({ hasText: "Pago rápido" })).toContainText("$1,50");
    await expect(fees.getByRole("listitem").filter({ hasText: "Inscripciones en línea" })).toContainText("$5,00");
    await expect(preview.getByTestId("comisiones")).toHaveText("$9,70");
    await expect(preview.getByTestId("neto")).toHaveText("$90,30");
    const shares = preview.getByRole("list", { name: "Reparto" });
    await expect(shares.getByRole("listitem").filter({ hasText: "Grupo A" })).toContainText("$45,15");
    await expect(shares.getByRole("listitem").filter({ hasText: "Grupo B" })).toContainText("$27,09");
    await expect(shares.getByRole("listitem").filter({ hasText: "Grupo C" })).toContainText("$18,06");
    // «Pago rápido» cae el mismo día: la fecha estimada es la del cobro, en Nueva York.
    const estimated = await preview.getByTestId("fecha-estimada").locator("time").getAttribute("datetime");
    const occurredLocal = await page.getByLabel("Fecha y hora").inputValue();
    expect(estimated).toBe(occurredLocal.slice(0, 10));

    await page.getByLabel("Elegir archivo").setInputFiles({
      name: "recibo-demo.png",
      mimeType: "image/png",
      buffer: png(800, 400),
    });
    await expectCleanScreen(page);

    await page.getByRole("button", { name: "Guardar" }).click();
    const toast = page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: "Cobro guardado" });
    await expect(toast).toBeVisible();

    const [saved, ...more] = await savedWith(ownerDb, reference);
    expect(more).toEqual([]);
    expect(saved).toMatchObject({
      fees_total: "9.70",
      net_amount: "90.30",
      estimated_deposit_on: estimated,
      receipts_count: 1,
    });
    const amountOf = (beneficiaryId: string) =>
      saved?.pay_allocations.find((line) => line.beneficiary_id === beneficiaryId)?.amount;
    expect([owner.basics.beneficiaryIds.a, owner.basics.beneficiaryIds.b, owner.basics.beneficiaryIds.c].map(amountOf)).toEqual(
      ["45.15", "27.09", "18.06"],
    );

    // Listo para el siguiente: la misma selección, monto y referencia vacíos y sin comprobante elegido.
    await expect(page.getByLabel("Monto")).toHaveValue("");
    await expect(page.getByLabel("Referencia")).toHaveValue("");
    await expect(page.getByLabel("Empresa")).toHaveValue(owner.basics.companyId);
    await expect(page.getByLabel("Canal")).toHaveValue(owner.basics.channelId);
    await expect(page.getByLabel("Pasarela")).toHaveValue(owner.basics.gatewayId);
    await expect(fast).toBeChecked();
    await expect(page.getByText("recibo-demo.png")).toHaveCount(0);
    // axe mide el contraste del aviso ya entero, no a medio aparecer.
    await expect(toast).toHaveCSS("opacity", "1");
    await expectCleanScreen(page);

    await toast.getByRole("button", { name: "Ver cobro" }).click();
    await expect(page).toHaveURL(new RegExp(`/pasarelas/cobros/${saved?.id}$`));
  });

  test("Foco 1: un doble toque en «Guardar» deja un solo cobro", async ({ page }) => {
    await login(page, owner);
    await openForm(page);
    await chooseE1(page);
    await page.getByLabel("Monto").fill("50");
    const reference = `DOBLE-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(reference);

    await page.getByRole("button", { name: "Guardar" }).dblclick();
    await expect(page.getByRole("region", { name: /Avisos/ }).getByText("Cobro guardado")).toBeVisible();
    await expect(page.getByLabel("Monto")).toHaveValue("");
    // Si un segundo envío hubiera salido, ya habría vuelto: el botón queda libre solo al terminar.
    await expect(page.getByRole("button", { name: "Guardar" })).toBeEnabled();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect(await savedWith(ownerDb, reference)).toHaveLength(1);
  });

  test("Foco 3: un archivo de 11 MB y un .txt se rechazan antes de subir; se guarda sin comprobante", async ({ page }) => {
    const storageWrites: string[] = [];
    page.on("request", (call) => {
      if (call.url().includes("/storage/v1/object/") && call.method() !== "GET") storageWrites.push(call.url());
    });
    await login(page, owner);
    await openForm(page);
    await chooseE1(page);
    await page.getByRole("switch", { name: "Pago rápido" }).check();
    await page.getByLabel("Monto").fill("25");
    const reference = `SIN-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(reference);
    const picker = page.getByLabel("Elegir archivo");
    const save = page.getByRole("button", { name: "Guardar" });

    await picker.setInputFiles({ name: "grande.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(11 * MB, 0x25) });
    await expect(page.getByText("El archivo pesa más de 10 MB.")).toBeVisible();
    await expect(save).toBeDisabled();
    await expectCleanScreen(page);

    await picker.setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("Pagado a Grupo A") });
    await expect(page.getByText("Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.")).toBeVisible();
    await expect(save).toBeDisabled();

    await page.getByRole("button", { name: "Quitar el archivo elegido" }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole("region", { name: /Avisos/ }).getByText("Cobro guardado")).toBeVisible();

    const [saved, ...more] = await savedWith(ownerDb, reference);
    expect(more).toEqual([]);
    expect(saved?.receipts_count).toBe(0);
    expect(storageWrites).toEqual([]);
  });

  test("«Repetir el último» carga la selección del último cobro (el de la prueba anterior)", async ({ page }) => {
    await login(page, owner);
    await openForm(page);
    await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
    await expect(page.getByLabel("Canal")).toHaveValue("");
    await expect(page.getByRole("switch", { name: "Pago rápido" })).not.toBeChecked();

    await page.getByRole("button", { name: "Repetir el último" }).click();
    await expect(page.getByLabel("Empresa")).toHaveValue(owner.basics.companyId);
    await expect(page.getByLabel("Canal")).toHaveValue(owner.basics.channelId);
    await expect(page.getByLabel("Pasarela")).toHaveValue(owner.basics.gatewayId);
    await expect(page.getByRole("switch", { name: "Pago rápido" })).toBeChecked();
    await expect(page.getByLabel("Monto")).toHaveValue("");
    await expectCleanScreen(page);
  });

  test("si la subida del comprobante falla, el cobro queda guardado y «Reintentar comprobante» lo sube a ese cobro", async ({
    page,
  }) => {
    await login(page, owner);
    await openForm(page);
    await chooseE1(page);
    await page.getByLabel("Monto").fill("80");
    const reference = `REINTENTO-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(reference);
    await page.getByLabel("Elegir archivo").setInputFiles({
      name: "recibo-demo.png",
      mimeType: "image/png",
      buffer: png(400, 200),
    });

    // Storage no responde: la subida falla.
    await page.route("**/storage/v1/object/**", (route) => route.abort());
    await page.getByRole("button", { name: "Guardar" }).click();
    const failed = page.getByRole("main").getByRole("alert").filter({ hasText: "el comprobante no se subió" });
    await expect(failed).toBeVisible();
    const toast = page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: "Cobro guardado" });
    await expect(toast).toBeVisible();
    const [saved, ...more] = await savedWith(ownerDb, reference);
    expect(more).toEqual([]);
    expect(saved?.receipts_count).toBe(0);
    await expect(toast).toHaveCSS("opacity", "1");
    await expectCleanScreen(page);

    // Storage vuelve: se reintenta solo la subida, al mismo cobro.
    await page.unrouteAll();
    await failed.getByRole("button", { name: "Reintentar comprobante" }).click();
    await expect(page.getByRole("region", { name: /Avisos/ }).getByText("Comprobante agregado.")).toBeVisible();
    await expect(failed).toHaveCount(0);
    const after = await savedWith(ownerDb, reference);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: saved?.id, receipts_count: 1 });
  });

  test("si falta configuración, la vista previa dice qué falta y a dónde ir a arreglarlo", async ({ page }) => {
    // Una pasarela sin ninguna tarifa (la pantalla de pasarelas no lo permite; la base sí).
    const { error } = await ownerDb.from("pay_gateways").insert({ name: "Pasarela sin tarifa" });
    if (error) throw new Error(`No se pudo crear la pasarela: ${error.message}`);

    await login(page, owner);
    await openForm(page);
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Pasarela").selectOption({ label: "Pasarela sin tarifa" });
    await page.getByLabel("Monto").fill("100");

    const preview = page.getByRole("region", { name: "Vista previa" });
    await expect(preview.getByText("La pasarela no tiene ninguna tarifa.")).toBeVisible();
    await expect(preview.getByRole("link", { name: "Revisar las pasarelas" })).toHaveAttribute(
      "href",
      "/pasarelas/pasarelas",
    );
    await expect(preview.getByTestId("neto")).toHaveCount(0);
    await expectCleanScreen(page);
  });
});
