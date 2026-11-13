import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { e1Item, saveTransactions, signInAal1 } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Importar CSV con el informe de saldo de Stripe (el formato con fuente oficial): elegir el archivo, revisar «Así lo
 * entendí» (repetidos, atrasados, esquema), importar con la comisión del archivo y como ya depositados, comprobar en
 * la base lo creado y repetir el archivo: lo repetido y lo de la papelera se dicen antes de importar. Después, un
 * archivo que no se reconoce: se mapea a mano, avisa que el formato es otro que el recordado y, si la red se corta al
 * importar, lo dice. Luego, el informe con source_id frente a un cobro registrado a mano: «posible repetido», y el
 * mismo archivo corregido y elegido otra vez (se vuelve a leer). Por último, un archivo sin cobros (no se queda
 * «buscando») y una vista previa que falla y se reintenta.
 * Un usuario nuevo por archivo (y por proyecto: celular y escritorio).
 */

const FIXTURE = "tests/fixtures/stripe-saldo.csv";
const OTHER_FIXTURE = "tests/fixtures/otro.csv";
const SOURCE_FIXTURE = "tests/fixtures/stripe-saldo-fuente.csv";
const EMPTY_FIXTURE = "tests/fixtures/stripe-saldo-sin-cobros.csv";

let user: TestUser;

test.beforeAll(async () => {
  user = await newUser();
});

test.beforeEach(async ({ page }) => {
  await login(page, user);
});

/** axe sin violaciones serias y nada que se desborde, ya terminadas las transiciones (un aviso pasajero). */
async function expectCleanScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page);
}

