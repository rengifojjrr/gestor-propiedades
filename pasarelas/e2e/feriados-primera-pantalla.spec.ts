import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { signInAal1, unwrap } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser } from "./helpers";

/**
 * La primera pantalla de un usuario nuevo ya trae sus feriados, en el celular (390×844) y en el escritorio
 * (1280×800). Un usuario nuevo (`newUser()`) no tiene ninguno: los siembra la primera pantalla que lee la
 * configuración (`getPayConfig`), y esa misma pantalla calcula con ellos.
 *
 * Se entra DIRECTO a Registrar (por `/login?siguiente=…`), sin pasar por el Resumen: así ninguna otra pantalla los
 * siembra antes, y la prueba no depende del orden ni de qué petición llegue primero. Stripe tarda de 3 a 5 días
 * hábiles; un cobro del martes 10 de noviembre de 2026 salta el Día de los Veteranos (miércoles 11) y llega entre el
 * lun 16 y el mié 18. Sin feriados diría entre el vie 13 y el mar 17.
 */

const WINDOW_TEXT = "Llega entre el lun 16 y el mié 18 nov";
const WINDOW_DAYS = ["2026-11-16", "2026-11-18"];

/** Las dos puntas de la ventana que se ve, como `<time>`: [desde, hasta]. */
async function windowTimes(page: Page, scope: "Vista previa" | "main"): Promise<(string | null)[]> {
  const area = scope === "main" ? page.getByRole("main") : page.getByRole("region", { name: scope });
  const times = area.getByTestId("fecha-estimada").locator("time");
  return Promise.all((await times.all()).map((time) => time.getAttribute("datetime")));
}

test.describe("feriados en la primera pantalla", () => {
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

  test("un usuario nuevo que entra directo a Registrar ya calcula con los feriados, y su cobro los guarda", async ({
    page,
  }) => {
    const user = await newUser();
    const db = await signInAal1(user.email, user.password);
    unwrap(
      await db
        .from("pay_gateways")
        .update({ payout_days: 3, payout_days_max: 5 })
        .eq("id", user.basics.gatewayId)
        .select("id"),
      "días de Stripe",
    );
    expect(unwrap(await db.from("pay_holidays").select("day"), "feriados antes de entrar")).toEqual([]);

    // Sin sesión, Registrar manda a la entrada y vuelve a Registrar: es la primera pantalla de este usuario.
    await page.goto("/pasarelas/registrar");
    await expect(page).toHaveURL(/\/login\?siguiente=/);
    await login(page, user);
    await expect(page).toHaveURL(/\/pasarelas\/registrar$/);
    // Ya pintada (la URL cambia antes de que llegue la pantalla), sembró los feriados bancarios de 2026 y 2027.
    await expect(page.getByLabel("Empresa")).toBeVisible();
    expect(unwrap(await db.from("pay_holidays").select("day"), "feriados sembrados")).toHaveLength(22);

    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
    await page.getByLabel("Monto").fill("100");
    await page.getByLabel("Fecha y hora").fill("2026-11-10T10:00");
    const reference = `FERIADO-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(reference);
    const preview = page.getByRole("region", { name: "Vista previa" });
    await expect(preview.getByTestId("fecha-estimada")).toHaveText(WINDOW_TEXT);
    expect(await windowTimes(page, "Vista previa")).toEqual(WINDOW_DAYS);
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxe(page);

    await page.getByRole("button", { name: "Guardar" }).click();
    await page
      .getByRole("region", { name: /Avisos/ })
      .getByRole("listitem")
      .filter({ hasText: "Cobro guardado" })
      .getByRole("button", { name: "Ver cobro" })
      .click();
    await expect(page).toHaveURL(/\/pasarelas\/cobros\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("main").getByTestId("fecha-estimada")).toHaveText(WINDOW_TEXT);
    expect(await windowTimes(page, "main")).toEqual(WINDOW_DAYS);
    const saved = unwrap(
      await db
        .from("pay_transactions")
        .select("estimated_deposit_from, estimated_deposit_on")
        .eq("reference", reference)
        .single(),
      "cobro guardado",
    );
    expect([saved.estimated_deposit_from, saved.estimated_deposit_on]).toEqual(WINDOW_DAYS);
  });
});
