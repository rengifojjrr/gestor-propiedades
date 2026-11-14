import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDays, todayNY } from "../src/lib/pasarelas";
import { e1Item, saveTransactions, signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * Dos arreglos, en el celular (390×844) y en el escritorio (1280×800):
 * - la retención de una pasarela con una persona que se desactivó: la lista solo ofrece beneficiarios activos, la
 *   tarjeta dice quién está desactivado y qué hacer, y «Guardar retención» explica por qué no guarda;
 * - un cobro reembolsado del todo (bruto vigente 0) ya no ofrece depositarlo: ni como acción principal del detalle ni
 *   en el menú de estado de la lista, y el detalle dice que no hay depósito. Lo ya depositado se conserva y se puede
 *   revertir.
 * Un usuario nuevo trae Escuela Demo, Stripe y los Grupos A, B y C (`newUser()`).
 */

const INACTIVE_TEXT = "Titular A está desactivado: quítalo o vuelve a activarlo en Repartos.";

async function checkScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Titular A y Titular B, y «OTF Demo» reteniendo el 5 % durante 30 días para los dos, mitad y mitad. */
async function setupOtf(db: Db): Promise<{ gatewayId: string; titularA: string; titularB: string }> {
  const titulares = unwrap(
    await db.from("pay_beneficiaries").insert([{ name: "Titular A" }, { name: "Titular B" }]).select("id, name"),
    "titulares",
  );
  const idOf = (name: string) => titulares.find((row) => row.name === name)?.id ?? "";
  const gatewayId = unwrap(
    await db.rpc("pay_create_gateway", { p: { name: "OTF Demo", fee: { pct: "2.9", fixed: "0.20" } } }),
    "pasarela",
  ) as string;
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
  return { gatewayId, titularA: idOf("Titular A"), titularB: idOf("Titular B") };
}

/** Activa o desactiva un beneficiario sin pasar por la pantalla (como «Desactivar» en Repartos). */
async function setActive(db: Db, id: string, active: boolean): Promise<void> {
  unwrap(await db.from("pay_beneficiaries").update({ active }).eq("id", id).select("id"), "beneficiario");
}

/** Los nombres que ofrece una lista de beneficiarios. */
const optionsOf = (select: Locator): Promise<string[]> => select.locator("option").allTextContents();

test.describe("desactivado y reembolso total", () => {
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

  test("la retención con un titular desactivado: lo dice, no lo ofrece y no guarda hasta quitarlo", async ({ page }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    const otf = await setupOtf(db);
    await setActive(db, otf.titularA, false);
    await login(page, user);

    await page.goto(`/pasarelas/pasarelas/${otf.gatewayId}`);
    const card = page.getByRole("region", { name: "Retención" });
    const person = (n: number) => card.getByRole("group", { name: `Persona ${n}` });
    await expect(card.getByTestId("retencion-resumen")).toContainText("Titular A (50 %) y Titular B (50 %)");

    // Junto a la persona desactivada se dice qué hacer; la lista de esa fila la nombra como desactivada.
    await expect(person(1)).toContainText(INACTIVE_TEXT);
    await expect(person(1).getByLabel("Beneficiario")).toHaveValue(otf.titularA);
    expect(await optionsOf(person(1).getByLabel("Beneficiario"))).toEqual([
      "Grupo A",
      "Grupo B",
      "Grupo C",
      "Titular A (desactivado)",
      "Titular B",
    ]);
    // Las demás filas solo ofrecen beneficiarios activos.
    await expect(person(2)).not.toContainText("desactivado");
    expect(await optionsOf(person(2).getByLabel("Beneficiario"))).toEqual([
      "Grupo A",
      "Grupo B",
      "Grupo C",
      "Titular B",
    ]);
    // «Guardar retención» no guarda y dice por qué.
    const save = card.getByRole("button", { name: "Guardar retención" });
    await expect(save).toBeDisabled();
    const blockers = card.getByRole("status").filter({ hasText: "Todavía no se puede guardar" });
    await expect(blockers).toContainText(INACTIVE_TEXT);
    await checkScreen(page);

    // Una persona nueva empieza con un beneficiario activo, y en su lista no está el desactivado.
    await card.getByRole("button", { name: "Agregar persona" }).click();
    await expect(person(3).getByLabel("Beneficiario")).toHaveValue(user.basics.beneficiaryIds.a);
    expect(await optionsOf(person(3).getByLabel("Beneficiario"))).not.toContain("Titular A (desactivado)");
    await card.getByRole("button", { name: "Quitar la persona 3" }).click();

    // Quitado Titular A y con Titular B al 100 %, se guarda.
    await card.getByRole("button", { name: "Quitar la persona 1" }).click();
    await expect(card).not.toContainText(INACTIVE_TEXT);
    await person(1).getByLabel("Porcentaje").fill("100");
    await expect(save).toBeEnabled();
    await checkScreen(page);
    await save.click();
    await expect(
      page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: "Retención guardada" }),
    ).toBeVisible();
    await expect(card.getByTestId("retencion-resumen")).toContainText("se lo paga a Titular B (100 %)");

    // Si alguien lo desactiva con la ficha abierta, la base no guarda y el error dice por qué.
    await card.getByRole("button", { name: "Agregar persona" }).click();
    await person(2).getByLabel("Beneficiario").selectOption({ label: "Grupo C" });
    await person(1).getByLabel("Porcentaje").fill("50");
    await person(2).getByLabel("Porcentaje").fill("50");
    await setActive(db, user.basics.beneficiaryIds.c, false);
    await save.click();
    await expect(card.getByRole("alert")).toContainText(
      "Una de las personas está desactivada: quítala o vuelve a activarla en Repartos.",
    );
    await checkScreen(page);
  });

  test("un cobro reembolsado del todo no ofrece «Marcar depositado» ni dice cuándo llega", async ({ page, isMobile }) => {
    const user: TestUser = await newUser();
    const db = await signInAal1(user.email, user.password);
    const today = todayNY(new Date());
    const on = addDays(today, -2);
    const [refunded = "", deposited = ""] = (
      await saveTransactions(
        db,
        ["rt_reembolsado", "rt_depositado"].map((reference, index) =>
          e1Item(user.basics, {
            reference,
            occurred_at: `${on}T15:0${index}:00+00:00`,
            occurred_on: on,
            estimated_deposit_on: on,
          }),
        ),
      )
    ).map((row) => row.id);
    const data = serverData();
    // Uno se reembolsa del todo sin haberse depositado; el otro, después de depositarse.
    await data.refundTx(db, refunded, { amount: "100.00", on: today });
    const [snapshot] = await data.getSnapshots(db, [deposited]);
    await data.depositOneTx(db, deposited, on, snapshot?.updatedAt ?? "");
    await data.refundTx(db, deposited, { amount: "100.00", on: today });
    await login(page, user);

    // El detalle: la acción principal ya no es «Marcar depositado» y la fecha dice que no hay depósito.
    await page.goto(`/pasarelas/cobros/${refunded}`);
    const actions = page.getByRole("region", { name: "Acciones" });
    await expect(actions.getByRole("link", { name: "Editar" })).toBeVisible();
    await expect(actions.getByRole("button", { name: "Marcar depositado" })).toHaveCount(0);
    await expect(page.getByTestId("fecha-estimada")).toHaveText("Reembolsado del todo: no hay depósito");
    await expect(page.getByTestId("bruto")).toHaveText("$0,00");
    await checkScreen(page);

    // Lo ya depositado se conserva: dice cuándo se depositó.
    await page.goto(`/pasarelas/cobros/${deposited}`);
    await expect(page.getByTestId("depositado-el")).toBeVisible();
    await expect(page.getByTestId("fecha-estimada")).not.toContainText("no hay depósito");

    // La lista: el reembolsado sin depositar no tiene cambios de estado; el depositado solo se puede revertir.
    await page.goto("/pasarelas/cobros?periodo=30d&q=rt_");
    const row = (text: string) => page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: text });
    await expect(row("rt_reembolsado")).toContainText("Reembolsado");
    await expect(row("rt_reembolsado").getByRole("button", { name: /^Cambiar estado/ })).toHaveCount(0);
    await row("rt_depositado").getByRole("button", { name: "Cambiar estado del cobro rt_depositado" }).click();
    const menu = page.getByRole("dialog", { name: "Cambiar estado" });
    await expect(menu.getByRole("listitem")).toHaveText(["Revertir el depósito"]);
    await checkScreen(page);
  });
});
