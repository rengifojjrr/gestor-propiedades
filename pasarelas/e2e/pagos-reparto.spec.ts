import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ZONE, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import { signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * Marcar en cada cobro que ya se le pagó a cada parte del reparto, en el celular (390×844) y en el escritorio
 * (1280×800). Un usuario nuevo trae Escuela Demo, la Cuenta principal y los Grupos A, B y C (`newUser()`); aquí se
 * le agregan Titular A y Titular B, la pasarela «OTF Demo» (2,9 % + 0,20) que retiene el 5 % para los titulares, y el
 * esquema de E10 como el de la empresa: Grupo A 60 %, Grupo B 30 %, Titular A 5 % y Titular B 5 %.
 *
 * E10: 1000,00 USD → Grupo A 580,53 · Grupo B 290,27 · Titular A 50,00 · Titular B 50,00, y a cada titular la
 * pasarela ya le pagó 25,00 de lo retenido: les faltan 25,00.
 */

type E10 = { db: Db; user: TestUser; titularA: string; titularB: string; gatewayId: string; schemeId: string };

/** Un aviso pasajero con ese texto. */
const toastWith = (page: Page, text: string) =>
  page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: text });

async function checkScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Lo de un beneficiario en el reparto del detalle. */
const share = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole("list", { name: "Reparto" }).getByRole("listitem").filter({ hasText: name });

/** Un cobro de la lista por su referencia: tarjeta en el celular, fila en el escritorio. */
const listed = (page: Page, isMobile: boolean, reference: string): Locator =>
  page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: reference });

/** Titulares, OTF Demo (con su retención, a la Cuenta principal) y el esquema de E10 como el de la empresa. */
async function setupE10(): Promise<E10> {
  const user = await newUser();
  const db = await signInAal1(user.email, user.password);
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
  await db
    .rpc("pay_save_gateway_retention", {
      p: {
        gateway_id: gatewayId,
        pct: "5",
        days: 30,
        recipients: [
          { beneficiary_id: idOf("Titular A"), pct: "50" },
          { beneficiary_id: idOf("Titular B"), pct: "50" },
        ],
      },
    })
    .throwOnError();
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
  return {
    db,
    user,
    titularA: idOf("Titular A"),
    titularB: idOf("Titular B"),
    gatewayId,
    schemeId: scheme.scheme_id,
  };
}

