import { expect, test, type Page } from "@playwright/test";
import { todayNY } from "../src/lib/pasarelas/dates";
import { adminClient, e1Item, saveTransactions, signInAal1 } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Cuentas destino y feriados: crear una cuenta (el alias no admite un número de cuenta y los últimos 4 no pasan de
 * 4), ver lo que cae en cada una, desactivarla en vez de borrarla, y cargar los feriados bancarios de un año una
 * sola vez. Un usuario nuevo por archivo (y por proyecto: celular y escritorio).
 */

let user: TestUser;
const admin = adminClient();

test.beforeAll(async () => {
  user = await newUser();
});

test.beforeEach(async ({ page }) => {
  await login(page, user);
});

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

test("crear una cuenta: el alias rechaza un número de cuenta y los últimos 4 no pasan de 4 dígitos", async ({ page }) => {
  await page.goto("/pasarelas/cuentas");
  await expect(page.getByRole("heading", { level: 1, name: "Cuentas destino" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Cuenta principal" })).toContainText("4321");
  await expectCleanScreen(page);

  await page.getByRole("button", { name: "Agregar cuenta" }).click();
  const dialog = page.getByRole("dialog", { name: "Nueva cuenta destino" });
  await expect(dialog).toBeVisible();

  // Pegar un número de cuenta en el alias.
  const alias = dialog.getByLabel("Alias");
  await alias.fill("1234567890");
  // El campo de los últimos 4 no deja escribir más de 4 dígitos.
  const last4 = dialog.getByLabel("Últimos 4");
  await last4.pressSequentially("123456");
  await expect(last4).toHaveValue("1234");
  await dialog.getByRole("button", { name: "Guardar cuenta" }).click();
  await expect(dialog.getByText("No guardes números de cuenta completos")).toBeVisible();
  await expect(alias).toHaveAttribute("aria-invalid", "true");
  await expect(last4).toHaveValue("1234");
  await expectCleanScreen(page);

  // El servidor también lo exige: sin el tope del campo, 5 dígitos no pasan.
  await alias.fill("Cuenta Demo");
  await last4.evaluate((input) => input.removeAttribute("maxlength"));
  await last4.fill("12345");
  await dialog.getByRole("button", { name: "Guardar cuenta" }).click();
  await expect(dialog.getByText("Son los últimos 4 dígitos: exactamente 4 números")).toBeVisible();
  await expect(alias).toHaveValue("Cuenta Demo");

  await last4.fill("1234");
  await dialog.getByLabel("Banco o billetera").fill("Banco Demo");
  await dialog.getByRole("button", { name: "Guardar cuenta" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Cuenta guardada.")).toBeVisible();
  const created = page.getByRole("region", { name: "Cuenta Demo" });
  await expect(created).toContainText("Banco Demo");
  await expect(created).toContainText("1234");
  await expect(created).toContainText("Todavía no hay cobros con esta cuenta");
  await expectCleanScreen(page);
});

test("cada cuenta dice lo depositado, lo que está por caer y cuánto tarda; borrarla ofrece desactivarla", async ({
  page,
}) => {
  const client = await signInAal1(user.email, user.password);
  await saveTransactions(client, [
    e1Item(user.basics, { reference: "pi_e2e_cuentas_1", status: "depositado", deposited_on: "2026-11-16" }),
    e1Item(user.basics, { reference: "pi_e2e_cuentas_2" }),
  ]);

  await page.goto("/pasarelas/cuentas");
  const principal = page.getByRole("region", { name: "Cuenta principal" });
  await expect(principal.getByText("Depositado")).toBeVisible();
  await expect(principal).toContainText("$90,30");
  await expect(principal.getByText("Por caer")).toBeVisible();
  await expect(principal).toContainText("Tarda 3 días en promedio");
  await expectCleanScreen(page);

  await principal.getByRole("button", { name: "Borrar" }).click();
  const confirm = page.getByRole("alertdialog", { name: "¿Borrar «Cuenta principal»?" });
  await expect(confirm).toContainText("2 cobros");
  await expectCleanScreen(page);
  // Lo que dice de desactivarla es verdad: la cuenta de Stripe de Escuela Demo la sigue usando.
  await expect(confirm).toContainText("deja de ofrecerse al elegir cuenta");
  await expect(confirm).toContainText(
    "La cuenta de pasarela que la usa la seguirá usando en los cobros nuevos hasta que la cambies en su empresa.",
  );
  await confirm.getByRole("button", { name: "Desactivar" }).click();
  await expect(confirm).toBeHidden();
  await expect(principal.getByText("Inactiva")).toBeVisible();
  await expect(principal.getByRole("button", { name: "Activar" })).toBeVisible();
  // Desactivada no pierde lo suyo.
  await expect(principal).toContainText("$90,30");

  await principal.getByRole("button", { name: "Activar" }).click();
  await expect(principal.getByText("Inactiva")).toBeHidden();
});

test("desactivar una cuenta que usa una cuenta de pasarela avisa antes que los cobros nuevos la seguirán usando", async ({
  page,
}) => {
  await page.goto("/pasarelas/cuentas");
  const principal = page.getByRole("region", { name: "Cuenta principal" });
  await principal.getByRole("button", { name: "Desactivar" }).click();
  const confirm = page.getByRole("alertdialog", { name: "¿Desactivar «Cuenta principal»?" });
  await expect(confirm).toContainText(
    "Es la cuenta destino de 1 cuenta de pasarela: los cobros nuevos de esa empresa la seguirán usando hasta que la cambies en la empresa.",
  );
  await expectCleanScreen(page);
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(principal.getByText("Inactiva")).toBeHidden();

  await principal.getByRole("button", { name: "Desactivar" }).click();
  await confirm.getByRole("button", { name: "Desactivar" }).click();
  await expect(confirm).toBeHidden();
  await expect(principal.getByText("Inactiva")).toBeVisible();

  // La ficha de la empresa lo marca junto a su cuenta de Stripe.
  await page.goto(`/pasarelas/empresas/${user.basics.companyId}`);
  const stripe = page
    .getByRole("region", { name: "Pasarelas de la empresa" })
    .getByRole("listitem")
    .filter({ hasText: "Stripe" });
  await expect(stripe).toContainText("Cuenta principal");
  await expect(stripe.getByText("Cuenta inactiva")).toBeVisible();
  await expectCleanScreen(page);

  await page.goto("/pasarelas/cuentas");
  await principal.getByRole("button", { name: "Activar" }).click();
  await expect(principal.getByText("Inactiva")).toBeHidden();

  // Una que ninguna cuenta de pasarela usa se desactiva sin preguntar.
  const demo = page.getByRole("region", { name: "Cuenta Demo" });
  await demo.getByRole("button", { name: "Desactivar" }).click();
  await expect(demo.getByText("Inactiva")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await demo.getByRole("button", { name: "Activar" }).click();
  await expect(demo.getByText("Inactiva")).toBeHidden();
});

test("un fallo dentro del diálogo de borrar se dice en el diálogo, no detrás de él", async ({ page }, testInfo) => {
  const alias = `Cuenta Borrada ${testInfo.project.name}`;
  const { data: created } = await admin
    .from("pay_bank_accounts")
    .insert({ user_id: user.id, alias })
    .select("id")
    .single()
    .throwOnError();
  await page.goto("/pasarelas/cuentas");
  const card = page.getByRole("region", { name: alias });
  await card.getByRole("button", { name: "Borrar" }).click();
  const confirm = page.getByRole("alertdialog", { name: `¿Borrar «${alias}»?` });
  await expect(confirm).toBeVisible();
  // Se borra por detrás con el diálogo abierto.
  await admin.from("pay_bank_accounts").delete().eq("id", created.id).throwOnError();
  await confirm.getByRole("button", { name: "Borrar" }).click();
  await expect(confirm.getByRole("alert")).toHaveText("Esa cuenta ya no existe.");
  await expectCleanScreen(page);
});

test("feriados: un fallo al quitar uno se dice en su diálogo", async ({ page }) => {
  const { data: created } = await admin
    .from("pay_holidays")
    .insert({ user_id: user.id, day: "2029-03-15", name: "Cierre demo borrado" })
    .select("id")
    .single()
    .throwOnError();
  await page.goto("/pasarelas/feriados?anio=2029");
  await page.getByRole("button", { name: "Quitar Cierre demo borrado" }).click();
  const confirm = page.getByRole("alertdialog", { name: "¿Quitar este feriado?" });
  await expect(confirm).toBeVisible();
  await admin.from("pay_holidays").delete().eq("id", created.id).throwOnError();
  await confirm.getByRole("button", { name: "Quitar" }).click();
  await expect(confirm.getByRole("alert")).toHaveText("Ese feriado ya no existe.");
  await expectCleanScreen(page);
});

test("feriados: cargar los bancarios de 2028 los agrega una sola vez", async ({ page }) => {
  await page.goto("/pasarelas/feriados?anio=2028");
  await expect(page.getByRole("heading", { level: 1, name: "Feriados" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Feriados de 2028" })).toBeVisible();
  await expect(page.getByText("No hay feriados en 2028")).toBeVisible();
  await expectCleanScreen(page);

  const load = page.getByRole("button", { name: "Cargar feriados bancarios de EE. UU. de 2028" });
  const list = page.getByRole("list", { name: "Feriados de 2028" });

  await load.click();
  await expect(page.getByText("Se agregaron 11 feriados.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(11);
  await expect(list).toContainText("Acción de Gracias");
  await expect(page.getByText("11 feriados", { exact: true })).toBeVisible();
  await expectCleanScreen(page);

  await load.click();
  await expect(page.getByText("Ya estaban todos: no se agregó ninguno.")).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(11);

  // A mano: agregar uno y quitarlo.
  await page.getByLabel("Fecha").fill("2028-03-15");
  await page.getByLabel("Nombre").fill("Cierre demo");
  await page.getByRole("button", { name: "Agregar feriado" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(12);
  await list.getByRole("button", { name: "Quitar Cierre demo" }).click();
  const confirm = page.getByRole("alertdialog", { name: "¿Quitar este feriado?" });
  await expect(confirm).toContainText("Cierre demo");
  await confirm.getByRole("button", { name: "Quitar" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(11);
  await expectCleanScreen(page);
});

test("feriados: sin año en la URL se ve el año en curso, y se pasa de un año a otro", async ({ page }) => {
  const year = Number(todayNY(new Date()).slice(0, 4));
  await page.goto("/pasarelas/feriados");
  await expect(page.getByRole("heading", { name: `Feriados de ${year}` })).toBeVisible();

  await page.getByRole("link", { name: `Año siguiente: ${year + 1}` }).click();
  await expect(page).toHaveURL(new RegExp(`anio=${year + 1}`));
  await expect(page.getByRole("heading", { name: `Feriados de ${year + 1}` })).toBeVisible();
});
