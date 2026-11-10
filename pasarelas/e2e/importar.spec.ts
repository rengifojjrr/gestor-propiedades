import { expect, test, type Page } from "@playwright/test";
import { signInAal1 } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Importar CSV con el informe de saldo de Stripe (el formato con fuente oficial): elegir el archivo, revisar «Así lo
 * entendí», importar con la comisión del archivo, comprobar en la base lo creado y repetir el archivo sin duplicar
 * nada. Después, un archivo que no se reconoce: se mapea a mano, avisa que el formato es otro que el recordado y, si
 * la red se corta al importar, lo dice. Un usuario nuevo por archivo (y por proyecto: celular y escritorio).
 */

const FIXTURE = "tests/fixtures/stripe-saldo.csv";
const OTHER_FIXTURE = "tests/fixtures/otro.csv";

let user: TestUser;

test.beforeAll(async () => {
  user = await newUser();
});

test.beforeEach(async ({ page }) => {
  await login(page, user);
});

/** axe sin violaciones serias y nada que se desborde, ya terminadas las transiciones (un aviso pasajero). */
async function expectCleanScreen(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
  );
  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page);
}

/** Los cobros de Stripe del usuario, leídos con su propia sesión. */
async function importedTransactions() {
  const client = await signInAal1(user.email, user.password);
  const { data } = await client
    .from("pay_transactions")
    .select("reference, occurred_on, gross_original::text, fees_total::text, net_amount::text, channel_id, breakdown")
    .eq("gateway_id", user.basics.gatewayId)
    .order("reference")
    .throwOnError();
  return data;
}

