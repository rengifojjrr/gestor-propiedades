import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ZONE, addDays, formatDate, todayNY, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import type { Currency, ISODate } from "../src/lib/pasarelas/types";
import { signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * Resumen: el «Listo cuando» n.º 4. Con cobros de dos empresas y dos pasarelas: cuánto facturó cada empresa, las
 * comisiones por pasarela, qué cae en los próximos 14 días y en qué cuenta, y cuánto se le debe a cada grupo; y
 * marcar depositado un grupo desde aquí lo mueve de «por caer» a «depositado». Además, una moneda distinta no se
 * suma con la otra. Corre en el celular y en el escritorio, con un usuario nuevo en cada uno.
 *
 * Hoy (todos en USD salvo uno):
 *  - Escuela Demo · Stripe (2 días hábiles, «Cuenta principal …4321», reparto 50/30/20 sobre el neto):
 *    100,00 → comisión 3,20, neto 96,80 · 200,00 → comisión 6,10, neto 193,90.
 *  - Tienda Demo · PayPal Demo (1 día corrido, «Cuenta de ahorro …7305», sin reparto): 50,00 → comisión 2,24,
 *    neto 47,76; y 80,00 EUR → comisión 3,28, neto 76,72.
 * Hace 40 días (siempre otro mes): Escuela Demo · Stripe 10,00 → neto 9,41, sin depositar: atrasado.
 * Liquidado hoy: 40,00 a Grupo A y 70,00 a Grupo C (más de lo que se le asignó: queda a favor de la empresa).
 * Después, el esquema de Escuela Demo se desactiva: sus cobros nuevos ya no se reparten solos.
 */

let user: TestUser;
let client: Db;
let today: ISODate;
/** La fecha estimada de los cobros de Stripe de hoy y la del de PayPal en USD. */
let stripeOn: ISODate;
let paypalOn: ISODate;
let overdueOn: ISODate;

type Charge = {
  companyId: string;
  gatewayId: string;
  schemeId: string | null;
  gross: string;
  on?: ISODate;
  currency?: Currency;
};

/** Registra un cobro (al mediodía de Nueva York) y devuelve su fecha estimada de depósito. */
async function charge(c: Charge): Promise<ISODate> {
  const id = randomUUID();
  const on = c.on ?? today;
  await serverData().createTx(client, {
    id,
    companyId: c.companyId,
    channelId: null,
    gatewayId: c.gatewayId,
    extraIds: [],
    schemeId: c.schemeId,
    occurredOn: on,
    occurredAt: wallTimeToInstant(`${on}T12:00`, ZONE),
    currency: c.currency ?? "USD",
    grossOriginal: c.gross,
    reference: null,
    note: null,
  });
  const [tx] = await serverData().getSnapshots(client, [id]);
  if (!tx?.estimatedDepositOn) throw new Error("El cobro de prueba quedó sin fecha estimada.");
  return tx.estimatedDepositOn;
}

test.beforeAll(async () => {
  user = await newUser();
  client = await signInAal1(user.email, user.password);
  today = todayNY(new Date());
  const b = user.basics;

  const shopId = unwrap(
    await client.from("pay_companies").insert({ name: "Tienda Demo" }).select("id").single(),
    "Tienda Demo",
  ).id;
  const savingsId = unwrap(
    await client
      .from("pay_bank_accounts")
      .insert({ alias: "Cuenta de ahorro", institution: "Cooperativa Demo", last4: "7305" })
      .select("id")
      .single(),
    "cuenta de ahorro",
  ).id;
  const paypalId = unwrap(
    await client.rpc("pay_create_gateway", {
      p: { name: "PayPal Demo", payout_days: 1, payout_day_type: "corridos", fee: { pct: "3.49", fixed: "0.49" } },
    }),
    "PayPal Demo",
  );
  unwrap(
    await client
      .from("pay_company_gateways")
      .insert({ company_id: shopId, gateway_id: paypalId, bank_account_id: savingsId })
      .select("id")
      .single(),
    "PayPal Demo en Tienda Demo",
  );

  const school = { companyId: b.companyId, gatewayId: b.gatewayId, schemeId: b.schemeId };
  const shop = { companyId: shopId, gatewayId: paypalId, schemeId: null };
  stripeOn = await charge({ ...school, gross: "100.00" });
  await charge({ ...school, gross: "200.00" });
  paypalOn = await charge({ ...shop, gross: "50.00" });
  await charge({ ...shop, gross: "80.00", currency: "EUR" });
  overdueOn = await charge({ ...school, schemeId: null, gross: "10.00", on: addDays(today, -40) });

  unwrap(
    await client
      .from("pay_settlements")
      .insert([
        { beneficiary_id: b.beneficiaryIds.a, paid_on: today, currency: "USD", amount: "40.00" },
        { beneficiary_id: b.beneficiaryIds.c, paid_on: today, currency: "USD", amount: "70.00" },
      ])
      .select("id"),
    "liquidaciones",
  );
  unwrap(
    await client.from("pay_schemes").update({ active: false }).eq("id", b.schemeId).select("id").single(),
    "esquema desactivado",
  );
});

async function checkScreen(page: Page): Promise<void> {
  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page);
}

