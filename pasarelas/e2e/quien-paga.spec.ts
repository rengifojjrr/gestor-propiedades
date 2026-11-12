import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ZONE, todayNY, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import type { FeesPaidBy } from "../src/lib/pasarelas/types";
import { signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * ¿Quién paga la comisión? «Nosotros» (lo de siempre) o «El comprador», al que se le cobró de más para cubrirla, en
 * el celular (390×844) y en el escritorio (1280×800). Un usuario nuevo trae lo de E1 (`newUser()`): Escuela Demo y
 * Stripe 2,9 % + 0,30. Aquí, además, el esquema de la empresa reparte 50/30/20 «Sobre el bruto».
 *
 * E7: 1040 que pagó el comprador → Stripe se lleva 30,46 (no 40) y quedan 1009,54; lo pagado de más no es venta del
 * negocio, así que el reparto va sobre esos 1009,54: 504,77 · 302,86 · 201,91. Pagando nosotros, sobre 1040:
 * 520,00 · 312,00 · 208,00.
 */

const QUESTION = "¿Quién paga la comisión?";
const FIXTURE = "tests/fixtures/stripe-saldo.csv";

/** Un aviso pasajero con ese texto. */
const toastWith = (page: Page, text: string) =>
  page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: text });

async function checkScreen(page: Page): Promise<void> {
  // Un aviso a medio entrar tiene el texto translúcido y axe lo mide como falta de contraste.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return animation.playState !== "running" || !(target instanceof Element && target.closest("[data-sonner-toaster]"));
    }),
  );
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** La pregunta, y cada respuesta como botón de opción. */
const payerGroup = (page: Page): Locator => page.getByRole("group", { name: QUESTION });
const payer = (page: Page, label: "Nosotros" | "El comprador"): Locator =>
  payerGroup(page).getByRole("radio", { name: label });

/** Lo que le toca a un beneficiario en el reparto, dentro de `scope`. */
const share = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole("list", { name: "Reparto" }).getByRole("listitem").filter({ hasText: name });

async function expectShares(scope: Page | Locator, amounts: [string, string, string]): Promise<void> {
  await expect(share(scope, "Grupo A")).toContainText(amounts[0]);
  await expect(share(scope, "Grupo B")).toContainText(amounts[1]);
  await expect(share(scope, "Grupo C")).toContainText(amounts[2]);
}