/** Los cobros de Stripe del usuario, leídos con su propia sesión. */
async function importedTransactions() {
  const client = await signInAal1(user.email, user.password);
  const { data } = await client
    .from("pay_transactions")
    .select(
      "id, reference, occurred_on, gross_original::text, fees_total::text, net_amount::text, channel_id, status, estimated_deposit_on, deposited_on, breakdown",
    )
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

  // Sin hidratar, el selector va apagado: un archivo elegido antes no llegaría a la pantalla.
  await expect(page.getByLabel("Archivo CSV")).toBeEnabled();
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
  await expect(review.getByText("Nuevos", { exact: true }).locator("..")).toContainText("2");
  await expect(review.getByText("Repetidos", { exact: true }).locator("..")).toContainText("0");
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
  // El archivo no trae source_id: sus referencias (txn_…) no coinciden con lo registrado a mano.
  await expect(review).toContainText("Este informe no trae la columna source_id");
  // Los dos cobros son de marzo y del 1 de noviembre: ya debieron caer. Se resalta y se sugiere la opción.
  await expect(review).toContainText("2 quedarán por caer.");
  await expect(review.getByRole("status").filter({ hasText: "2 ya están atrasados" })).toBeVisible();
  await expect(review).toContainText("Reparto: «Reparto 50/30/20», el esquema por defecto de Escuela Demo.");
  await expectCleanScreen(page);

  await review.getByLabel("Estos cobros ya se depositaron").check();
  await expect(review).toContainText("2 entran como depositados con su fecha estimada; 0 quedan por caer.");
  await expect(review).toContainText("Es una estimación");
  await review.getByLabel("Usar la comisión del archivo").check();
  await review.getByRole("button", { name: "Importar 2 cobros" }).click();
  await expect(page.getByText("Se crearon 2 cobros.")).toBeVisible();
  await expectCleanScreen(page);

  // En la base: la comisión del archivo (congelada como informada) más la del canal.
  const created = await importedTransactions();
  // Entraron depositados, con su fecha estimada como fecha de depósito.
  for (const tx of created) {
    expect(tx.status).toBe("depositado");
    expect(tx.deposited_on).toBe(tx.estimated_deposit_on);
  }
  expect(
    created.map(
      ({
        id: _id,
        breakdown: _breakdown,
        status: _status,
        estimated_deposit_on: _estimated,
        deposited_on: _deposited,
        ...tx
      }) => tx,
    ),
  ).toEqual([
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

  // El mismo archivo otra vez: antes de importar ya dice que los dos están, y no hay nada que importar.
  await page.getByRole("button", { name: "Importar otro archivo" }).click();
  await page.getByLabel("Archivo CSV").setInputFiles(FIXTURE);
  await expect(page.getByText("Con las columnas que usaste la última vez con Stripe.")).toBeVisible();
  const again = page.getByRole("region", { name: "Así lo entendí" });
  await expect(again.getByText("Repetidos", { exact: true }).locator("..")).toContainText("2");
  await expect(again.getByText("Nuevos", { exact: true }).locator("..")).toContainText("0");
  await expect(again).toContainText("Ya están en Stripe con la misma referencia: no se tocan.");
  await expect(again.getByRole("button", { name: "No hay cobros nuevos para importar" })).toBeDisabled();
  await expectCleanScreen(page);

  // Uno de ellos va a la papelera: se cuenta aparte y se dice qué hacer.
  const client = await signInAal1(user.email, user.password);
  await client
    .from("pay_transactions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", created[1]!.id)
    .throwOnError();
  await page.getByLabel("Archivo CSV").setInputFiles([]);
  await page.getByLabel("Archivo CSV").setInputFiles(FIXTURE);
  const trashed = page.getByRole("region", { name: "Así lo entendí" });
  await expect(trashed.getByText("1 en la papelera")).toBeVisible();
  await expect(trashed).toContainText(
    "Tiene la misma referencia que un cobro que está en la papelera, así que no se creará. Restáuralo desde la papelera, o bórralo del todo allí y vuelve a importar el archivo.",
  );
  await expect(trashed.getByRole("link", { name: "Ir a la papelera" })).toHaveAttribute("href", "/pasarelas/papelera");
  await expectCleanScreen(page);
  await client.from("pay_transactions").update({ deleted_at: null }).eq("id", created[1]!.id).throwOnError();
  expect(await importedTransactions()).toEqual(created);
  await page.getByLabel("Archivo CSV").setInputFiles([]);

  // Un archivo que no se reconoce, en la misma pasarela: se mapea a mano y avisa que el formato es otro.
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

test("el informe con source_id frente a un cobro registrado a mano: «posible repetido» pide confirmar", async ({ page }) => {
  // Registrado a mano (sin referencia) el 2/11/2026 por 100,00: el mismo cobro que la línea 2 del archivo.
  const client = await signInAal1(user.email, user.password);
  const [manual] = await saveTransactions(client, [
    e1Item(user.basics, { occurred_at: "2026-11-02T15:00:00+00:00", occurred_on: "2026-11-02", reference: null }),
  ]);

  await page.goto("/pasarelas/importar");
  await expect(page.getByRole("heading", { level: 1, name: "Importar CSV" })).toBeVisible();
  await expectCleanScreen(page);
  await expect(page.getByLabel("Archivo CSV")).toBeEnabled();
  await page.getByLabel("Archivo CSV").setInputFiles(SOURCE_FIXTURE);
  await expect(page.getByText("Formato: Stripe (movimientos de saldo).")).toBeVisible();

  // La pasarela recuerda la referencia del movimiento (txn_…) de la primera prueba: avisa que el archivo trae source_id.
  const review = page.getByRole("region", { name: "Así lo entendí" });
  await expect(review).toContainText("El archivo trae source_id");
  await page.getByRole("button", { name: "Ajustar columnas" }).click();
  await page.getByLabel("Referencia", { exact: true }).selectOption("source_id");
  await page.getByRole("button", { name: "Ocultar columnas" }).click();
  await expect(review).not.toContainText("source_id");

  await expect(review.getByText("Nuevos", { exact: true }).locator("..")).toContainText("1");
  const possible = review.getByRole("status").filter({ hasText: "Posibles repetidos (1)" });
  await expect(possible).toBeVisible();
  await expect(possible).toContainText("ch_demo_0001");
  await expect(possible).toContainText("registrado a mano el lun 2 nov 2026, sin referencia");
  const confirm = review.getByLabel("Son otros cobros: importar también esta fila");
  await expect(confirm).not.toBeChecked();
  await expect(review.getByRole("button", { name: "Importar 1 cobro" })).toBeEnabled();
  await expectCleanScreen(page);
  await confirm.check();
  await expect(review.getByRole("button", { name: "Importar 2 cobros" })).toBeEnabled();
  await confirm.uncheck();

  // Sin confirmar, se importan las demás.
  await review.getByRole("button", { name: "Importar 1 cobro" }).click();
  await expect(page.getByText("Se creó 1 cobro.")).toBeVisible();
  await expect(page.getByText("1 posible repetido no se importó: confírmalo si de verdad es otro cobro.")).toBeVisible();
  await expectCleanScreen(page);
  const references = (await importedTransactions()).map((tx) => tx.reference);
  expect(references).toContain("py_demo_0002");
  expect(references).not.toContain("ch_demo_0001");
  expect(references).toContain(null);
  expect(manual!.inserted).toBe(true);
});

test("volver a elegir el mismo archivo, corregido y guardado con el mismo nombre, lo vuelve a leer", async ({
  page,
}, testInfo) => {
  // Un CSV propio de esta prueba: primero sin cobros; después, con el mismo nombre, el informe completo.
  const path = testInfo.outputPath("pagos-demo.csv");
  await writeFile(path, await readFile(EMPTY_FIXTURE));
  await page.goto("/pasarelas/importar");
  await expect(page.getByRole("heading", { level: 1, name: "Importar CSV" })).toBeVisible();
  const input = page.getByLabel("Archivo CSV");
  await expect(input).toBeEnabled();
  await input.setInputFiles(path);
  await expect(page.getByText("pagos-demo.csv · 2 filas")).toBeVisible();
  const review = page.getByRole("region", { name: "Así lo entendí" });
  await expect(review.getByText("Omitidos", { exact: true }).locator("..")).toContainText("2");

  // Se corrige en disco y se vuelve a elegir la misma ruta, sin vaciar el control en medio.
  await writeFile(path, await readFile(FIXTURE));
  await input.setInputFiles(path);
  await expect(page.getByText("pagos-demo.csv · 12 filas")).toBeVisible();
  await expect(review.getByText("Omitidos", { exact: true }).locator("..")).toContainText("8");
  await expect(review.getByText("Con error", { exact: true }).locator("..")).toContainText("2");
  await expectCleanScreen(page);
});

test("si la revisión falla se puede reintentar; un archivo sin cobros no se queda buscando", async ({ page }) => {
  await page.goto("/pasarelas/importar");
  await expect(page.getByRole("heading", { level: 1, name: "Importar CSV" })).toBeVisible();

  // Sin cobros que convertir (un reembolso y un retiro): cero nuevos y cero repetidos, nada «buscando».
  await expect(page.getByLabel("Archivo CSV")).toBeEnabled();
  await page.getByLabel("Archivo CSV").setInputFiles(EMPTY_FIXTURE);
  const empty = page.getByRole("region", { name: "Así lo entendí" });
  await expect(empty.getByText("Omitidos", { exact: true }).locator("..")).toContainText("2");
  await expect(empty.getByText("Nuevos", { exact: true }).locator("..")).toContainText("0");
  await expect(empty.getByText("Repetidos", { exact: true }).locator("..")).toContainText("0");
  await expect(empty).not.toContainText("buscando");
  await expect(empty).not.toContainText("Buscando");
  await expect(empty.getByRole("button", { name: "No hay cobros para importar" })).toBeDisabled();
  await expectCleanScreen(page);
  await page.getByLabel("Archivo CSV").setInputFiles([]);

  // La vista previa no llega (red cortada): lo dice, el botón no dice «Revisando…» y se puede reintentar.
  const cut = "**/pasarelas/importar";
  await page.route(cut, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await page.getByLabel("Archivo CSV").setInputFiles(FIXTURE);
  const review = page.getByRole("region", { name: "Así lo entendí" });
  const failed = review.getByRole("alert").filter({ hasText: "No se pudo revisar lo que ya está registrado" });
  await expect(failed).toContainText("Se perdió la conexión con el servidor.");
  await expect(review.getByRole("button", { name: "No se pudo revisar el archivo" })).toBeDisabled();
  await expect(review.getByText("Revisando…")).toHaveCount(0);
  await expectCleanScreen(page);

  // Vuelve la red: «Reintentar» pide otra vez la vista previa (los dos cobros ya se importaron en la primera prueba).
  await page.unroute(cut);
  await failed.getByRole("button", { name: "Reintentar" }).click();
  await expect(failed).toBeHidden();
  await expect(review.getByText("Repetidos", { exact: true }).locator("..")).toContainText("2");
  await expect(review.getByText("Nuevos", { exact: true }).locator("..")).toContainText("0");
  await expect(review.getByRole("button", { name: "No hay cobros nuevos para importar" })).toBeDisabled();
  await expectCleanScreen(page);
});