/** En el celular (menos de 768 px) los filtros van plegados tras el botón «Filtros». */
const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 768;
const filtersButton = (page: Page): Locator => page.getByRole("button", { name: /^Filtros/ });

/** Deja los filtros a la vista: en el celular, abre el botón «Filtros»; desde 768 px ya se ven. */
async function openFilters(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  await filtersButton(page).click();
  await expect(filtersButton(page)).toHaveAttribute("aria-expanded", "true");
}

/** Una tarjeta de cifras por su nombre. */
const card = (page: Page, name: string): Locator => page.getByRole("group", { name, exact: true });

/** Un gráfico (`figure`) por su título, con su tabla de datos ya abierta. */
async function chartTable(page: Page, title: string): Promise<Locator> {
  const figure = page.getByRole("figure", { name: title });
  await figure.getByText("Ver los datos en una tabla").click();
  return figure.getByRole("table");
}

/** Un grupo de próximos depósitos por su fecha y su cuenta. */
const depositGroup = (page: Page, on: ISODate, account: string): Locator =>
  page.getByRole("article", { name: `${formatDate(on)} · ${account}` });

test("cuánto facturó cada empresa, sus comisiones, qué cae y en qué cuenta, y cuánto se le debe a cada grupo", async ({
  page,
}) => {
  await login(page, user);
  await page.goto("/pasarelas");
  await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();

  // Tarjetas del mes en USD: el cobro en EUR no se suma.
  await expect(card(page, "Bruto")).toContainText("$350,00");
  await expect(card(page, "Comisiones")).toContainText("$11,54");
  await expect(card(page, "Comisiones")).toContainText("3,3 %");
  await expect(card(page, "Neto")).toContainText("$338,46");
  await expect(card(page, "Cobros")).toContainText("3");
  await expect(card(page, "Ticket promedio")).toContainText("$116,67");
  await expect(card(page, "Por caer")).toContainText("$338,46");
  await expect(card(page, "Depositado")).toContainText("$0,00");
  await openFilters(page);
  await expect(page.getByLabel("Moneda")).toBeVisible();
  await expect(page.getByText("€80,00")).toHaveCount(0);

  // Cuánto facturó cada empresa.
  const companies = await chartTable(page, "Empresas por lo facturado");
  await expect(companies.getByRole("row", { name: /Escuela Demo/ })).toContainText("$300,00");
  await expect(companies.getByRole("row", { name: /Tienda Demo/ })).toContainText("$50,00");

  // Las comisiones por pasarela y lo que cuestan de verdad.
  const cost = await chartTable(page, "Costo efectivo por pasarela");
  await expect(cost.getByRole("row", { name: /Stripe/ })).toContainText("$9,30");
  await expect(cost.getByRole("row", { name: /Stripe/ })).toContainText("3,1 %");
  await expect(cost.getByRole("row", { name: /PayPal Demo/ })).toContainText("$2,24");
  await expect(cost.getByRole("row", { name: /PayPal Demo/ })).toContainText("4,48 %");

  // Qué cae y en qué cuenta: lo atrasado primero.
  const deposits = page.getByRole("region", { name: "Próximos depósitos" });
  const groups = deposits.getByRole("article");
  await expect(groups).toHaveCount(3);
  await expect(groups.first()).toHaveAccessibleName(`${formatDate(overdueOn)} · Cuenta principal (…4321)`);
  await expect(groups.first()).toContainText("Atrasado");
  await expect(groups.first()).toContainText("$9,41");
  const stripe = depositGroup(page, stripeOn, "Cuenta principal (…4321)");
  await expect(stripe).toContainText("$290,70");
  await expect(stripe).toContainText("2 cobros");
  await expect(depositGroup(page, paypalOn, "Cuenta de ahorro (…7305)")).toContainText("$47,76");

  // Cuánto se le debe a cada grupo: asignado y liquidado en el período, saldo de toda la historia.
  // En el celular, una tarjeta por beneficiario (la tabla no cabe); desde 768 px, la tabla.
  const phone = isPhone(page);
  const splits = page.getByRole(phone ? "list" : "table", { name: "Repartos por beneficiario" });
  const row = (name: string) => splits.getByRole(phone ? "listitem" : "row").filter({ hasText: name });
  await expect(row("Grupo A")).toContainText("$145,35");
  await expect(row("Grupo A")).toContainText("$40,00");
  await expect(row("Grupo A")).toContainText("$105,35");
  await expect(row("Grupo B")).toContainText("$87,21");
  await expect(row("Grupo C")).toContainText("$58,14");
  await expect(row("Grupo C")).toContainText("-$11,86");
  await expect(row("Grupo C")).toContainText("a favor de la empresa");

  // Las empresas cuyos cobros nuevos no se reparten solos: sin esquema por defecto, o con uno desactivado.
  const schemeNotice = page.getByRole("listitem").filter({ hasText: "sin esquema de reparto activo por defecto" });
  await expect(schemeNotice).toContainText("2 empresas sin esquema de reparto activo por defecto");
  await expect(schemeNotice.getByRole("link", { name: "Escuela Demo (su esquema está desactivado)" })).toBeVisible();
  await expect(schemeNotice.getByRole("link", { name: "Tienda Demo", exact: true })).toBeVisible();
  // Los cinco dibujos llegan después de la página: axe y el ancho se miran con ellos ya pintados.
  await expect(page.locator("figure .recharts-surface")).toHaveCount(5);
  await checkScreen(page);

  // Otra moneda: todo en EUR, nada de USD sumado.
  await page.getByLabel("Moneda").selectOption("EUR");
  await expect(page).toHaveURL(/moneda=EUR/);
  await expect(card(page, "Bruto")).toContainText("€80,00");
  await expect(card(page, "Neto")).toContainText("€76,72");
  await expect(card(page, "Cobros")).toContainText("1");
  await expect(page.getByText("$350,00")).toHaveCount(0);
  await checkScreen(page);
});

