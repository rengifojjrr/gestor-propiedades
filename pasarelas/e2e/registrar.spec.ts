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
 *
 * PENDIENTE (tarea 16, «Cobro — detalle», o la 21): el encargo pide que, al guardar, «el detalle muestre lo mismo y
 * el comprobante». Cuando exista /pasarelas/cobros/[id], la prueba del «Listo cuando» n.º 1 sigue tras «Ver cobro» y
 * comprueba en la pantalla 3,20 / 1,50 / 5,00, comisiones 9,70, neto 90,30, 45,15 / 27,09 / 18,06, la fecha
 * estimada y el comprobante. La excepción de los 404 de las pantallas que faltan es `isPendingRoute`.
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

/**
 * PENDIENTE (tareas 11 a 19): las demás pantallas del módulo todavía no existen. En modo producción Next precarga
 * los enlaces del menú (`/pasarelas/cobros?_rsc=…`) y «Ver cobro» abre `/pasarelas/cobros/<id>`: todos dan 404, que
 * no son errores de esta pantalla. Solo se deja pasar el 404 de una ruta de `/pasarelas/…` que no sea esta; cuando
 * existan todas (tarea 21), esta excepción se quita.
 */
function isPendingRoute(url: string): boolean {
  const { pathname } = new URL(url);
  return pathname.startsWith("/pasarelas/") && !pathname.startsWith("/pasarelas/registrar");
}

