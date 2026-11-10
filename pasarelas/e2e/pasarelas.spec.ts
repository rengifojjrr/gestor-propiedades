import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { ZONE, addDays, todayNY, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import { signInAal1, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * Pasarelas: la lista, el alta de «PayPal Demo» con su opción, y el «Listo cuando» n.º 3 (una tarifa «vigente desde
 * mañana» no mueve lo ya registrado). Corre en el celular y en el escritorio, con un usuario nuevo en cada uno.
 */

let user: TestUser;
let client: Db;

test.beforeAll(async () => {
  user = await newUser();
  client = await signInAal1(user.email, user.password);
});

/** Registra un cobro de 100,00 USD con Stripe (sin opciones, canal ni esquema) el día `on`, al mediodía de Nueva York. */
async function charge(on: string, extra: { status?: "depositado"; depositedOn?: string } = {}): Promise<string> {
  const id = randomUUID();
  await serverData().createTx(client, {
    id,
    companyId: user.basics.companyId,
    channelId: null,
    gatewayId: user.basics.gatewayId,
    extraIds: [],
    schemeId: null,
    occurredOn: on,
    occurredAt: wallTimeToInstant(`${on}T12:00`, ZONE),
    currency: "USD",
    grossOriginal: "100.00",
    reference: null,
    note: null,
    ...extra,
  });
  return id;
}

/** La línea «pasarela» del desglose congelado del cobro, como la guarda la base. */
async function gatewayLine(id: string): Promise<string | undefined> {
  const [tx] = await serverData().getSnapshots(client, [id]);
  return tx?.breakdown.lines.find((line) => line.kind === "pasarela")?.amount;
}

async function checkScreen(page: Page): Promise<void> {
  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page);
}

test("la lista muestra la tarifa vigente, los días al depósito y el tiempo real", async ({ page }) => {
  const today = todayNY(new Date());
  await charge(addDays(today, -10), { status: "depositado", depositedOn: addDays(today, -8) });
  await charge(addDays(today, -9), { status: "depositado", depositedOn: addDays(today, -5) });

  await login(page, user);
  await page.goto("/pasarelas/pasarelas");
  await expect(page.getByRole("heading", { level: 1, name: "Pasarelas" })).toBeVisible();
  const stripe = page.getByRole("article", { name: "Stripe" });
  await expect(stripe).toContainText("2,9 % + 0,30");
  await expect(stripe).toContainText("2 días hábiles");
  await expect(stripe).toContainText("Promedio 3 días · mediana 3 días");
  await expect(page.getByRole("link", { name: "Agregar pasarela" })).toBeVisible();
  await checkScreen(page);
});

test("crear «PayPal Demo» 3,49 % + 0,49 con la opción «Transferencia inmediata» 1,75 %", async ({ page }) => {
  await login(page, user);
  await page.goto("/pasarelas/pasarelas");
  await page.getByRole("link", { name: "Agregar pasarela" }).click();
  await expect(page).toHaveURL(/\/pasarelas\/pasarelas\/nueva$/);
  await expect(page.getByRole("heading", { level: 1, name: "Agregar pasarela" })).toBeVisible();

  await page.getByLabel("Nombre", { exact: true }).fill("PayPal Demo");
  await page.getByLabel("Comisión", { exact: true }).fill("3,49");
  await page.getByLabel("Cuota fija", { exact: true }).fill("0,49");
  await page.getByLabel("Días al depósito").fill("1");
  await page.getByLabel("Tipo de días").selectOption("habiles");
  await page.getByLabel("Devuelve la comisión si reembolsas").check();
  await page.getByLabel("Costo por disputa").fill("20");
  await expect(page.getByText("Un solo costo, que se revierte si la disputa se gana.")).toBeVisible();

  await page.getByRole("button", { name: "Agregar opción" }).click();
  const option = page.getByRole("group", { name: "Opción 1" });
  await option.getByLabel("Nombre de la opción").fill("Transferencia inmediata");
  await option.getByLabel("Porcentaje").fill("1,75");
  await checkScreen(page);

  await page.getByRole("button", { name: "Crear pasarela" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "PayPal Demo" })).toBeVisible();
  await expect(page).toHaveURL(/\/pasarelas\/pasarelas\/[0-9a-f-]{36}$/);

  const fees = page.getByRole("region", { name: "Tarifas" });
  const first = fees.getByRole("listitem").filter({ hasText: "Desde el inicio" });
  await expect(first).toContainText("3,49 % + 0,49");
  await expect(first).toContainText("Vigente");
  const extra = page.getByRole("group", { name: "Transferencia inmediata" });
  await expect(extra).toContainText("1,75 %");
  await expect(extra.getByRole("switch", { name: "Encendida por defecto" })).not.toBeChecked();
  await checkScreen(page);

  await page.getByRole("main").getByRole("link", { name: "Pasarelas" }).click();
  await expect(page.getByRole("article", { name: "PayPal Demo" })).toContainText("3,49 % + 0,49");
  await expect(page.getByRole("article", { name: "PayPal Demo" })).toContainText("1 día hábil");
});