test("importar el informe de saldo de Stripe: revisar, importar y repetir sin duplicar", async ({ page }) => {
  await page.goto("/pasarelas/importar");
  await expect(page.getByRole("heading", { level: 1, name: "Importar CSV" })).toBeVisible();
  await expectCleanScreen(page);

  // Para todos los cobros del archivo: Escuela Demo, Stripe, por el canal de inscripciones (5 %).
  await expect(page.getByLabel("Empresa")).toHaveValue(user.basics.companyId);
  await expect(page.getByLabel("Pasarela")).toHaveValue(user.basics.gatewayId);
  await page.getByLabel("Canal").selectOption({ label: "Inscripciones en línea" });

  await page.getByLabel("Archivo CSV").setInputFiles(FIXTURE);
  await expect(page.getByText("Formato: Stripe (movimientos de saldo).")).toBeVisible();

  // El editor de columnas, abierto sobre el mapeo del formato: ninguna columna del comprador se ofrece.
  await page.getByRole("button", { name: "Ajustar columnas" }).click();
  await expect(page.getByRole("heading", { name: "Columnas del archivo" })).toBeVisible();
  await expect(page.getByLabel("Referencia", { exact: true })).toHaveValue("balance_transaction_id");
  await expect(
    page.getByLabel("Referencia", { exact: true }).locator("option", { hasText: "customer_email" }),
  ).toHaveCount(0);
  await expectCleanScreen(page);
  await page.getByRole("button", { name: "Ocultar columnas" }).click();
  await expect(page.getByRole("heading", { name: "Columnas del archivo" })).toBeHidden();

  const review = page.getByRole("region", { name: "Así lo entendí" });
  await expect(review).toBeVisible();
  await expect(review.getByText("Nuevos").locator("..")).toContainText("2");
  await expect(review.getByText("Omitidos", { exact: true }).locator("..")).toContainText("8");
  await expect(review.getByText("Con error", { exact: true }).locator("..")).toContainText("2");
  // La muestra: lo convertido (tarjetas en el celular, tabla en el escritorio; se mira la que se ve).
  const sample = review.getByLabel("Muestra de las filas convertidas").filter({ visible: true });
  await expect(sample).toHaveCount(1);
  await expect(sample).toContainText("txn_demo_0001");
  await expect(sample).toContainText("txn_demo_0002");
  await expect(sample).toContainText("$1.234,56");
  await expect(sample).toContainText("$36,10");
  // Lo omitido, con su motivo, y lo que no se pudo leer, con su línea.
  await expect(review).toContainText("reembolso: el importador solo trae cobros");
  await expect(review).toContainText("referencia repetida: ya salió en la línea 2");
  await expect(review).toContainText("Línea 12: moneda inválida");
  await expect(review).toContainText("Línea 13: falta la fecha");
  // Nada del comprador en la pantalla.
  await expect(page.locator("body")).not.toContainText("cliente1@example.com");
  await expect(page.locator("body")).not.toContainText("Cliente Demo");
  await expectCleanScreen(page);

  await review.getByLabel("Usar la comisión del archivo").check();
  await review.getByRole("button", { name: "Importar 2 cobros" }).click();
  await expect(page.getByText("Se crearon 2 cobros.")).toBeVisible();
  await expectCleanScreen(page);

  // En la base: la comisión del archivo (congelada como informada) más la del canal.
  const created = await importedTransactions();
  expect(created.map(({ breakdown: _breakdown, ...tx }) => tx)).toEqual([
    {
      reference: "txn_demo_0001",
      occurred_on: "2026-03-08",
      gross_original: "100.00",
      fees_total: "8.20",
      net_amount: "91.80",
      channel_id: user.basics.channelId,
    },
    {
      reference: "txn_demo_0002",
      occurred_on: "2026-11-01",
      gross_original: "1234.56",
      fees_total: "97.83",
      net_amount: "1136.73",
      channel_id: user.basics.channelId,
    },
  ]);
  for (const tx of created) {
    expect(tx.breakdown).toMatchObject({ lines: [{ kind: "pasarela", baseKind: "informado" }, { kind: "plataforma" }] });
  }

  // El mismo archivo otra vez: nada se duplica y lo dice.
  await page.getByRole("button", { name: "Importar otro archivo" }).click();
  await page.getByLabel("Archivo CSV").setInputFiles(FIXTURE);
  await expect(page.getByText("Con las columnas que usaste la última vez con Stripe.")).toBeVisible();
  await page.getByRole("button", { name: "Importar 2 cobros" }).click();
  await expect(page.getByText("No se creó ningún cobro nuevo.")).toBeVisible();
  await expect(page.getByText("2 ya existían con la misma referencia en Stripe y no se tocaron.")).toBeVisible();
  await expectCleanScreen(page);
  expect(await importedTransactions()).toEqual(created);

  // Un archivo que no se reconoce, en la misma pasarela: se mapea a mano y avisa que el formato es otro.
  await page.getByRole("button", { name: "Importar otro archivo" }).click();
  await page.getByLabel("Archivo CSV").setInputFiles(OTHER_FIXTURE);
  await expect(page.getByText("No reconocimos este archivo")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Columnas del archivo" })).toBeVisible();
  await expect(page.getByText("Falta ajustar el mapeo")).toBeVisible();
  await expect(page.getByRole("region", { name: "Así lo entendí" })).toBeHidden();
  await expect(
    page.getByLabel("Referencia", { exact: true }).locator("option", { hasText: "Correo cliente" }),
  ).toHaveCount(0);
  await expectCleanScreen(page);

  await page.getByLabel("Referencia", { exact: true }).selectOption("Referencia");
  await page.getByLabel("Fecha", { exact: true }).selectOption("Fecha");
  await page.getByLabel("Monto cobrado", { exact: true }).selectOption("Importe");
  await page.getByLabel("Formato de fecha").selectOption("DD/MM/YYYY");
  await page.getByLabel("Separador decimal").selectOption(",");
  await expect(page.getByText("Falta ajustar el mapeo")).toBeHidden();

  const otherReview = page.getByRole("region", { name: "Así lo entendí" });
  await expect(otherReview).toBeVisible();
  await expect(otherReview.getByText("Ojo: puede duplicar cobros")).toBeVisible();
  const importOther = otherReview.getByRole("button", { name: /^Importar \d+ cobros?$/ });
  await expect(importOther).toBeDisabled();
  await expectCleanScreen(page);
  await otherReview.getByLabel("Son otros cobros: importar igual").check();
  await expect(importOther).toBeEnabled();

  // Si la llamada al servidor falla (red cortada), la pantalla no se queda en «Importando…»: lo dice.
  const cut = "**/pasarelas/importar";
  await page.route(cut, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await importOther.click();
  await expect(page.getByRole("heading", { name: "La importación se detuvo" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Se perdió la conexión con el servidor." })).toBeVisible();
  await expect(page.getByText(/Importando…/)).toHaveCount(0);
  await expectCleanScreen(page);
  await page.unroute(cut);
  expect(await importedTransactions()).toEqual(created);
});