test("marcar depositado un grupo lo mueve de «por caer» a «depositado»", async ({ page }) => {
  await login(page, user);
  await page.goto("/pasarelas");
  const stripe = depositGroup(page, stripeOn, "Cuenta principal (…4321)");
  await stripe.getByRole("button", { name: "Marcar depositado" }).click();

  const dialog = page.getByRole("dialog", { name: "Marcar depositado" });
  await expect(dialog).toContainText("2 cobros");
  await expect(dialog.getByLabel("Fecha del depósito")).toHaveValue(today);
  await checkScreen(page);
  await dialog.getByRole("button", { name: "Marcar depositado" }).click();

  await expect(page.getByText("2 cobros marcados como depositados")).toBeVisible();
  await expect(stripe).toHaveCount(0);
  await expect(card(page, "Por caer")).toContainText("$47,76");
  await expect(card(page, "Depositado")).toContainText("$290,70");
  await checkScreen(page);
});

test("en el celular, las cifras se ven al abrir: los filtros van plegados tras «Filtros» y siguen en la URL", async ({
  page,
}) => {
  await login(page, user);
  await page.goto("/pasarelas");
  await expect(card(page, "Bruto")).toContainText("$350,00");
  if (!isPhone(page)) {
    // Desde 768 px, los filtros abiertos y sin botón.
    await expect(filtersButton(page)).toHaveCount(0);
    await expect(page.getByLabel("Período", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Moneda")).toBeVisible();
    return;
  }
  const button = filtersButton(page);
  await expect(button).toHaveAccessibleName("Filtros Este mes · USD");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByLabel("Período", { exact: true })).toBeHidden();
  // Bruto, comisiones, neto y por caer, enteros y por encima de la barra de abajo, sin desplazar.
  const bar = await page.getByRole("navigation", { name: "Principal" }).last().boundingBox();
  for (const name of ["Bruto", "Comisiones", "Neto", "Por caer"]) {
    await expect(card(page, name)).toBeInViewport({ ratio: 1 });
    const box = await card(page, name).boundingBox();
    expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
  }
  await checkScreen(page);

  await openFilters(page);
  await page.getByLabel("Pasarela", { exact: true }).selectOption({ label: "Stripe" });
  await expect(page).toHaveURL(/pasarela=/);
  await expect(card(page, "Bruto")).toContainText("$300,00");
  // El panel sigue abierto y el botón cuenta el filtro.
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(button).toHaveAccessibleName("Filtros Este mes · USD · 1 filtro más");
  await checkScreen(page);

  // Al volver a entrar con el filtro en la URL, plegados y con el filtro puesto.
  await page.reload();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toHaveAccessibleName("Filtros Este mes · USD · 1 filtro más");
  await expect(card(page, "Bruto")).toContainText("$300,00");
});

test("una moneda sin cobros en el período dice qué pasa y lleva a la que sí tiene", async ({ page }) => {
  await login(page, user);
  // Solo el día del cobro atrasado (10,00 USD). En EUR hay un depósito por caer, pero ningún cobro ese día.
  const day = addDays(today, -40);
  await page.goto(`/pasarelas?periodo=personalizado&desde=${day}&hasta=${day}&moneda=EUR`);
  await expect(page.getByText("No hay cobros en EUR en este período", { exact: true })).toBeVisible();
  await expect(page.getByText("Los cobros del período están en USD.")).toBeVisible();
  await checkScreen(page);
  await page.getByRole("link", { name: "Ver los cobros en USD" }).click();
  await expect(page).not.toHaveURL(/moneda=/);
  await expect(card(page, "Bruto")).toContainText("$10,00");
  await expect(page).toHaveURL(new RegExp(`desde=${day}`));
});