test.describe.serial("registrar cobro", () => {
  let owner: TestUser;
  let ownerDb: Db;

  /** Los errores sin atrapar de la página y lo que React avisa por consola: cada prueba termina sin ninguno. */
  let pageErrors: string[] = [];
  /**
   * Las direcciones cuya carga falla a propósito en la prueba en curso (p. ej. Storage cortado con `page.route`):
   * el navegador avisa por consola «Failed to load resource», y ese aviso es lo que la prueba provoca.
   */
  let expectedLoadFailures: string[] = [];
  /** El texto de un error que la prueba en curso provoca a propósito: lo que se registre con él es lo esperado. */
  let provokedError: string | null = null;

  test.beforeAll(async () => {
    owner = await newUser();
    ownerDb = await signInAal1(owner.email, owner.password);
  });

  test.beforeEach(({ page }) => {
    pageErrors = [];
    expectedLoadFailures = [];
    provokedError = null;
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      const url = message.location().url;
      if (provokedError !== null && text.includes(provokedError)) return;
      const failedLoad = text.startsWith("Failed to load resource");
      const expected =
        failedLoad &&
        (expectedLoadFailures.some((part) => url.includes(part)) || (text.includes("404") && isPendingRoute(url)));
      if (!expected) pageErrors.push(`${text} (${url})`);
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
    // PENDIENTE (tarea 16): aquí, el desglose, el reparto, la fecha estimada y el comprobante en el detalle.
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

  test("«Atrás»: volver al formulario desde otra pantalla y guardar otro cobro deja dos cobros", async ({ page }) => {
    const tag = randomUUID().slice(0, 8);
    const monto = page.getByLabel("Monto");

    await login(page, owner);
    await openForm(page);
    await chooseE1(page);
    const refA = `ATRAS-A-${tag}`;
    await monto.fill("70");
    await page.getByLabel("Referencia").fill(refA);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(monto).toHaveValue("");
    await expect.poll(async () => (await savedWith(ownerDb, refA)).length).toBe(1);

    // A otra pantalla del menú y de vuelta con «Atrás»: el formulario sale de nuevo, y el cobro que se guarde ahora
    // es otro, no el anterior.
    await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Cobros", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Cobros" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Registrar cobro" })).toBeVisible();

    await chooseE1(page);
    const refB = `ATRAS-B-${tag}`;
    await monto.fill("35");
    await page.getByLabel("Referencia").fill(refB);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(monto).toHaveValue("");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);

    await expect.poll(async () => (await savedWith(ownerDb, refB)).length).toBe(1);
    const [savedA] = await savedWith(ownerDb, refA);
    const [savedB] = await savedWith(ownerDb, refB);
    expect(savedB?.id).not.toBe(savedA?.id);
    await expectCleanScreen(page);
  });

  test("si la subida del comprobante falla, el cobro queda guardado y «Reintentar comprobante» lo sube a ese cobro", async ({
    page,
  }) => {
    const tag = randomUUID().slice(0, 8);
    const pendingAlerts = page.getByRole("main").getByRole("alert").filter({ hasText: "el comprobante no se subió" });
    const pendingFor = (reference: string) => pendingAlerts.filter({ hasText: reference });
    const toasts = page.getByRole("region", { name: /Avisos/ }).getByRole("listitem");
    const savedToasts = toasts.filter({ hasText: "Cobro guardado" });

    /** Llena un cobro de E1 con su comprobante, lo guarda y espera el formulario listo para el siguiente. */
    async function saveWithReceipt(amount: string, reference: string) {
      await page.getByLabel("Monto").fill(amount);
      await page.getByLabel("Referencia").fill(reference);
      await page.getByLabel("Elegir archivo").setInputFiles({
        name: `recibo-${reference}.png`,
        mimeType: "image/png",
        buffer: png(400, 200),
      });
      await page.getByRole("button", { name: "Guardar" }).click();
      await expect(page.getByLabel("Monto")).toHaveValue("");
    }

    await login(page, owner);
    await openForm(page);
    await chooseE1(page);

    // Storage no responde: las subidas de A y de B fallan. Cada cobro tiene su propio aviso, con su monto y su
    // referencia, y el último queda a la vista junto a «Guardar» (en el celular, al pie de la pantalla).
    expectedLoadFailures.push("/storage/v1/object/");
    await page.route("**/storage/v1/object/**", (route) => route.abort());
    const refA = `REINTENTO-A-${tag}`;
    await saveWithReceipt("80", refA);
    await expect(pendingFor(refA)).toBeVisible();
    await expect(pendingFor(refA)).toContainText("$80,00");
    await expect(pendingFor(refA)).toBeInViewport();
    const [savedA, ...moreA] = await savedWith(ownerDb, refA);
    expect(moreA).toEqual([]);
    expect(savedA?.receipts_count).toBe(0);
    // Un corte de red: se ofrece reintentar con el mismo archivo, o agregarlo después desde el detalle del cobro.
    await expect(pendingFor(refA).getByRole("button", { name: "Reintentar comprobante" })).toBeVisible();
    await expect(pendingFor(refA).getByRole("button", { name: "Elegir otro archivo" })).toHaveCount(0);
    await expect(pendingFor(refA)).toContainText("También puedes agregarlo después desde el detalle del cobro");
    await expect(pendingFor(refA).getByRole("link", { name: "el detalle del cobro" })).toHaveAttribute(
      "href",
      `/pasarelas/cobros/${savedA?.id}`,
    );
    // El aviso de éxito no dice solo «Cobro guardado.»: dice que el comprobante no se subió y a dónde mirar.
    const withoutReceipt = toasts.filter({ hasText: "Cobro guardado, pero el comprobante no se subió" });
    await expect(withoutReceipt).toBeVisible();
    await expect(withoutReceipt).toContainText("reinténtalo en el aviso junto a «Guardar»");
    // Lo que falló fue el comprobante, no el cobro.
    await expect(page.getByText("No se pudo guardar el cobro")).toHaveCount(0);
    await expect(savedToasts.first()).toHaveCSS("opacity", "1");
    await expectCleanScreen(page);

    const refB = `REINTENTO-B-${tag}`;
    await saveWithReceipt("60", refB);
    await expect(pendingAlerts).toHaveCount(2);
    await expect(pendingFor(refA)).toBeVisible();
    await expect(pendingFor(refB)).toContainText("$60,00");
    await expect(pendingFor(refB)).toBeInViewport();

    // Storage vuelve. El siguiente cobro sube su comprobante y no se lleva los avisos de A ni de B.
    await page.unrouteAll();
    const refC = `REINTENTO-C-${tag}`;
    await saveWithReceipt("40", refC);
    await expect(pendingAlerts).toHaveCount(2);
    await expect(pendingFor(refA)).toBeVisible();
    await expect(pendingFor(refB)).toBeVisible();
    await expect(pendingFor(refC)).toHaveCount(0);
    const [savedC] = await savedWith(ownerDb, refC);
    expect(savedC?.receipts_count).toBe(1);
    await expect(savedToasts.first()).toHaveCSS("opacity", "1");
    await expectCleanScreen(page);

    // Se reintenta solo la subida de A, al mismo cobro; el aviso de B sigue ahí.
    await pendingFor(refA).getByRole("button", { name: "Reintentar comprobante" }).click();
    await expect(page.getByRole("region", { name: /Avisos/ }).getByText("Comprobante agregado.")).toBeVisible();
    await expect(pendingFor(refA)).toHaveCount(0);
    await expect(pendingAlerts).toHaveCount(1);
    await expect(pendingFor(refB)).toBeVisible();
    const afterA = await savedWith(ownerDb, refA);
    expect(afterA).toHaveLength(1);
    expect(afterA[0]).toMatchObject({ id: savedA?.id, receipts_count: 1 });
    expect((await savedWith(ownerDb, refB))[0]?.receipts_count).toBe(0);

    await pendingFor(refB).getByRole("button", { name: "Reintentar comprobante" }).click();
    await expect(pendingAlerts).toHaveCount(0);
    expect((await savedWith(ownerDb, refB))[0]?.receipts_count).toBe(1);
  });

  test("si el archivo no sirve, el cobro queda guardado y «Elegir otro archivo» le pone otro a ese cobro", async ({
    page,
  }) => {
    const reference = `ROTO-${randomUUID().slice(0, 8)}`;
    const toasts = page.getByRole("region", { name: /Avisos/ }).getByRole("listitem");
    const pending = page.getByRole("main").getByRole("alert").filter({ hasText: reference });

    await login(page, owner);
    await openForm(page);
    await chooseE1(page);
    await page.getByLabel("Monto").fill("30");
    await page.getByLabel("Referencia").fill(reference);
    // Se llama .png y dice ser PNG (pasa la comprobación al elegirlo), pero no es una imagen: no se puede leer.
    await page.getByLabel("Elegir archivo").setInputFiles({
      name: "roto.png",
      mimeType: "image/png",
      buffer: Buffer.from("esto no es una imagen"),
    });
    await page.getByRole("button", { name: "Guardar" }).click();

    await expect(pending).toContainText("El cobro quedó guardado, pero el comprobante no se subió.");
    await expect(pending).toContainText("No se pudo leer la imagen");
    const [saved, ...more] = await savedWith(ownerDb, reference);
    expect(more).toEqual([]);
    expect(saved?.receipts_count).toBe(0);
    // Reintentar con el mismo archivo fallaría igual: se ofrece elegir otro.
    await expect(pending.getByRole("button", { name: "Reintentar comprobante" })).toHaveCount(0);
    await expect(pending.getByRole("button", { name: "Elegir otro archivo" })).toBeVisible();
    await expect(pending.getByRole("link", { name: "el detalle del cobro" })).toHaveAttribute(
      "href",
      `/pasarelas/cobros/${saved?.id}`,
    );
    const withoutReceipt = toasts.filter({ hasText: "Cobro guardado, pero el comprobante no se subió" });
    await expect(withoutReceipt).toBeVisible();
    await expect(withoutReceipt).toContainText("elige otro archivo en el aviso junto a «Guardar»");
    await expect(page.getByText("No se pudo guardar el cobro")).toHaveCount(0);
    await expect(withoutReceipt).toHaveCSS("opacity", "1");
    await expectCleanScreen(page);

    // Otro archivo que tampoco sirve (se llama .pdf, pero no es un PDF): lo dice y sigue ofreciendo elegir otro.
    let chooser = page.waitForEvent("filechooser");
    await pending.getByRole("button", { name: "Elegir otro archivo" }).click();
    await (await chooser).setFiles({ name: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("Grupo A") });
    await expect(pending).toContainText("El contenido del archivo no es un JPG, PNG, WebP o PDF");
    await expect(pending).toContainText("falso.pdf");
    await expect(pending.getByRole("button", { name: "Elegir otro archivo" })).toBeEnabled();
    expect((await savedWith(ownerDb, reference))[0]?.receipts_count).toBe(0);

    // Uno bueno: se sube a ese mismo cobro y el aviso se va.
    chooser = page.waitForEvent("filechooser");
    await pending.getByRole("button", { name: "Elegir otro archivo" }).click();
    await (await chooser).setFiles({ name: "recibo-bueno.png", mimeType: "image/png", buffer: png(400, 200) });
    await expect(toasts.filter({ hasText: "Comprobante agregado." })).toBeVisible();
    await expect(pending).toHaveCount(0);
    const after = await savedWith(ownerDb, reference);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: saved?.id, receipts_count: 1 });
  });

  test("si el formulario no se puede mostrar, dice qué hacer: reintentar o mirar en Cobros", async ({ page }) => {
    // El formulario no puede crear el id del cobro en el navegador: falla al montarse y se ve `error.tsx`.
    const failure = "prueba: el formulario no se puede montar";
    provokedError = failure;
    await login(page, owner);
    await page.addInitScript((message) => {
      crypto.randomUUID = () => {
        throw new Error(message);
      };
    }, failure);
    await page.goto("/pasarelas/registrar");

    const main = page.getByRole("main");
    await expect(main.getByText("No se pudo mostrar el formulario.")).toBeVisible();
    await expect(main).toContainText("Vuelve a intentarlo en un momento.");
    await expect(main).toContainText("Si estabas guardando un cobro y llegó a guardarse, aparecerá en Cobros");
    // Es un formulario de alta: no hay «datos guardados» que tranquilizar.
    await expect(main).not.toContainText("Tus datos están guardados");
    await expect(main.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Ver Cobros" })).toHaveAttribute("href", "/pasarelas/cobros");
    await expectCleanScreen(page);
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