/** E10 guardado sin pasar por la pantalla: 1000,00 el 10 nov 2026 al mediodía por OTF Demo. Devuelve su id. */
async function chargeE10({ db, user, gatewayId, schemeId }: E10, reference: string): Promise<string> {
  const id = randomUUID();
  await serverData().createTx(db, {
    id,
    companyId: user.basics.companyId,
    channelId: null,
    gatewayId,
    extraIds: [],
    schemeId,
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

/** Las liquidaciones del usuario con cuántos cobros paga cada una: [monto, cobros], de mayor a menor. */
async function settlements(db: Db): Promise<[string, number][]> {
  const rows = unwrap(
    await db
      .from("pay_settlements")
      .select("amount::text, pay_settlement_items(transaction_id)")
      .order("amount", { ascending: false }),
    "liquidaciones",
  );
  return rows.map((row) => [row.amount, row.pay_settlement_items.length]);
}

const NOVEMBER = "periodo=personalizado&desde=2026-11-01&hasta=2026-11-30";

test.describe("pagos a las partes del reparto", () => {
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

  test("P1 y P2 desde el detalle: lo que falta a cada parte, «Marcar todo el reparto pagado» y los saldos", async ({
    page,
    isMobile,
  }) => {
    const e10 = await setupE10();
    const reference = `E10-${randomUUID().slice(0, 8)}`;
    const txId = await chargeE10(e10, reference);
    await login(page, e10.user);

    // Antes, el saldo de Grupo A es todo su reparto.
    await page.goto(`/pasarelas/repartos/beneficiarios/${e10.user.basics.beneficiaryIds.a}`);
    await expect(page.getByRole("region", { name: "Saldo" }).getByTestId("saldo-USD")).toHaveText("$580,53");

    // P1: a cada parte le falta lo suyo; a los titulares, lo que no les pagó la pasarela.
    await page.goto(`/pasarelas/cobros/${txId}`);
    await expect(share(page, "Grupo A")).toContainText("Falta $580,53");
    await expect(share(page, "Grupo B")).toContainText("Falta $290,27");
    for (const name of ["Titular A", "Titular B"]) {
      await expect(share(page, name)).toContainText("ya recibió $25,00 de la retención");
      await expect(share(page, name)).toContainText("Falta $25,00");
    }
    await checkScreen(page);

    // La lista: «Reparto: 0 de 4 pagados».
    await page.goto(`/pasarelas/cobros?${NOVEMBER}&q=${reference}`);
    await expect(listed(page, isMobile, reference)).toContainText("Reparto: 0 de 4 pagados");

    // P2: un pago por parte, en un solo paso y con una sola confirmación.
    await page.goto(`/pasarelas/cobros/${txId}`);
    await page.getByRole("button", { name: "Marcar todo el reparto pagado…" }).click();
    const dialog = page.getByRole("dialog", { name: "Marcar todo el reparto pagado" });
    const planned = dialog.getByRole("list", { name: "Pagos que se registran" });
    await expect(planned).toContainText("Grupo A$580,53");
    await expect(planned).toContainText("Grupo B$290,27");
    await expect(planned).toContainText("Titular A$25,00");
    await expect(planned).toContainText("Titular B$25,00");
    await expect(planned).toContainText("En total$920,80");
    await dialog.getByLabel("Medio").fill("Transferencia");
    await checkScreen(page);
    await dialog.getByRole("button", { name: "Marcar 4 pagos" }).click();
    await expect(toastWith(page, "4 pagos marcados")).toBeVisible();
    await expect(dialog).toBeHidden();
    for (const name of ["Grupo A", "Grupo B", "Titular A", "Titular B"]) {
      await expect(share(page, name).getByText("Pagado", { exact: true })).toBeVisible();
    }
    await expect(share(page, "Grupo A")).toContainText(/Pagado el .+: \$580,53/);
    await expect(page.getByRole("list", { name: "Reparto" }).getByRole("button", { name: /^Marcar pagado/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Marcar todo el reparto pagado…" })).toHaveCount(0);
    await checkScreen(page);
    expect(await settlements(e10.db)).toEqual([
      ["580.53", 1],
      ["290.27", 1],
      ["25.00", 1],
      ["25.00", 1],
    ]);

    // La lista dice «Reparto pagado» y los saldos bajan en lo mismo.
    await page.goto(`/pasarelas/cobros?${NOVEMBER}&q=${reference}`);
    await expect(listed(page, isMobile, reference)).toContainText("Reparto pagado");
    await checkScreen(page);
    await page.goto(`/pasarelas/repartos/beneficiarios/${e10.user.basics.beneficiaryIds.a}`);
    await expect(page.getByRole("region", { name: "Saldo" }).getByTestId("saldo-USD")).toHaveText("$0,00");
    // La ficha dice de qué cobro es la liquidación, con su enlace.
    const paid = page.getByRole("region", { name: "Liquidaciones" }).getByRole("list", { name: "Cobros que paga" });
    await expect(paid.getByRole("link", { name: new RegExp(reference) })).toHaveAttribute(
      "href",
      `/pasarelas/cobros/${txId}`,
    );
    await expect(paid).toContainText("$580,53");
    await checkScreen(page);
  });

  test("pago parcial de una parte, y «Deshacer» lo vuelve a dejar como estaba", async ({ page }) => {
    const e10 = await setupE10();
    const txId = await chargeE10(e10, `E10-${randomUUID().slice(0, 8)}`);
    await login(page, e10.user);
    await page.goto(`/pasarelas/cobros/${txId}`);

    await share(page, "Grupo A").getByRole("button", { name: "Marcar pagado… a Grupo A" }).click();
    const dialog = page.getByRole("dialog", { name: "Marcar pagado a Grupo A" });
    await expect(dialog).toContainText("Le falta $580,53 en este cobro.");
    const amount = dialog.getByLabel("Monto");
    await expect(amount).toHaveValue("580,53");
    // No se le paga más de lo que falta.
    await amount.fill("600");
    await dialog.getByRole("button", { name: "Marcar pagado" }).click();
    await expect(dialog.getByText("No puede pasar de lo que falta ($580,53)")).toBeVisible();
    await checkScreen(page);
    await amount.fill("500");
    await dialog.getByRole("button", { name: "Marcar pagado" }).click();
    await expect(toastWith(page, "Pago a Grupo A marcado")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(share(page, "Grupo A")).toContainText("Falta $80,53");
    await expect(share(page, "Grupo A")).toContainText(/Pagado el .+: \$500,00/);
    await checkScreen(page);

    // Deshacer: solo de este cobro, se borra con confirmación.
    await share(page, "Grupo A").getByRole("button", { name: /^Deshacer el pago a Grupo A/ }).click();
    const confirm = page.getByRole("alertdialog", { name: "¿Deshacer este pago?" });
    await expect(confirm).toContainText(/Se borra el pago a Grupo A de \$500,00 del .+, y en este cobro vuelve a faltarle eso/);
    await checkScreen(page);
    await confirm.getByRole("button", { name: "Deshacer el pago" }).click();
    await expect(toastWith(page, "Pago deshecho")).toBeVisible();
    await expect(share(page, "Grupo A")).toContainText("Falta $580,53");
    await expect(share(page, "Grupo A")).not.toContainText("Pagado el");
    expect(await settlements(e10.db)).toEqual([]);
    await checkScreen(page);
  });

  test("P3 desde la lista con el filtro «Reparto pendiente», y P5: deshacer un pago de dos cobros", async ({
    page,
    isMobile,
  }) => {
    const e10 = await setupE10();
    const tag = randomUUID().slice(0, 8);
    const [first, second, done] = [`E10-${tag}-1`, `E10-${tag}-2`, `E10-${tag}-pagado`];
    const firstId = await chargeE10(e10, first);
    const secondId = await chargeE10(e10, second);
    const doneId = await chargeE10(e10, done);
    // Uno ya pagado del todo (sin pasar por la pantalla): no sale con el filtro.
    unwrap(
      await e10.db.rpc("pay_record_payouts", {
        p: {
          settlements: [
            [e10.user.basics.beneficiaryIds.a, "580.53"],
            [e10.user.basics.beneficiaryIds.b, "290.27"],
            [e10.titularA, "25.00"],
            [e10.titularB, "25.00"],
          ].map(([beneficiary, amount]) => ({
            id: randomUUID(),
            beneficiary_id: beneficiary,
            paid_on: "2026-11-11",
            currency: "USD",
            amount,
            items: [{ transaction_id: doneId, amount }],
          })),
        },
      }),
      "pagar el tercero",
    );
    await login(page, e10.user);

    await page.goto(`/pasarelas/cobros?${NOVEMBER}&q=${tag}`);
    await expect(listed(page, isMobile, done)).toContainText("Reparto pagado");
    // «Reparto pendiente», en «Más filtros».
    await page.getByText("Más filtros").click();
    await page.getByLabel("Reparto").selectOption({ label: "Reparto pendiente" });
    await expect(page).toHaveURL(/reparto=pendiente/);
    await expect(page.getByText("Más filtros (1)")).toBeVisible();
    await expect(listed(page, isMobile, done)).toHaveCount(0);
    for (const reference of [first, second]) {
      await expect(listed(page, isMobile, reference)).toContainText("Reparto: 0 de 4 pagados");
    }
    await checkScreen(page);

    // P3: los dos elegidos, «Pagar repartos…»: una cuenta por parte, con lo de los dos cobros.
    await page.getByRole("checkbox", { name: "Seleccionar todos los cobros de esta página" }).check();
    await page.getByRole("button", { name: "Pagar repartos…" }).click();
    const dialog = page.getByRole("dialog", { name: "Pagar repartos" });
    const choice = (name: string) => dialog.getByRole("checkbox", { name: new RegExp(`^${name}`) });
    await expect(choice("Grupo A")).toBeChecked();
    await expect(dialog.getByText("Grupo A").locator("..")).toContainText("$1.161,06");
    await expect(dialog.getByText("Grupo B").locator("..")).toContainText("$580,54");
    await expect(dialog.getByText("Titular A").locator("..")).toContainText("$50,00");
    await expect(dialog.getByText("Titular B").locator("..")).toContainText("$50,00");
    await expect(dialog.getByText("en 2 cobros", { exact: true })).toHaveCount(4);
    await expect(dialog.getByText("Se les pagó de más")).toHaveCount(0);
    await checkScreen(page);
    await dialog.getByRole("button", { name: "Registrar 4 pagos" }).click();
    await expect(toastWith(page, "4 pagos registrados")).toBeVisible();
    await expect(dialog).toBeHidden();
    // Ya no les falta nada: el filtro se queda sin cobros.
    await expect(page.getByText("No hay cobros con estos filtros")).toBeVisible();
    await checkScreen(page);
    expect((await settlements(e10.db)).filter(([, count]) => count === 2)).toEqual([
      ["1161.06", 2],
      ["580.54", 2],
      ["50.00", 2],
      ["50.00", 2],
    ]);

    // P5: «Deshacer» el pago de Grupo B avisa que desmarca los dos cobros.
    await page.goto(`/pasarelas/cobros/${firstId}`);
    await expect(share(page, "Grupo B")).toContainText("(de un pago de $580,54 por 2 cobros)");
    await share(page, "Grupo B").getByRole("button", { name: /^Deshacer el pago a Grupo B/ }).click();
    const confirm = page.getByRole("alertdialog", { name: "¿Deshacer este pago?" });
    await expect(confirm).toContainText(
      `cubre 2 cobros, y se desmarcan los dos: este ($290,27) y el cobro ${second} ($290,27).`,
    );
    await checkScreen(page);
    await confirm.getByRole("button", { name: "Deshacer el pago" }).click();
    await expect(toastWith(page, "Pago deshecho")).toBeVisible();
    await expect(share(page, "Grupo B")).toContainText("Falta $290,27");
    await page.goto(`/pasarelas/cobros/${secondId}`);
    await expect(share(page, "Grupo B")).toContainText("Falta $290,27");
    await expect(share(page, "Grupo A").getByText("Pagado", { exact: true })).toBeVisible();
    await page.goto(`/pasarelas/cobros?${NOVEMBER}&q=${tag}&reparto=pendiente`);
    for (const reference of [first, second]) {
      await expect(listed(page, isMobile, reference)).toContainText("Reparto: 3 de 4 pagados");
    }
  });
});
