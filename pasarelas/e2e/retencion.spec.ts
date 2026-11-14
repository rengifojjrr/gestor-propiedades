import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ZONE, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import { signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * La retención de la pasarela, en el celular (390×844) y en el escritorio (1280×800). Un usuario nuevo trae Escuela
 * Demo, la Cuenta principal y los Grupos A, B y C (`newUser()`); aquí se le agregan Titular A y Titular B, la
 * pasarela «OTF Demo» (2,9 % + 0,20, no devuelve la comisión, a la Cuenta principal) y el esquema «Sobre el neto» de
 * E10, que pasa a ser el de la empresa: Grupo A 60 %, Grupo B 30 %, Titular A 5 % y Titular B 5 %, los titulares sin
 * comisión.
 *
 * E10: 1000,00 USD el 10 nov 2026 → comisión 29,20 y neto 970,80; OTF retiene el 5 % durante 30 días: 50,00 (25,00
 * a cada titular), que se liberan el 10 dic 2026; llega al banco 920,80. Reparto: Grupo A 580,53 · Grupo B 290,27 ·
 * Titular A 50,00 · Titular B 50,00; el saldo de cada titular por este cobro es 50,00 − 25,00 = 25,00.
 */

type Otf = { gatewayId: string; titularA: string; titularB: string };

/** Un aviso pasajero con ese texto. */
const toastWith = (page: Page, text: string) =>
  page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: text });

async function checkScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Lo que le toca a un beneficiario en el reparto, dentro de `scope`. */
const share = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole("list", { name: "Reparto" }).getByRole("listitem").filter({ hasText: name });

/** Lo que le cae a una persona de lo retenido, en el desglose. */
const retainedFor = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole("list", { name: "A quién le cae lo retenido" }).getByRole("listitem").filter({ hasText: name });

/** Una cifra (`Stat`) por su nombre, dentro de `scope`. */
const stat = (scope: Locator, label: string): Locator => scope.getByText(label, { exact: true }).locator("..");

/** Los titulares, OTF Demo en Escuela Demo (a la Cuenta principal) y el esquema de E10 como el de la empresa. */
async function setupOtf(db: Db, user: TestUser): Promise<Otf> {
  const titulares = unwrap(
    await db.from("pay_beneficiaries").insert([{ name: "Titular A" }, { name: "Titular B" }]).select("id, name"),
    "titulares",
  );
  const idOf = (name: string) => titulares.find((row) => row.name === name)?.id ?? "";
  const gatewayId = unwrap(
    await db.rpc("pay_create_gateway", { p: { name: "OTF Demo", fee: { pct: "2.9", fixed: "0.20" } } }),
    "pasarela",
  ) as string;
  unwrap(
    await db
      .from("pay_company_gateways")
      .insert({ company_id: user.basics.companyId, gateway_id: gatewayId, bank_account_id: user.basics.bankAccountId })
      .select("id"),
    "OTF en la empresa",
  );
  const scheme = unwrap(
    await db.rpc("pay_save_scheme", {
      p: {
        name: "Sobre el neto",
        base: "neto",
        lines: [
          { beneficiary_id: user.basics.beneficiaryIds.a, pct: "60" },
          { beneficiary_id: user.basics.beneficiaryIds.b, pct: "30" },
          { beneficiary_id: idOf("Titular A"), pct: "5", fee_exempt: true },
          { beneficiary_id: idOf("Titular B"), pct: "5", fee_exempt: true },
        ],
      },
    }),
    "esquema",
  ) as { scheme_id: string };
  unwrap(
    await db
      .from("pay_companies")
      .update({ default_scheme_id: scheme.scheme_id })
      .eq("id", user.basics.companyId)
      .select("id"),
    "esquema de la empresa",
  );
  return { gatewayId, titularA: idOf("Titular A"), titularB: idOf("Titular B") };
}

/** OTF retiene el 5 % durante 30 días para esas personas (sin pasar por la pantalla). */
async function retain(db: Db, gatewayId: string, recipients: { beneficiary_id: string; pct: string }[]): Promise<void> {
  await db.rpc("pay_save_gateway_retention", { p: { gateway_id: gatewayId, pct: "5", days: 30, recipients } }).throwOnError();
}

