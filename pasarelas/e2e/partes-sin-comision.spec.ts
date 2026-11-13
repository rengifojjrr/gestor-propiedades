import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ZONE, todayNY, wallTimeToInstant } from "../src/lib/pasarelas/dates";
import type { FeesPaidBy } from "../src/lib/pasarelas/types";
import { signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * Partes que no pagan comisión, en el celular (390×844) y en el escritorio (1280×800). Un usuario nuevo trae
 * Escuela Demo, Stripe 2,9 % + 0,30 (sin opciones encendidas) y los Grupos A, B y C (`newUser()`).
 *
 * E9: 1000,00 USD pagando nosotros, con el 50/30/20 «Sobre el neto» y el Grupo C sin comisión → comisión 29,30 y neto
 * 970,70; C recibe el 20 % del bruto (200,00) y A y B se reparten los 770,70 que quedan, 50:30 → 481,69 · 289,01.
 * Sin la marca, el reparto de siempre: 485,35 · 291,21 · 194,14.
 */

const QUESTION = "¿Alguien no paga comisión?";
const NO_PAYER = "Alguien tiene que pagar la comisión: deja al menos una parte sin marcar.";
const SENTENCE = "Grupo C no paga comisión: su parte es el 20 % del bruto. La comisión la pagan los demás.";
const E9_SHARES: [string, string, string] = ["$481,69", "$289,01", "$200,00"];
const PLAIN_SHARES: [string, string, string] = ["$485,35", "$291,21", "$194,14"];

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

/** La pregunta y la casilla de cada parte. */
const exemptGroup = (page: Page): Locator => page.getByRole("group", { name: QUESTION });
const exemptBox = (page: Page, name: string): Locator => exemptGroup(page).getByRole("checkbox", { name });

/** Lo que le toca a un beneficiario en el reparto, dentro de `scope`. */
const share = (scope: Page | Locator, name: string): Locator =>
  scope.getByRole("list", { name: "Reparto" }).getByRole("listitem").filter({ hasText: name });

async function expectShares(scope: Page | Locator, amounts: [string, string, string]): Promise<void> {
  await expect(share(scope, "Grupo A")).toContainText(amounts[0]);
  await expect(share(scope, "Grupo B")).toContainText(amounts[1]);
  await expect(share(scope, "Grupo C")).toContainText(amounts[2]);
}

/** El 50/30/20 sobre el neto con el Grupo C sin comisión, que pasa a ser el de la empresa. */
async function schemeWithC(user: TestUser, db: Db): Promise<string> {
  const scheme = unwrap(
    await db.rpc("pay_save_scheme", {
      p: {
        name: "Grupo C sin comisión",
        base: "neto",
        lines: [
          { beneficiary_id: user.basics.beneficiaryIds.a, pct: "50" },
          { beneficiary_id: user.basics.beneficiaryIds.b, pct: "30" },
          { beneficiary_id: user.basics.beneficiaryIds.c, pct: "20", fee_exempt: true },
        ],
      },
    }),
    "esquema",
  ) as { scheme_id: string };
  await useAsDefault(db, user, scheme.scheme_id);
  return scheme.scheme_id;
}

async function useAsDefault(db: Db, user: TestUser, schemeId: string): Promise<void> {
  unwrap(
    await db.from("pay_companies").update({ default_scheme_id: schemeId }).eq("id", user.basics.companyId).select("id"),
    "esquema de la empresa",
  );
}

/** E9 guardado sin pasar por la pantalla: 1000,00 de hoy al mediodía por Stripe, sin canal ni opciones. */
async function chargeE9(db: Db, user: TestUser, schemeId: string, feesPaidBy: FeesPaidBy = "nosotros"): Promise<string> {
  const id = randomUUID();
  const today = todayNY(new Date());
  await serverData().createTx(db, {
    id,
    companyId: user.basics.companyId,
    channelId: null,
    gatewayId: user.basics.gatewayId,
    extraIds: [],
    schemeId,
    occurredOn: today,
    occurredAt: wallTimeToInstant(`${today}T12:00`, ZONE),
    currency: "USD",
    grossOriginal: "1000.00",
    reference: `E9-${randomUUID().slice(0, 8)}`,
    note: null,
    feesPaidBy,
  });
  return id;
}

/** El reparto guardado de un cobro: monto y base de cada fila, de mayor a menor. */
async function savedAllocations(db: Db, reference: string): Promise<{ id: string; rows: [string, string][] }> {
  const tx = unwrap(await db.from("pay_transactions").select("id").eq("reference", reference).single(), "cobro");
  const rows = unwrap(
    await db
      .from("pay_allocations")
      .select("amount::text, base")
      .eq("transaction_id", tx.id)
      .order("amount", { ascending: false }),
    "reparto",
  );
  return { id: tx.id, rows: rows.map((row): [string, string] => [row.amount, row.base]) };
}

test.describe("partes que no pagan comisión", () => {
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

  test("marcar «No paga comisión» en el esquema, registrar E9 con la casilla y verlo en la vista previa y el detalle", async ({
    page,
  }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    await login(page, user);
    const line = (n: number) => page.getByRole("group", { name: `Línea ${n}` });

    // El editor de esquemas: la marca va en cada línea; si todas la llevan, nadie paga la comisión y no se guarda.
    await page.goto("/pasarelas/repartos/esquemas/nuevo");
    await page.getByLabel("Nombre del esquema").fill("Grupo C sin comisión");
    await line(1).getByLabel("Beneficiario").selectOption({ label: "Grupo A" });
    await line(1).getByLabel("Porcentaje").fill("50");
    await page.getByRole("button", { name: "Agregar línea" }).click();
    await line(2).getByLabel("Beneficiario").selectOption({ label: "Grupo B" });
    await line(2).getByLabel("Porcentaje").fill("30");
    await page.getByRole("button", { name: "Agregar línea" }).click();
    await line(3).getByLabel("Beneficiario").selectOption({ label: "Grupo C" });
    await line(3).getByLabel("Porcentaje").fill("20");
    for (const n of [1, 2, 3]) await line(n).getByRole("checkbox", { name: "No paga comisión" }).check();
    await expect(page.getByText(NO_PAYER)).toBeVisible();
    await expect(page.getByRole("button", { name: "Guardar esquema" })).toBeDisabled();
    await checkScreen(page);
    // Sobre el bruto la marca no cambia nada: no se ofrece.
    await page.getByLabel("Se reparte").selectOption({ label: "Sobre el bruto" });
    await expect(page.getByRole("checkbox", { name: "No paga comisión" })).toHaveCount(0);
    await page.getByLabel("Se reparte").selectOption({ label: "Sobre el neto" });
    await line(1).getByRole("checkbox", { name: "No paga comisión" }).uncheck();
    await line(2).getByRole("checkbox", { name: "No paga comisión" }).uncheck();
    await expect(page.getByText(NO_PAYER)).toHaveCount(0);
    await page.getByRole("button", { name: "Guardar esquema" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Grupo C sin comisión" })).toBeVisible();
    const current = page.getByRole("region", { name: "Vigente hoy" });
    await expect(current.getByRole("listitem").filter({ hasText: "Grupo C" })).toContainText("no paga comisión");
    await expect(current.getByRole("listitem").filter({ hasText: "Grupo A" })).not.toContainText("no paga comisión");
    await checkScreen(page);
    const schemeId = /\/esquemas\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname)?.[1] ?? "";
    await useAsDefault(db, user, schemeId);

    // Registrar: pagando nosotros con un esquema sobre el neto, la pregunta sale marcada como dice el esquema.
    await page.goto("/pasarelas/registrar");
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
    await expect(exemptBox(page, "Grupo C")).toBeChecked();
    await expect(exemptBox(page, "Grupo A")).not.toBeChecked();
    await expect(exemptBox(page, "Grupo B")).not.toBeChecked();
    // Cada casilla es un objetivo de 44 px.
    const box = await exemptGroup(page).locator("label").filter({ hasText: "Grupo C" }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByLabel("Monto").fill("1000");
    const preview = page.getByRole("region", { name: "Vista previa" });
    await expect(preview.getByTestId("comisiones")).toHaveText("$29,30");
    await expect(preview.getByTestId("neto")).toHaveText("$970,70");
    await expectShares(preview, E9_SHARES);
    await expect(share(preview, "Grupo C")).toContainText("no paga comisión");
    await expect(share(preview, "Grupo A")).not.toContainText("no paga comisión");
    await expect(preview).toContainText(SENTENCE);
    await checkScreen(page);

    // E9c: con las tres marcadas no queda quién pague: se dice aquí y en la vista previa.
    await exemptBox(page, "Grupo A").check();
    await exemptBox(page, "Grupo B").check();
    await expect(exemptGroup(page).getByText(NO_PAYER)).toBeVisible();
    await expect(preview.getByText(NO_PAYER)).toBeVisible();
    await checkScreen(page);
    await exemptBox(page, "Grupo A").uncheck();
    await exemptBox(page, "Grupo B").uncheck();
    await expectShares(preview, E9_SHARES);

    const first = `E9-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(first);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(toastWith(page, "Cobro guardado")).toBeVisible();
    // Guardado, el formulario queda listo para el siguiente: sin referencia.
    await expect(page.getByLabel("Referencia")).toHaveValue("");
    const saved = await savedAllocations(db, first);
    expect(saved.rows).toEqual([
      ["481.69", "neto"],
      ["289.01", "neto"],
      ["200.00", "bruto"],
    ]);

    // Quitarla para un cobro: vuelve al reparto de siempre, solo en ese cobro.
    await expect(exemptBox(page, "Grupo C")).toBeChecked();
    await exemptBox(page, "Grupo C").uncheck();
    await page.getByLabel("Monto").fill("1000");
    await expectShares(preview, PLAIN_SHARES);
    await expect(preview.getByText("no paga comisión")).toHaveCount(0);
    const second = `E9-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(second);
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByLabel("Referencia")).toHaveValue("");
    expect((await savedAllocations(db, second)).rows).toEqual([
      ["485.35", "neto"],
      ["291.21", "neto"],
      ["194.14", "neto"],
    ]);

    // El esquema no cambió: al volver, la casilla sale como dice él. «Repetir el último» repite la del último cobro.
    await page.reload();
    await expect(exemptBox(page, "Grupo C")).toBeChecked();
    await page.getByRole("button", { name: "Repetir el último" }).click();
    await expect(exemptBox(page, "Grupo C")).not.toBeChecked();

    // El detalle del primero: la línea de C lo dice y una frase explica la cuenta.
    await page.goto(`/pasarelas/cobros/${saved.id}`);
    await expect(page.getByTestId("comisiones")).toHaveText("$29,30");
    await expect(page.getByTestId("neto")).toHaveText("$970,70");
    await expectShares(page, E9_SHARES);
    await expect(share(page, "Grupo C")).toContainText("no paga comisión");
    await expect(page.getByRole("main")).toContainText(SENTENCE);
    await checkScreen(page);
  });

  test("editar: quitarle la marca a un cobro lo devuelve al reparto de siempre, y el historial lo dice", async ({
    page,
  }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    const schemeId = await schemeWithC(user, db);
    const id = await chargeE9(db, user, schemeId);
    await login(page, user);

    await page.goto(`/pasarelas/cobros/${id}/editar`);
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    await expect(exemptBox(page, "Grupo C")).toBeChecked();
    await checkScreen(page);
    await exemptBox(page, "Grupo C").uncheck();
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(page).toHaveURL(new RegExp(`/pasarelas/cobros/${id}$`));
    await expectShares(page, PLAIN_SHARES);
    await expect(page.getByRole("list", { name: "Reparto" }).getByText("no paga comisión")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Historial" }).getByRole("listitem").first()).toContainText(
      "Editado: quién no paga comisión",
    );
    const [snapshot] = await serverData().getSnapshots(db, [id]);
    expect(snapshot?.breakdown.rules.scheme?.lines.map((line) => line.feeExempt)).toEqual([false, false, false]);
    await checkScreen(page);

    // Al volver a editarlo, la pregunta parte de lo que quedó en el cobro, no del esquema.
    await page.goto(`/pasarelas/cobros/${id}/editar`);
    await expect(exemptBox(page, "Grupo C")).not.toBeChecked();
  });

  test("con «El comprador» la pregunta no aparece y la marca no cambia el reparto", async ({ page }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    const schemeId = await schemeWithC(user, db);
    const byBuyer = await chargeE9(db, user, schemeId, "comprador");
    await login(page, user);

    await page.goto("/pasarelas/registrar");
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
    await expect(exemptGroup(page)).toBeVisible();
    await page.getByRole("radio", { name: "El comprador" }).check();
    await expect(exemptGroup(page)).toHaveCount(0);
    await page.getByLabel("Monto").fill("1000");
    const preview = page.getByRole("region", { name: "Vista previa" });
    await expectShares(preview, PLAIN_SHARES);
    await expect(preview.getByText("no paga comisión")).toHaveCount(0);
    await checkScreen(page);
    await page.getByRole("radio", { name: "Nosotros" }).check();
    await expect(exemptBox(page, "Grupo C")).toBeChecked();

    // El detalle y la edición de un cobro de «El comprador», igual.
    await page.goto(`/pasarelas/cobros/${byBuyer}`);
    await expectShares(page, PLAIN_SHARES);
    await expect(page.getByRole("list", { name: "Reparto" }).getByText("no paga comisión")).toHaveCount(0);
    await page.goto(`/pasarelas/cobros/${byBuyer}/editar`);
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    await expect(exemptGroup(page)).toHaveCount(0);
  });
});
