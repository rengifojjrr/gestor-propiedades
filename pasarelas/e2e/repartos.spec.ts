import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { receiptLabel } from "../src/components/pasarelas/receipts/label";
import { ZONE, todayNY, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import { SETTLEMENT_ALREADY_SAVED_TEXT } from "../src/components/pasarelas/splits/settlementText";
import { SCHEME_ISSUE_TEXT } from "../src/lib/pasarelas/schemes";
import { adminClient, e1Item, saveTransactions, signInAal1 } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * Repartos: el libro por beneficiario y moneda (un saldo negativo dice «a favor de la empresa»), armar un esquema
 * 50/30/20 (con 50/30 y sin «Resto» no se guarda, y se dice por qué) y registrar una liquidación de 45,15 al
 * Grupo A con su comprobante. Un corte de red al guardar un beneficiario o al desactivarlo se dice ahí mismo, con
 * «Ver cómo quedó», sin perder lo escrito; borrar uno sin historia lleva a Repartos. Una liquidación guarda el tipo que se ve, y un corte de la respuesta no la duplica
 * ni borra su comprobante. Al final, los comprobantes de un cobro (las mismas piezas de subida): se nombran por su
 * tipo y su fecha, nunca por el nombre del archivo. Un usuario nuevo por proyecto (celular y escritorio), con el
 * cobro E1 ya registrado y otro sin esquema de reparto (para los comprobantes: no mueve el libro).
 */

const admin = adminClient();

/** Lo que dice la app cuando la llamada a una acción no vuelve: no se sabe si se guardó. */
const UNSURE_TEXT = "Se perdió la conexión y no se sabe si se guardó. Revisa cómo quedó antes de repetirlo.";

let user: TestUser;
/** Un cobro sin esquema de reparto, calculado como en la app: el de los comprobantes. */
const receiptTxId = randomUUID();

test.beforeAll(async () => {
  user = await newUser();
  const client = await signInAal1(user.email, user.password);
  // E1: A 45,15 · B 27,09 · C 18,06. Al Grupo B ya se le pagaron 30,00: su saldo queda en −2,91.
  await saveTransactions(client, [e1Item(user.basics, { reference: "pi_e2e_repartos" })]);
  const today = todayNY(new Date());
  await serverData().createTx(client, {
    id: receiptTxId,
    companyId: user.basics.companyId,
    channelId: null,
    gatewayId: user.basics.gatewayId,
    extraIds: [],
    schemeId: null,
    occurredOn: today,
    occurredAt: wallTimeToInstant(`${today}T12:00`, ZONE),
    currency: "USD",
    grossOriginal: "50.00",
    reference: "pi_e2e_comprobantes",
    note: null,
  });
  await client
    .from("pay_settlements")
    .insert({
      beneficiary_id: user.basics.beneficiaryIds.b,
      paid_on: "2026-11-14",
      currency: "USD",
      amount: "30.00",
      method: "Transferencia",
    })
    .throwOnError();
});

test.beforeEach(async ({ page }) => {
  await login(page, user);
});

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

/**
 * axe sin violaciones serias y nada que se desborde. Antes se espera a que terminen las transiciones (la entrada de
 * un aviso pasajero): a medio aparecer, su texto todavía es translúcido y axe lo mide sin el contraste final.
 */
async function expectCleanScreen(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
  );
  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page);
}

/** El renglón de un beneficiario en el libro. */
const ledgerEntry = (page: Page, name: string) =>
  page.getByRole("region", { name: "Libro" }).getByRole("listitem").filter({ hasText: name });

test("el libro: asignado, liquidado y saldo por beneficiario; un saldo negativo dice «a favor de la empresa»", async ({
  page,
}) => {
  await page.goto("/pasarelas/repartos");
  await expect(page.getByRole("heading", { level: 1, name: "Repartos" })).toBeVisible();

  const a = ledgerEntry(page, "Grupo A");
  await expect(a.getByText("Asignado")).toBeVisible();
  await expect(a).toContainText("$45,15");
  await expect(a).not.toContainText("a favor de la empresa");

  const b = ledgerEntry(page, "Grupo B");
  await expect(b).toContainText("$27,09");
  await expect(b).toContainText("$30,00");
  await expect(b).toContainText("-$2,91");
  await expect(b).toContainText("a favor de la empresa");

  // Los esquemas y los beneficiarios, en la misma pantalla.
  await expect(page.getByRole("region", { name: "Esquemas" })).toContainText("Reparto 50/30/20");
  await expect(page.getByRole("region", { name: "Beneficiarios" }).getByRole("link", { name: "Grupo C" })).toBeVisible();
  await expectCleanScreen(page);
});