test("«Listo cuando» n.º 3: una tarifa vigente desde mañana no cambia el cobro ya registrado", async ({ page }) => {
  const today = todayNY(new Date());
  const tomorrow = addDays(today, 1);
  const before = await charge(today);
  expect(await gatewayLine(before)).toBe("3.20");

  await login(page, user);
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
  await expect(fees.getByRole("listitem").filter({ hasText: "Desde el inicio" })).toContainText("Vigente");
  await checkScreen(page);

  // Lo ya registrado conserva su tarifa congelada; un cobro de mañana usa la nueva.
  expect(await gatewayLine(before)).toBe("3.20");
  const after = await charge(tomorrow);
  expect(await gatewayLine(after)).toBe("3.80");
});

test("Foco 5: lo que tiene cobros no se borra; se desactiva", async ({ page }) => {
  await charge(todayNY(new Date()));
  // Una segunda tarifa, para que la primera (la que usó el cobro) ofrezca «Borrar»: la única no se ofrece.
  const { error } = await client
    .from("pay_gateway_fee_versions")
    .insert({ gateway_id: user.basics.gatewayId, pct: "4", fixed: "0.30", effective_from: "2030-01-01" });
  expect(error).toBeNull();
  await login(page, user);
  await page.goto("/pasarelas/pasarelas");
  await page.getByRole("article", { name: "Stripe" }).getByRole("link", { name: "Stripe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Stripe" })).toBeVisible();

  await page.getByRole("button", { name: "Borrar pasarela" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar pasarela" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Tiene cobros: desactívala en su lugar" })).toBeVisible();

  const fees = page.getByRole("region", { name: "Tarifas" });
  await fees.getByRole("listitem").filter({ hasText: "Desde el inicio" }).getByRole("button", { name: "Borrar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Borrar tarifa" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Esta tarifa ya se usó en cobros: agrega una nueva con otra fecha" }),
  ).toBeVisible();
  await checkScreen(page);

  await page.getByRole("button", { name: "Desactivar" }).click();
  await expect(page.getByRole("button", { name: "Activar" })).toBeVisible();
  await expect(page.getByText("Inactiva", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activar" }).click();
  await expect(page.getByRole("button", { name: "Desactivar" })).toBeVisible();
});

test("opciones con su interruptor y su diálogo, y los datos de la pasarela", async ({ page }) => {
  await login(page, user);
  await page.goto("/pasarelas/pasarelas");
  await page.getByRole("article", { name: "Stripe" }).getByRole("link", { name: "Stripe" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Stripe" })).toBeVisible();

  // «Encendida por defecto» rige al tocarlo.
  const fast = page.getByRole("group", { name: "Pago rápido" });
  await expect(fast).toContainText("1,5 % + 0,00");
  await fast.getByRole("switch", { name: "Encendida por defecto" }).click();
  await expect(fast.getByRole("switch", { name: "Encendida por defecto" })).toBeChecked();
  await expect(fast.getByRole("switch", { name: "Encendida por defecto" })).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("group", { name: "Pago rápido" }).getByRole("switch", { name: "Encendida por defecto" }),
  ).toBeChecked();

  // Una opción nueva, desde su diálogo.
  await page.getByRole("region", { name: "Opciones" }).getByRole("button", { name: "Agregar opción" }).click();
  const dialog = page.getByRole("dialog", { name: "Agregar opción" });
  await dialog.getByLabel("Nombre de la opción").fill("Seguro Demo");
  await dialog.getByLabel("Porcentaje").fill("0");
  await dialog.getByLabel("Cuota fija").fill("1,00");
  await dialog.getByLabel("Se calcula").selectOption("despues_de_comision");
  await checkScreen(page);
  await dialog.getByRole("button", { name: "Agregar opción" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("group", { name: "Seguro Demo" })).toContainText("0 % + 1,00");

  // Los datos se editan en su tarjeta.
  const data = page.getByRole("region", { name: "Datos" });
  await data.getByLabel("Días al depósito").fill("3");
  await data.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("region", { name: "Tiempo real de depósito" })).toContainText("3 días hábiles");
  await page.reload();
  await expect(page.getByRole("region", { name: "Datos" }).getByLabel("Días al depósito")).toHaveValue("3");
  await checkScreen(page);
});