/** E10 guardado sin pasar por la pantalla: 1000,00 el 10 nov 2026 al mediodía por OTF Demo. */
async function chargeE10(db: Db, user: TestUser, otf: Otf, reference: string): Promise<string> {
  const id = randomUUID();
  const company = unwrap(
    await db.from("pay_companies").select("default_scheme_id").eq("id", user.basics.companyId).single(),
    "empresa",
  );
  await serverData().createTx(db, {
    id,
    companyId: user.basics.companyId,
    channelId: null,
    gatewayId: otf.gatewayId,
    extraIds: [],
    schemeId: company.default_scheme_id,
    occurredOn: "2026-11-10",
    occurredAt: wallTimeToInstant("2026-11-10T12:00", ZONE),
    currency: "USD",
    grossOriginal: "1000.00",
    reference,
    note: null,
    feesPaidBy: "nosotros",
  });
  return id;
}

/** Lo que se ve de E10 en un desglose y su reparto (la vista previa o el detalle). */
async function expectE10(scope: Page | Locator): Promise<void> {
  await expect(scope.getByTestId("comisiones")).toHaveText("$29,20");
  await expect(scope.getByTestId("neto")).toHaveText("$970,80");
  await expect(scope.getByText("Retiene OTF Demo (5 %)")).toBeVisible();
  await expect(scope.getByTestId("retenido")).toHaveText("$50,00");
  await expect(retainedFor(scope, "Titular A")).toContainText("$25,00");
  await expect(retainedFor(scope, "Titular B")).toContainText("$25,00");
  await expect(scope.getByText(/Se libera hacia el jue 10 dic 2026/)).toBeVisible();
  await expect(scope.getByTestId("llega-al-banco")).toHaveText("$920,80");
  await expect(share(scope, "Grupo A")).toContainText("$580,53");
  await expect(share(scope, "Grupo B")).toContainText("$290,27");
  for (const name of ["Titular A", "Titular B"]) {
    await expect(share(scope, name)).toContainText("$50,00");
    await expect(share(scope, name)).toContainText("ya recibió $25,00 de la retención · falta $25,00");
  }
}