/** Un esquema 50/30/20 «Sobre el bruto», que pasa a ser el de la empresa. */
async function schemeOnGross(user: TestUser, db: Db): Promise<string> {
  const scheme = unwrap(
    await db.rpc("pay_save_scheme", {
      p: {
        name: "Reparto sobre el bruto",
        base: "bruto",
        lines: [
          { beneficiary_id: user.basics.beneficiaryIds.a, pct: "50" },
          { beneficiary_id: user.basics.beneficiaryIds.b, pct: "30" },
          { beneficiary_id: user.basics.beneficiaryIds.c, pct: "20" },
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
  return scheme.scheme_id;
}

/** Un cobro de hoy al mediodía por Stripe, sin canal ni opciones, con quien se diga que pagó la comisión. */
async function charge(
  db: Db,
  user: TestUser,
  a: { gross: string; feesPaidBy: FeesPaidBy; schemeId: string | null },
): Promise<{ id: string; reference: string }> {
  const id = randomUUID();
  const reference = `QUIEN-${randomUUID().slice(0, 8)}`;
  const today = todayNY(new Date());
  await serverData().createTx(db, {
    id,
    companyId: user.basics.companyId,
    channelId: null,
    gatewayId: user.basics.gatewayId,
    extraIds: [],
    schemeId: a.schemeId,
    occurredOn: today,
    occurredAt: wallTimeToInstant(`${today}T12:00`, ZONE),
    currency: "USD",
    grossOriginal: a.gross,
    reference,
    note: null,
    feesPaidBy: a.feesPaidBy,
  });
  return { id, reference };
}

test.describe("¿quién paga la comisión?", () => {
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

  test("registrar 1040 que pagó el comprador: la vista previa y lo guardado reparten sobre 1009,54", async ({ page }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    await schemeOnGross(user, db);
    await login(page, user);
    await page.goto("/pasarelas/registrar");
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });

    // Por defecto, la comisión la pagamos nosotros: el monto es lo cobrado y el reparto, sobre el bruto (E7b).
    await expect(payer(page, "Nosotros")).toBeChecked();
    await expect(payer(page, "El comprador")).not.toBeChecked();
    await page.getByLabel("Monto").fill("1040");
    const preview = page.getByRole("region", { name: "Vista previa" });
    await expect(preview.getByTestId("comisiones")).toHaveText("$30,46");
    await expect(preview.getByTestId("neto")).toHaveText("$1.009,54");
    await expect(preview).toContainText("Sobre el bruto: $1.040,00");
    await expectShares(preview, ["$520,00", "$312,00", "$208,00"]);
    await checkScreen(page);

    // Con «El comprador»: el monto es lo que pagó él, y se reparte lo que te queda (E7).
    await payer(page, "El comprador").check();
    await expect(page.getByText("Lo que pagó el comprador, con la comisión incluida")).toBeVisible();
    await expect(preview.getByTestId("comisiones")).toHaveText("$30,46");
    await expect(preview.getByTestId("neto")).toHaveText("$1.009,54");
    await expect(preview.getByText("Lo que te queda", { exact: true })).toBeVisible();
    await expect(preview).toContainText("Se reparte sobre lo que te queda: la comisión la pagó el comprador");
    await expect(preview).toContainText("Sobre el neto: $1.009,54");
    await expectShares(preview, ["$504,77", "$302,86", "$201,91"]);
    // Cada respuesta es un objetivo de 44 px.
    for (const label of ["Nosotros", "El comprador"] as const) {
      const box = await payerGroup(page).locator("label").filter({ hasText: label }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await checkScreen(page);

    const reference = `E7-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(reference);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(toastWith(page, "Cobro guardado")).toBeVisible();

    const saved = unwrap(
      await db
        .from("pay_transactions")
        .select(
          "fees_paid_by, fees_total::text, net_amount::text, alloc_base, alloc_base_amount::text, pay_allocations(amount::text)",
        )
        .eq("reference", reference)
        .single(),
      "cobro guardado",
    );
    expect(saved).toMatchObject({
      fees_paid_by: "comprador",
      fees_total: "30.46",
      net_amount: "1009.54",
      alloc_base: "neto",
      alloc_base_amount: "1009.54",
    });
    expect(saved.pay_allocations.map((line) => line.amount).sort()).toEqual(["201.91", "302.86", "504.77"]);

    // Listo para el siguiente: la selección se queda, también quién paga. «Repetir el último» lo repite.
    await expect(payer(page, "El comprador")).toBeChecked();
    await page.reload();
    await expect(payer(page, "Nosotros")).toBeChecked();
    await page.getByRole("button", { name: "Repetir el último" }).click();
    await expect(payer(page, "El comprador")).toBeChecked();
  });

  test("el detalle dice quién pagó la comisión, y el desglose y el reparto lo reflejan", async ({ page }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    const schemeId = await schemeOnGross(user, db);
    const byBuyer = await charge(db, user, { gross: "1040.00", feesPaidBy: "comprador", schemeId });
    const ours = await charge(db, user, { gross: "1040.00", feesPaidBy: "nosotros", schemeId });
    await login(page, user);

    await page.goto(`/pasarelas/cobros/${byBuyer.id}`);
    await expect(page.getByTestId("comision-pagada-por")).toHaveText("El comprador");
    await expect(page.getByTestId("comisiones")).toHaveText("$30,46");
    await expect(page.getByTestId("neto")).toHaveText("$1.009,54");
    await expect(page.getByText("Lo que te queda", { exact: true })).toBeVisible();
    await expect(page.getByText("Se reparte sobre lo que te queda: la comisión la pagó el comprador")).toBeVisible();
    await expectShares(page, ["$504,77", "$302,86", "$201,91"]);
    await checkScreen(page);

    await page.goto(`/pasarelas/cobros/${ours.id}`);
    await expect(page.getByTestId("comision-pagada-por")).toHaveText("Nosotros");
    await expect(page.getByTestId("neto")).toHaveText("$1.009,54");
    await expect(page.getByText("Se reparte sobre lo que te queda")).toHaveCount(0);
    await expectShares(page, ["$520,00", "$312,00", "$208,00"]);
  });

  test("editar de «Nosotros» a «El comprador» recalcula el reparto", async ({ page }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    const schemeId = await schemeOnGross(user, db);
    const { id } = await charge(db, user, { gross: "1040.00", feesPaidBy: "nosotros", schemeId });
    await login(page, user);

    await page.goto(`/pasarelas/cobros/${id}/editar`);
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    await expect(payer(page, "Nosotros")).toBeChecked();
    await checkScreen(page);
    await payer(page, "El comprador").check();
    await expect(page.getByText("Lo que pagó el comprador, con la comisión incluida")).toBeVisible();
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(page).toHaveURL(new RegExp(`/pasarelas/cobros/${id}$`));
    await expect(page.getByTestId("comision-pagada-por")).toHaveText("El comprador");
    await expect(page.getByTestId("comisiones")).toHaveText("$30,46");
    await expectShares(page, ["$504,77", "$302,86", "$201,91"]);
    await expect(page.getByRole("list", { name: "Historial" }).getByRole("listitem").first()).toContainText(
      "Editado: quién paga la comisión",
    );
    const [saved] = await serverData().getSnapshots(db, [id]);
    expect(saved).toMatchObject({ feesPaidBy: "comprador", fees: "30.46", net: "1009.54" });
    expect(saved?.breakdown.alloc).toMatchObject({ baseKind: "neto", baseAmount: "1009.54" });

    // Al volver a editarlo, la pregunta parte de lo guardado.
    await page.goto(`/pasarelas/cobros/${id}/editar`);
    await expect(payer(page, "El comprador")).toBeChecked();
  });

  test("con un cobro de cada tipo: el Resumen, la lista, la empresa y la pasarela separan lo de los compradores", async ({
    page,
    isMobile,
  }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    // 100,00 pagando nosotros (Stripe 3,20, neto 96,80) y 1040,00 pagando el comprador (30,46, neto 1009,54).
    await charge(db, user, { gross: "100.00", feesPaidBy: "nosotros", schemeId: user.basics.schemeId });
    const byBuyer = await charge(db, user, { gross: "1040.00", feesPaidBy: "comprador", schemeId: user.basics.schemeId });
    await login(page, user);

    // Resumen: el bruto es todo lo cobrado; las comisiones, las nuestras (3,2 % de lo que cobramos pagándolas).
    await page.goto("/pasarelas");
    const card = (name: string) => page.getByRole("group", { name, exact: true });
    await expect(card("Bruto")).toContainText("$1.140,00");
    await expect(card("Comisiones")).toContainText("$3,20");
    await expect(card("Comisiones")).toContainText("3,2 % del bruto en que las pagamos");
    await expect(card("Neto")).toContainText("$1.106,34");
    await expect(page.getByText("Además, los compradores pagaron $30,46 en comisiones.")).toBeVisible();
    // Lo facturado por la empresa es su venta: 100,00 + 1009,54.
    const companies = page.getByRole("figure", { name: "Empresas por lo facturado" });
    await companies.getByText("Ver los datos en una tabla").click();
    await expect(companies.getByRole("row", { name: /Escuela Demo/ })).toContainText("$1.109,54");
    // El costo de Stripe es el de lo que pagamos nosotros.
    const cost = page.getByRole("figure", { name: "Costo efectivo por pasarela" });
    await cost.getByText("Ver los datos en una tabla").click();
    await expect(cost.getByRole("row", { name: /Stripe/ })).toContainText("$3,20");
    await expect(cost.getByRole("row", { name: /Stripe/ })).toContainText("3,2 %");
    await checkScreen(page);

    // La lista marca, sin estorbar, el cobro cuya comisión pagó el comprador.
    await page.goto("/pasarelas/cobros");
    const row = page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: byBuyer.reference });
    await expect(row).toContainText("la pagó el comprador");
    // Solo ese: en la lista (tarjetas en el celular, tabla en el escritorio) se mira la que se ve.
    await expect(page.getByText("la pagó el comprador", { exact: true }).filter({ visible: true })).toHaveCount(1);
    await checkScreen(page);

    // La empresa: lo facturado en el período y en total es su venta; las comisiones de los compradores, aparte.
    await page.goto("/pasarelas/empresas");
    await expect(page.getByRole("link", { name: /Escuela Demo/ })).toContainText("Facturado en total: $1.109,54");
    await page.goto(`/pasarelas/empresas/${user.basics.companyId}`);
    const summary = page.getByRole("region", { name: "Lo facturado" });
    await expect(summary).toContainText("Esta empresa ha facturado $1.109,54 en el período y $1.109,54 en total.");
    await expect(summary).toContainText("Además, los compradores pagaron $30,46 en comisiones.");
    await expect(summary).toContainText("Comisiones$3,20");
    await checkScreen(page);

    // La pasarela: todo lo cobrado, las comisiones nuestras y las de los compradores aparte.
    await page.goto(`/pasarelas/pasarelas/${user.basics.gatewayId}`);
    const totals = page.getByRole("region", { name: "Tiempo real de depósito" });
    await expect(totals).toContainText("Bruto$1.140,00");
    await expect(totals).toContainText("Comisiones$3,20");
    await expect(totals).toContainText("Pagadas por los compradores$30,46");
    await expect(totals).toContainText("Neto$1.106,34");
    await checkScreen(page);
  });

  test("importar con «Las comisiones las pagaron los compradores» vale para todo el archivo", async ({ page }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    await login(page, user);
    await page.goto("/pasarelas/importar");
    await expect(page.getByLabel("Archivo CSV")).toBeEnabled();
    const buyers = page.getByLabel("Las comisiones las pagaron los compradores");
    await expect(buyers).not.toBeChecked();
    await page.getByLabel("Archivo CSV").setInputFiles(FIXTURE);
    const review = page.getByRole("region", { name: "Así lo entendí" });
    await expect(review).toBeVisible();
    await buyers.check();
    await checkScreen(page);
    await review.getByRole("button", { name: "Importar 2 cobros" }).click();
    await expect(page.getByText("Se crearon 2 cobros.")).toBeVisible();

    const imported = unwrap(
      await db.from("pay_transactions").select("fees_paid_by, alloc_base").eq("gateway_id", user.basics.gatewayId),
      "cobros importados",
    );
    expect(imported).toEqual([
      { fees_paid_by: "comprador", alloc_base: "neto" },
      { fees_paid_by: "comprador", alloc_base: "neto" },
    ]);
  });
});