test("armar un esquema 50/30/20; con 50/30 y sin «Resto» no se guarda y dice por qué; con «Resto» sí", async ({
  page,
}) => {
  await page.goto("/pasarelas/repartos");
  await page.getByRole("link", { name: "Nuevo esquema" }).click();
  await expect(page).toHaveURL(/\/pasarelas\/repartos\/esquemas\/nuevo$/);
  await expect(page.getByRole("heading", { level: 1, name: "Nuevo esquema" })).toBeVisible();

  await page.getByLabel("Nombre del esquema").fill("Socios Demo");
  const line = (n: number) => page.getByRole("group", { name: `Línea ${n}` });
  await line(1).getByLabel("Beneficiario").selectOption({ label: "Grupo A" });
  await line(1).getByLabel("Porcentaje").fill("50");
  await page.getByRole("button", { name: "Agregar línea" }).click();
  await line(2).getByLabel("Beneficiario").selectOption({ label: "Grupo B" });
  await line(2).getByLabel("Porcentaje").fill("30");
  await page.getByRole("button", { name: "Agregar línea" }).click();
  await line(3).getByLabel("Beneficiario").selectOption({ label: "Grupo C" });
  await line(3).getByLabel("Porcentaje").fill("20");

  const sum = page.getByTestId("suma-esquema");
  const save = page.getByRole("button", { name: "Guardar esquema" });
  await expect(sum).toHaveText("Suman 100 %");
  await expect(save).toBeEnabled();
  await expectCleanScreen(page);

  // Sin el Grupo C quedan 50/30: suma 80 % y nadie recibe el resto.
  await page.getByRole("button", { name: "Quitar la línea 3" }).click();
  await expect(sum).toHaveText("Suman 80 %");
  await expect(page.getByText(SCHEME_ISSUE_TEXT.suma_menor_sin_resto)).toBeVisible();
  await expect(save).toBeDisabled();
  await expectCleanScreen(page);

  // Con «Resto» para el Grupo C sí se puede.
  await page.getByLabel("Resto").selectOption({ label: "Grupo C" });
  await expect(page.getByText(SCHEME_ISSUE_TEXT.suma_menor_sin_resto)).toBeHidden();
  await expect(page.getByText("El resto, 20 %, va a Grupo C.")).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page).toHaveURL(/\/pasarelas\/repartos\/esquemas\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Socios Demo" })).toBeVisible();
  const current = page.getByRole("region", { name: "Vigente hoy" });
  await expect(current).toContainText("Grupo A");
  await expect(current).toContainText("50 %");
  await expect(current).toContainText("Grupo B");
  await expect(current).toContainText("30 %");
  await expect(current).toContainText("Resto: Grupo C");
  await expect(current).toContainText("Desde el inicio");
  await expectCleanScreen(page);
});