test.describe("retención de la pasarela", () => {
  /** Los errores sin atrapar de la página y lo que React avisa por consola: cada prueba termina sin ninguno. */
  let pageErrors: string[] = [];

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(`${message.text()} (${message.location().url})`);
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("configurar la retención, registrar E10 y verla en la vista previa, el detalle, el titular y la cuenta; el reembolso total la deja en 0", async ({
    page,
    isMobile,
  }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    const otf = await setupOtf(db, user);
    await login(page, user);

    // La ficha de OTF Demo: todavía no retiene.
    await page.goto(`/pasarelas/pasarelas/${otf.gatewayId}`);
    const card = page.getByRole("region", { name: "Retención" });
    await expect(card.getByTestId("retencion-resumen")).toContainText("No retiene nada.");
    await checkScreen(page);

    // 5 % durante 30 días. Sin personas no se puede guardar, y se dice por qué.
    await card.getByLabel("% que retiene").fill("5");
    await card.getByLabel("Días que la retiene").fill("30");
    await expect(card.getByText("Elige a quién le cae lo retenido.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Guardar retención" })).toBeDisabled();
    const person = (n: number) => card.getByRole("group", { name: `Persona ${n}` });
    await card.getByRole("button", { name: "Agregar persona" }).click();
    await person(1).getByLabel("Beneficiario").selectOption({ label: "Titular A" });
    await person(1).getByLabel("Porcentaje").fill("50");
    await card.getByRole("button", { name: "Agregar persona" }).click();
    await person(2).getByLabel("Beneficiario").selectOption({ label: "Titular B" });
    await person(2).getByLabel("Porcentaje").fill("40");
    // Mientras no sumen 100 tampoco: la suma se ve al escribir.
    await expect(card.getByTestId("retencion-suma")).toHaveText("Suman 90 %");
    await expect(card.getByText("Los porcentajes de las personas tienen que sumar exactamente 100 %.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Guardar retención" })).toBeDisabled();
    await checkScreen(page);
    await person(2).getByLabel("Porcentaje").fill("50");
    await expect(card.getByTestId("retencion-suma")).toHaveText("Suman 100 %");
    await card.getByRole("button", { name: "Guardar retención" }).click();
    await expect(toastWith(page, "Retención guardada")).toBeVisible();
    await expect(card.getByTestId("retencion-resumen")).toContainText(
      "Retiene el 5 % de cada cobro durante 30 días corridos y se lo paga a Titular A (50 %) y Titular B (50 %)",
    );
    // Guardada, vuelve a partir de lo guardado (al recargar, igual).
    await page.reload();
    await expect(person(2).getByLabel("Beneficiario")).toHaveValue(otf.titularB);
    await expect(person(2).getByLabel("Porcentaje")).toHaveValue("50");
    await checkScreen(page);

    // Registrar E10: la vista previa dice lo retenido, a quién le cae, cuándo se libera y lo que llega al banco.
    await page.goto("/pasarelas/registrar");
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Pasarela").selectOption({ label: "OTF Demo" });
    await page.getByLabel("Monto").fill("1000");
    await page.getByLabel("Fecha y hora").fill("2026-11-10T12:00");
    const preview = page.getByRole("region", { name: "Vista previa" });
    await expectE10(preview);
    await expect(preview.getByText(/no está en el reparto/)).toHaveCount(0);
    await checkScreen(page);
    const reference = `E10-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(reference);
    await page.getByRole("button", { name: "Guardar" }).click();
    await toastWith(page, "Cobro guardado").getByRole("button", { name: "Ver cobro" }).click();

    // El detalle: lo mismo, congelado.
    await expect(page).toHaveURL(/\/pasarelas\/cobros\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("main")).toContainText(reference);
    const txId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await expectE10(page.getByRole("main"));
    await checkScreen(page);

    // La lista de Cobros: bajo el neto, lo retenido.
    await page.goto(`/pasarelas/cobros?periodo=personalizado&desde=2026-11-01&hasta=2026-11-30&q=${reference}`);
    const row = page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: reference });
    await expect(row).toContainText("$970,80");
    await expect(row).toContainText("$50,00 retenido");
    await checkScreen(page);

    // La ficha de un titular: asignado 50,00, retenido 25,00 y saldo 25,00.
    await page.goto(`/pasarelas/repartos/beneficiarios/${otf.titularA}`);
    const balance = page.getByRole("region", { name: "Saldo" });
    await expect(balance).toContainText("Asignado");
    await expect(balance).toContainText("$50,00");
    await expect(balance.getByTestId("retenido-USD")).toHaveText("$25,00");
    await expect(balance.getByTestId("saldo-USD")).toHaveText("$25,00");
    await expect(balance).toContainText("El saldo lo descuenta.");
    await checkScreen(page);

    // La cuenta: por caer, lo que llega al banco.
    await page.goto("/pasarelas/cuentas");
    const account = page.getByRole("region", { name: "Cuenta principal" });
    await expect(stat(account, "Por caer")).toContainText("$920,80");
    await expect(account).toContainText("Sin lo que retienen las pasarelas");
    await checkScreen(page);

    // El Resumen del mes: «Por caer» es lo que llega al banco, y el total retenido del período.
    await page.goto("/pasarelas?periodo=personalizado&desde=2026-11-01&hasta=2026-11-30");
    await expect(page.getByRole("group", { name: "Por caer", exact: true })).toContainText("$920,80");
    await expect(page.getByRole("group", { name: "Retenido", exact: true })).toContainText("$50,00");
    await checkScreen(page);

    // El reembolso total deja lo retenido en 0: llega al banco lo mismo que el neto (−29,20).
    await page.goto(`/pasarelas/cobros/${txId}`);
    const actions = page.getByRole("region", { name: "Acciones" });
    const more = actions.getByRole("button", { name: "Más acciones" });
    await expect(more).toBeEnabled();
    await more.click();
    await actions.getByRole("button", { name: "Registrar reembolso", exact: true }).click();
    const refund = page.getByRole("dialog", { name: "Reembolso" });
    await refund.getByLabel("Monto del reembolso").fill("1000");
    await refund.getByRole("button", { name: "Registrar reembolso" }).click();
    await expect(refund).toBeHidden();
    await expect(page.getByTestId("retenido")).toHaveText("$0,00");
    await expect(page.getByText("Sin nada cobrado, no retiene nada.")).toBeVisible();
    await expect(page.getByRole("list", { name: "A quién le cae lo retenido" })).toHaveCount(0);
    await expect(page.getByTestId("neto")).toHaveText("-$29,20");
    await expect(page.getByTestId("llega-al-banco")).toHaveText("-$29,20");
    await expect(share(page, "Titular A")).toContainText("$0,00");
    await expect(share(page, "Titular A")).not.toContainText("retención");
    await checkScreen(page);

    // Y el titular vuelve a 0: no le toca nada ni recibió nada.
    await page.goto(`/pasarelas/repartos/beneficiarios/${otf.titularA}`);
    await expect(page.getByRole("region", { name: "Saldo" }).getByTestId("saldo-USD")).toHaveText("$0,00");
    await expect(page.getByRole("region", { name: "Saldo" }).getByTestId("retenido-USD")).toHaveCount(0);
  });

  test("quien recibe la retención sin estar en el reparto: la vista previa y el detalle lo advierten, y su saldo baja", async ({
    page,
  }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    const otf = await setupOtf(db, user);
    // Lo retenido le cae entero al Grupo C, que no está en el esquema de E10.
    await retain(db, otf.gatewayId, [{ beneficiary_id: user.basics.beneficiaryIds.c, pct: "100" }]);
    const warning = "Grupo C recibe $50,00 de la retención pero no está en el reparto de este cobro: es un adelanto y su saldo baja.";
    await login(page, user);

    await page.goto("/pasarelas/registrar");
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Pasarela").selectOption({ label: "OTF Demo" });
    await page.getByLabel("Monto").fill("1000");
    const preview = page.getByRole("region", { name: "Vista previa" });
    await expect(preview.getByText(warning)).toBeVisible();
    await expect(preview.getByTestId("llega-al-banco")).toHaveText("$920,80");
    await checkScreen(page);

    const txId = await chargeE10(db, user, otf, `E10-${randomUUID().slice(0, 8)}`);
    await page.goto(`/pasarelas/cobros/${txId}`);
    await expect(page.getByRole("main").getByText(warning)).toBeVisible();
    await checkScreen(page);

    // Su saldo: no tiene nada asignado y ya recibió 50,00, que debe.
    await page.goto(`/pasarelas/repartos/beneficiarios/${user.basics.beneficiaryIds.c}`);
    const balance = page.getByRole("region", { name: "Saldo" });
    await expect(balance.getByTestId("retenido-USD")).toHaveText("$50,00");
    await expect(balance.getByTestId("saldo-USD")).toContainText("-$50,00");
    await expect(balance.getByTestId("saldo-USD")).toContainText("a favor de la empresa");
    await checkScreen(page);
  });

  test("recalcular le trae la retención a un cobro registrado antes de configurarla", async ({ page }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    const otf = await setupOtf(db, user);
    const txId = await chargeE10(db, user, otf, `E10-${randomUUID().slice(0, 8)}`);
    await retain(db, otf.gatewayId, [
      { beneficiary_id: otf.titularA, pct: "50" },
      { beneficiary_id: otf.titularB, pct: "50" },
    ]);
    await login(page, user);

    // Registrado antes: no retiene nada hasta recalcularlo.
    await page.goto(`/pasarelas/cobros/${txId}`);
    await expect(page.getByTestId("neto")).toHaveText("$970,80");
    await expect(page.getByTestId("retenido")).toHaveCount(0);
    const actions = page.getByRole("region", { name: "Acciones" });
    const more = actions.getByRole("button", { name: "Más acciones" });
    await expect(more).toBeEnabled();
    await more.click();
    await actions.getByRole("button", { name: "Recalcular", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Recalcular" });
    await dialog.getByRole("button", { name: "Ver el antes y el después" }).click();
    const table = dialog.getByRole("table");
    const changed = (label: string) => table.getByRole("rowheader", { name: label, exact: true }).locator("..");
    await expect(changed("Retenido")).toContainText("$50,00");
    await expect(changed("Retenido · Titular A")).toContainText("$25,00");
    await expect(changed("Retenido · Titular B")).toContainText("$25,00");
    await checkScreen(page);
    await dialog.getByRole("button", { name: /Aplicar/ }).click();
    await expect(dialog).toBeHidden();
    await expectE10(page.getByRole("main"));
  });
});
