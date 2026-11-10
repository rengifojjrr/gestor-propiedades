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
});

async function checkScreen(page: Page): Promise<void> {
  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page);
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
  await expect(page.getByLabel("Moneda")).toBeVisible();
  await expect(page.getByText("€80,00")).toHaveCount(0);

  // Cuánto facturó cada empresa.
  const companies = await chartTable(page, "Empresas por bruto");
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
  const phone = (page.viewportSize()?.width ?? 0) < 768;
  const splits = page.getByRole(phone ? "list" : "table", { name: "Repartos por beneficiario" });
  const row = (name: string) => splits.getByRole(phone ? "listitem" : "row").filter({ hasText: name });
  await expect(row("Grupo A")).toContainText("$145,35");
  await expect(row("Grupo A")).toContainText("$40,00");
  await expect(row("Grupo A")).toContainText("$105,35");
  await expect(row("Grupo B")).toContainText("$87,21");
  await expect(row("Grupo C")).toContainText("$58,14");
  await expect(row("Grupo C")).toContainText("-$11,86");
  await expect(row("Grupo C")).toContainText("a favor de la empresa");
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