test("si Desactivar falla desde la cabecera se dice ahí mismo, y el diálogo de borrar no hereda ese error", async ({
  page,
}, testInfo) => {
  // Un beneficiario propio de este proyecto (celular o escritorio), que se borra por detrás con la ficha abierta.
  const name = `Grupo Demo ${testInfo.project.name}`;
  const { data: created } = await admin
    .from("pay_beneficiaries")
    .insert({ user_id: user.id, name })
    .select("id")
    .single()
    .throwOnError();
  await page.goto(`/pasarelas/repartos/beneficiarios/${created.id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await admin.from("pay_beneficiaries").delete().eq("id", created.id).throwOnError();

  await page.getByRole("button", { name: "Desactivar" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Ese beneficiario ya no existe." });
  await expect(alert).toBeVisible();
  await expectCleanScreen(page);

  // Borrar abre su diálogo con su propia explicación, no con el error de Desactivar.
  await page.getByRole("button", { name: "Borrar" }).click();
  const dialog = page.getByRole("alertdialog", { name: `¿Borrar «${name}»?` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Si ya no le repartes, desactívalo");
  await expect(dialog).not.toContainText("Ese beneficiario ya no existe.");
  await expect(alert).toBeHidden();
});

test("guardar un beneficiario nuevo: si se corta la conexión, el diálogo sigue abierto con lo escrito y ofrece «Ver cómo quedó»", async ({
  page,
}, testInfo) => {
  const name = `Socio Sin Red ${testInfo.project.name}`;
  await page.goto("/pasarelas/repartos");
  await expect(page.getByRole("heading", { level: 1, name: "Repartos" })).toBeVisible();
  await page.getByRole("button", { name: "Agregar beneficiario" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo beneficiario" });
  await dialog.getByLabel("Nombre").fill(name);
  await dialog.getByLabel("Alias de la cuenta").fill("Cuenta de Socio Demo");

  // Solo se corta el POST de la acción: la pantalla y sus recursos siguen llegando.
  const screen = "**/pasarelas/repartos";
  await page.route(screen, (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  await dialog.getByRole("button", { name: "Guardar beneficiario" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(UNSURE_TEXT);
  await expect(dialog.getByRole("button", { name: "Ver cómo quedó" })).toBeVisible();
  await expect(dialog.getByLabel("Nombre")).toHaveValue(name);
  await expect(dialog.getByLabel("Alias de la cuenta")).toHaveValue("Cuenta de Socio Demo");
  await expectCleanScreen(page);
  await page.unroute(screen);
});

test("desactivar un beneficiario desde su ficha: si se corta la conexión, se dice ahí mismo con «Ver cómo quedó»", async ({
  page,
}, testInfo) => {
  const name = `Socio Desconectado ${testInfo.project.name}`;
  const id = await freshBeneficiary(name);
  const url = `/pasarelas/repartos/beneficiarios/${id}`;
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.route(`**${url}`, (route) =>
    route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.getByRole("button", { name: "Desactivar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: UNSURE_TEXT })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver cómo quedó" })).toBeVisible();
  // La ficha sigue en pantalla: el fallo no subió a la pantalla de error.
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("region", { name: "Registrar liquidación" })).toBeVisible();
  await expectCleanScreen(page);
  await page.unroute(`**${url}`);
});

test("borrar un beneficiario sin historia lleva a Repartos y ya no aparece", async ({ page }, testInfo) => {
  const name = `Socio Para Borrar ${testInfo.project.name}`;
  const id = await freshBeneficiary(name);
  await page.goto(`/pasarelas/repartos/beneficiarios/${id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.getByRole("button", { name: "Borrar" }).click();
  await page.getByRole("alertdialog", { name: `¿Borrar «${name}»?` }).getByRole("button", { name: "Borrar" }).click();
  await expect(page).toHaveURL((target) => target.pathname === "/pasarelas/repartos");
  await expect(page.getByRole("heading", { level: 1, name: "Repartos" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Beneficiarios" }).getByRole("link", { name })).toHaveCount(0);
  const { data } = await admin.from("pay_beneficiaries").select("id").eq("id", id).throwOnError();
  expect(data).toEqual([]);
});

test("registrar una liquidación de 45,15 al Grupo A con comprobante: su saldo baja a cero", async ({ page }) => {
  await page.goto("/pasarelas/repartos");
  await page.getByRole("region", { name: "Libro" }).getByRole("link", { name: "Grupo A" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Grupo A" })).toBeVisible();

  const balance = page.getByRole("region", { name: "Saldo" });
  await expect(balance.getByTestId("saldo-USD")).toHaveText("$45,15");
  await expectCleanScreen(page);

  const form = page.getByRole("region", { name: "Registrar liquidación" });
  await form.getByLabel("Monto").fill("45,15");
  await form.getByLabel("Medio").fill("Transferencia");
  await form.getByLabel("Elegir archivo").setInputFiles({
    name: "liquidacion-demo.png",
    mimeType: "image/png",
    buffer: png(800, 400),
  });
  await expect(form).toContainText("liquidacion-demo.png");
  await form.getByRole("button", { name: "Registrar liquidación" }).click();

  await expect(page.getByText("Liquidación registrada")).toBeVisible();
  await expect(balance.getByTestId("saldo-USD")).toHaveText("$0,00");
  const settlements = page.getByRole("region", { name: "Liquidaciones" });
  await expect(settlements).toContainText("$45,15");
  await expect(settlements).toContainText("Transferencia");
  await expect(settlements.getByRole("button", { name: "Ver comprobante" })).toBeVisible();
  await expectCleanScreen(page);

  // El comprobante quedó en la carpeta de la liquidación.
  const { data } = await admin
    .from("pay_settlements")
    .select("id, receipt_path, receipt_mime")
    .eq("beneficiary_id", user.basics.beneficiaryIds.a)
    .single()
    .throwOnError();
  expect(data.receipt_path?.startsWith(`${user.id}/${data.id}/`)).toBe(true);
  const { data: files } = await admin.storage.from("comprobantes").list(`${user.id}/${data.id}`);
  expect(files).toHaveLength(1);

  // Y se puede ver.
  await settlements.getByRole("button", { name: "Ver comprobante" }).click();
  const viewer = page.getByRole("dialog", { name: "Comprobante" });
  await expect(viewer.getByRole("img", { name: "Comprobante de la liquidación" })).toBeVisible();
  await expectCleanScreen(page);
});

/**
 * Corta la respuesta de la primera Server Action que se mande desde `url`: llega al servidor y se aplica, pero la
 * respuesta no vuelve al navegador. Devuelve cuántas cortó.
 */
async function cutFirstActionResponse(page: Page, url: string): Promise<() => number> {
  let cut = 0;
  await page.route(`**${url}`, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] !== undefined && cut === 0) {
      cut += 1;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  return () => cut;
}

/** Un beneficiario propio de este proyecto (celular o escritorio), sin movimientos. Devuelve su id. */
async function freshBeneficiary(name: string): Promise<string> {
  const { data } = await admin
    .from("pay_beneficiaries")
    .insert({ user_id: user.id, name })
    .select("id")
    .single()
    .throwOnError();
  return data.id;
}

/** Las liquidaciones de un beneficiario, de la más vieja a la más nueva, como las dejó la base. */
async function settlementsOf(beneficiaryId: string) {
  const { data } = await admin
    .from("pay_settlements")
    .select("id, amount::text, receipt_path")
    .eq("beneficiary_id", beneficiaryId)
    .order("created_at")
    .throwOnError();
  return data;
}

test("el «Tipo» que se ve es el que se guarda, también tras un error y tras guardar; una devolución entra en negativo", async ({
  page,
}, testInfo) => {
  const name = `Socio Demo ${testInfo.project.name}`;
  const id = await freshBeneficiary(name);
  await page.goto(`/pasarelas/repartos/beneficiarios/${id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const form = page.getByRole("region", { name: "Registrar liquidación" });
  const kind = form.getByLabel("Tipo");
  const amount = form.getByLabel("Monto");
  const submit = form.getByRole("button", { name: "Registrar liquidación" });

  // Un monto que no vale: se rechaza y el tipo sigue siendo el elegido.
  await kind.selectOption({ label: "Devolución a la empresa" });
  await amount.fill("abc");
  await submit.click();
  await expect(form.getByText("Monto no válido")).toBeVisible();
  await expect(kind).toHaveValue("devolucion");
  await expectCleanScreen(page);

  // Corregido, se guarda como devolución: monto negativo, y el saldo queda a favor del beneficiario.
  await amount.fill("10,00");
  await submit.click();
  await expect(page.getByText("Liquidación registrada")).toBeVisible();
  await expect(page.getByRole("region", { name: "Saldo" }).getByTestId("saldo-USD")).toHaveText("$10,00");
  const settlements = page.getByRole("region", { name: "Liquidaciones" });
  await expect(settlements).toContainText("Devolución");
  await expect(settlements).toContainText("-$10,00");
  // El botón de borrar dice «la devolución de $10,00», sin el signo menos.
  await expect(settlements.getByRole("button", { name: /^Borrar la devolución de \$10,00 del / })).toBeVisible();
  // Tras guardar, el tipo que se ve sigue siendo el que se va a guardar.
  await expect(kind).toHaveValue("devolucion");
  await expectCleanScreen(page);

  // La siguiente, sin tocar el tipo, también es una devolución; y si se cambia a pago, es un pago.
  await amount.fill("5");
  await submit.click();
  await expect(settlements).toContainText("-$5,00");
  await expect(kind).toHaveValue("devolucion");
  await kind.selectOption({ label: "Pago al beneficiario" });
  await amount.fill("2");
  await submit.click();
  await expect(settlements).toContainText("$2,00");
  await expect(kind).toHaveValue("pago");
  expect((await settlementsOf(id)).map((row) => row.amount)).toEqual(["-10.00", "-5.00", "2.00"]);
});

test("si la respuesta se corta al registrar, se avisa sin perder el formulario; el reintento no duplica nada", async ({
  page,
}, testInfo) => {
  const name = `Socio Corte ${testInfo.project.name}`;
  const id = await freshBeneficiary(name);
  const url = `/pasarelas/repartos/beneficiarios/${id}`;
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const form = page.getByRole("region", { name: "Registrar liquidación" });
  await form.getByLabel("Monto").fill("12,34");
  await form.getByLabel("Elegir archivo").setInputFiles({ name: "pago-demo.png", mimeType: "image/png", buffer: png(400, 200) });

  // La acción llega al servidor y se guarda, pero la respuesta no vuelve al navegador.
  let cut = 0;
  await page.route(`**${url}`, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"] !== undefined && cut === 0) {
      cut += 1;
      await route.fetch();
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await form.getByRole("button", { name: "Registrar liquidación" }).click();

  await expect(form.getByRole("alert")).toHaveText(
    "No se pudo confirmar si la liquidación quedó registrada. Revisa la lista de liquidaciones antes de volver a registrarla.",
  );
  expect(cut).toBe(1);
  await expect(form.getByLabel("Monto")).toHaveValue("12,34");
  const [saved] = await settlementsOf(id);
  expect(saved?.amount).toBe("12.34");
  // El comprobante no se borró: puede ser (y es) de la liquidación que sí quedó.
  const folder = `${user.id}/${saved?.id}`;
  const files = async () => (await admin.storage.from("comprobantes").list(folder)).data?.map((file) => file.name);
  expect(await files()).toEqual([saved?.receipt_path?.slice(folder.length + 1)]);
  await expectCleanScreen(page);

  // Reintentar con lo mismo la da por registrada: sigue habiendo una sola, con su único comprobante.
  await page.unroute(`**${url}`);
  await form.getByRole("button", { name: "Registrar liquidación" }).click();
  await expect(page.getByText("Liquidación registrada")).toBeVisible();
  await expect(page.getByRole("region", { name: "Liquidaciones" })).toContainText("$12,34");
  expect(await settlementsOf(id)).toEqual([saved]);
  expect(await files()).toHaveLength(1);
  await expectCleanScreen(page);
});

test("si tras un corte se reintenta con otro monto, se dice que quedó la del primer intento y la lista lo enseña", async ({
  page,
}, testInfo) => {
  const name = `Socio Reintento ${testInfo.project.name}`;
  const id = await freshBeneficiary(name);
  const url = `/pasarelas/repartos/beneficiarios/${id}`;
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const form = page.getByRole("region", { name: "Registrar liquidación" });
  const settlements = page.getByRole("region", { name: "Liquidaciones" });
  const submit = form.getByRole("button", { name: "Registrar liquidación" });
  await form.getByLabel("Monto").fill("500,00");

  const cuts = await cutFirstActionResponse(page, url);
  await submit.click();
  await expect(form.getByRole("alert")).toContainText("No se pudo confirmar si la liquidación quedó registrada.");
  expect(cuts()).toBe(1);
  await expect(settlements).not.toContainText("$500,00");

  // Cree que no quedó y corrige el monto: no se da por bueno, y la lista enseña la que sí quedó.
  await form.getByLabel("Monto").fill("50,00");
  await submit.click();
  await expect(form.getByRole("alert")).toHaveText(SETTLEMENT_ALREADY_SAVED_TEXT);
  await expect(settlements).toContainText("$500,00");
  await expect(page.getByText("Liquidación registrada")).toBeHidden();
  expect((await settlementsOf(id)).map((row) => row.amount)).toEqual(["500.00"]);
  await expectCleanScreen(page);

  // Registrar otra vez ya es otra liquidación: la de 50,00 se guarda aparte.
  await submit.click();
  await expect(page.getByText("Liquidación registrada")).toBeVisible();
  await expect(settlements).toContainText("$50,00");
  expect((await settlementsOf(id)).map((row) => row.amount)).toEqual(["500.00", "50.00"]);
});

test("el PDF de una liquidación se firma al tocar «Ver comprobante» y se abre en otra pestaña", async ({
  page,
}, testInfo) => {
  const name = `Socio PDF ${testInfo.project.name}`;
  const id = await freshBeneficiary(name);
  await page.goto(`/pasarelas/repartos/beneficiarios/${id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const form = page.getByRole("region", { name: "Registrar liquidación" });
  await form.getByLabel("Monto").fill("8,00");
  await form.getByLabel("Elegir archivo").setInputFiles({
    name: "pago-demo.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n%demo\n"),
  });
  await form.getByRole("button", { name: "Registrar liquidación" }).click();
  await expect(page.getByText("Liquidación registrada")).toBeVisible();
  const [saved] = await settlementsOf(id);

  const settlements = page.getByRole("region", { name: "Liquidaciones" });
  const signed = page
    .context()
    .waitForEvent("request", (request) => request.url().includes("/storage/v1/object/sign/comprobantes/"));
  const popup = page.waitForEvent("popup");
  await settlements.getByRole("button", { name: "Ver comprobante (se abre en otra pestaña)" }).click();
  expect((await signed).url()).toContain(saved?.receipt_path ?? "sin ruta");
  await (await popup).close();
  await expectCleanScreen(page);
});

test("si la respuesta se corta al borrar una liquidación, se avisa ahí mismo y «Ver cómo quedó» lo enseña", async ({
  page,
}, testInfo) => {
  const name = `Socio Borrar ${testInfo.project.name}`;
  const id = await freshBeneficiary(name);
  await admin
    .from("pay_settlements")
    .insert({ user_id: user.id, beneficiary_id: id, paid_on: "2026-11-14", currency: "USD", amount: "9.00" })
    .throwOnError();
  const url = `/pasarelas/repartos/beneficiarios/${id}`;
  await page.goto(url);
  const settlements = page.getByRole("region", { name: "Liquidaciones" });
  await expect(settlements).toContainText("$9,00");

  const cuts = await cutFirstActionResponse(page, url);
  await settlements.getByRole("button", { name: /^Borrar el pago de \$9,00 del / }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar liquidación" }).click();
  await expect(settlements.getByRole("alert")).toContainText("No se pudo confirmar si la liquidación se borró");
  expect(cuts()).toBe(1);
  expect(await settlementsOf(id)).toEqual([]);
  await expectCleanScreen(page);

  await settlements.getByRole("button", { name: "Ver cómo quedó" }).click();
  await expect(settlements).toContainText("Todavía no se le ha pagado nada.");
});

test.describe("los comprobantes de un cobro", () => {
  /** Un PDF mínimo: va tal cual a Storage (las fotos se recodifican), con un nombre que no debe guardarse. */
  const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%demo\n") });

  /** Los comprobantes del cobro, del más viejo al más nuevo, como los dejó la base. */
  async function receipts() {
    const { data } = await admin
      .from("pay_transaction_receipts")
      .select("id, path, mime, created_at")
      .eq("transaction_id", receiptTxId)
      .order("created_at")
      .throwOnError();
    return data;
  }

  test("se nombran por su tipo y su fecha, no por el archivo; «Ver» y «Quitar» dicen cuál; un PDF se firma al tocarlo", async ({
    page,
  }) => {
    await page.goto(`/pasarelas/cobros/${receiptTxId}`);
    const card = page.getByRole("region", { name: "Comprobantes" });
    await expect(card).toContainText("Sin comprobantes");
    for (const name of ["Recibo de Grupo A.pdf", "Pago de Grupo B.pdf"]) {
      await card.getByLabel("Elegir archivo").setInputFiles(pdf(name));
      await expect(page.getByText("Comprobante agregado.")).toBeVisible();
      await expect(page.getByText("Comprobante agregado.")).toBeHidden();
    }
    const items = card.getByRole("list", { name: "Comprobantes" }).getByRole("listitem");
    await expect(items).toHaveCount(2);

    // El nombre del archivo no se guarda (no hay dónde) ni se ve.
    const rows = await receipts();
    await expect(card).not.toContainText("Grupo A");
    await expect(card).not.toContainText("Grupo B");
    const labels = rows.map((row) => receiptLabel({ mime: row.mime, createdAt: row.created_at }));
    await expect(items.nth(0)).toContainText(labels[0] ?? "");
    await expect(items.nth(0)).toContainText("PDF · 15 B");
    await expect(items.nth(1).getByRole("button", { name: `Quitar Comprobante 2: ${labels[1]}` })).toBeVisible();
    await expectCleanScreen(page);

    // La URL firmada del PDF se pide al tocar «Ver», y el PDF se abre en otra pestaña.
    const signed = page
      .context()
      .waitForEvent("request", (request) => request.url().includes("/storage/v1/object/sign/comprobantes/"));
    const popup = page.waitForEvent("popup");
    await items
      .nth(0)
      .getByRole("button", { name: `Ver Comprobante 1: ${labels[0]} (se abre en otra pestaña)` })
      .click();
    expect((await signed).url()).toContain(rows[0]?.path ?? "sin ruta");
    await (await popup).close();
  });

  test("si la respuesta se corta al registrarlo, el archivo no se borra y se pide revisar antes de repetir", async ({
    page,
  }) => {
    const url = `/pasarelas/cobros/${receiptTxId}`;
    await page.goto(url);
    const before = (await receipts()).length;
    const card = page.getByRole("region", { name: "Comprobantes" });
    let cut = 0;
    await page.route(`**${url}`, async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] !== undefined && cut === 0) {
        cut += 1;
        await route.fetch();
        await route.abort("connectionreset");
        return;
      }
      await route.continue();
    });
    await card.getByLabel("Elegir archivo").setInputFiles(pdf("Factura demo.pdf"));

    await expect(card.getByRole("alert")).toContainText(
      "No se pudo confirmar si el comprobante quedó guardado. Revisa los comprobantes antes de volver a subirlo.",
    );
    expect(cut).toBe(1);
    // Hasta ver cómo quedó no se puede volver a subir: el mismo archivo quedaría dos veces.
    await expect(card.getByLabel("Elegir archivo")).toHaveCount(0);
    // Quedó registrado y su archivo sigue en Storage.
    const rows = await receipts();
    expect(rows).toHaveLength(before + 1);
    const last = rows.at(-1)?.path ?? "";
    const folder = last.slice(0, last.lastIndexOf("/"));
    const { data: files } = await admin.storage.from("comprobantes").list(folder);
    expect(files?.map((file) => file.name)).toContain(last.slice(folder.length + 1));
    await expectCleanScreen(page);

    // «Ver cómo quedó» lo enseña, y ya se puede subir otro.
    await page.unroute(`**${url}`);
    await card.getByRole("button", { name: "Ver cómo quedó" }).click();
    await expect(card.getByRole("list", { name: "Comprobantes" }).getByRole("listitem")).toHaveCount(before + 1);
    await expect(card.getByLabel("Elegir archivo")).toBeVisible();
    await expect(card.getByRole("alert")).toHaveCount(0);
  });

  test("si la respuesta se corta al quitar uno, se avisa en la tarjeta y «Ver cómo quedó» lo enseña", async ({
    page,
  }) => {
    const url = `/pasarelas/cobros/${receiptTxId}`;
    await page.goto(url);
    const card = page.getByRole("region", { name: "Comprobantes" });
    const items = card.getByRole("list", { name: "Comprobantes" }).getByRole("listitem");
    // Uno propio, para no depender de lo que dejaron las pruebas anteriores.
    await card.getByLabel("Elegir archivo").setInputFiles(pdf("Recibo para quitar.pdf"));
    await expect(page.getByText("Comprobante agregado.")).toBeVisible();
    const before = (await receipts()).length;
    await expect(items).toHaveCount(before);

    const cuts = await cutFirstActionResponse(page, url);
    await items.first().getByRole("button", { name: /^Quitar / }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Quitar comprobante" }).click();
    await expect(card.getByRole("alert")).toContainText("No se pudo confirmar si el comprobante se quitó");
    expect(cuts()).toBe(1);
    expect(await receipts()).toHaveLength(before - 1);
    await expectCleanScreen(page);

    await page.unroute(`**${url}`);
    await card.getByRole("button", { name: "Ver cómo quedó" }).click();
    await expect(items).toHaveCount(before - 1);
    await expect(card.getByRole("alert")).toHaveCount(0);
  });
});
