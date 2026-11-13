import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  ZONE,
  addDays,
  formatWindowShort,
  todayNY,
  wallTimeToInstant,
  windowDayLabels,
} from "../src/lib/pasarelas/dates";
import { e1Item, saveTransactions, signInAal1, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Cuánto tarda en caer el dinero: ventanas «de 3 a 5 días», en el celular (390×844) y en el escritorio (1280×800).
 * Un usuario nuevo trae lo de E1 (`newUser()`): Escuela Demo y Stripe 2,9 % + 0,30 con «Pago rápido» (0 días),
 * apagado por defecto; sus feriados bancarios de 2026 se siembran al entrar (el miércoles 11 de noviembre es el Día
 * de los Veteranos).
 *
 * La ventana se configura por la ficha de la pasarela (3 a 5 días hábiles; el recargo internacional, de 7 a 10) y
 * se comprueba al registrar, en el detalle, en la lista de cobros y en el Resumen. Los cobros de «atrasado» se
 * preparan directo en la base (`pay_save_transactions`), con fechas relativas a hoy.
 */

const QUESTION = "¿El pago fue nacional o internacional?";

/** El aviso pasajero con ese texto. */
const toastWith = (page: Page, text: string) =>
  page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: text });

async function checkScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Cómo se nombra un grupo de próximos depósitos con una ventana: «Entre el lun 16 y el mié 18 nov · …». */
function groupName(from: string, to: string): RegExp {
  const [first, last] = windowDayLabels({ from, to });
  return new RegExp(`^Entre el ${first} y el ${last} · `);
}

/** Las dos puntas de la ventana de un cobro, como `<time>`: [desde, hasta]. */
async function windowTimes(scope: Locator): Promise<(string | null)[]> {
  const times = scope.getByTestId("fecha-estimada").locator("time");
  return Promise.all((await times.all()).map((time) => time.getAttribute("datetime")));
}

/** Un cobro de la lista: su fila (escritorio) o su tarjeta (celular). */
const cobro = (page: Page, isMobile: boolean, reference: string): Locator =>
  page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: reference });

/** Los días de Stripe y de su recargo internacional, como están en la base. */
async function savedDays(db: Db, gatewayId: string) {
  const gateway = await db.from("pay_gateways").select("payout_days, payout_days_max").eq("id", gatewayId).single();
  const international = await db
    .from("pay_gateway_extras")
    .select("id, payout_days_override, payout_days_override_max")
    .eq("gateway_id", gatewayId)
    .eq("kind", "internacional")
    .eq("active", true);
  return { gateway: gateway.data, international: international.data ?? [] };
}

test.describe("ventanas de depósito", () => {
  /** Quien registra: Stripe tarda de 3 a 5 días hábiles y su recargo internacional, de 7 a 10. */
  let owner: TestUser;
  let ownerDb: Db;

  /** Los errores sin atrapar de la página y lo que React avisa por consola: cada prueba termina sin ninguno. */
  let pageErrors: string[] = [];

  test.beforeAll(async () => {
    owner = await newUser();
    ownerDb = await signInAal1(owner.email, owner.password);
    // Lo que la ficha guarda (la primera prueba lo hace por la pantalla con otro usuario), preparado en la base.
    const days = await ownerDb
      .from("pay_gateways")
      .update({ payout_days: 3, payout_days_max: 5 })
      .eq("id", owner.basics.gatewayId)
      .select("id");
    if (days.error) throw new Error(`No se pudieron poner los días de Stripe: ${days.error.message}`);
    const international = await ownerDb.from("pay_gateway_extras").insert({
      gateway_id: owner.basics.gatewayId,
      kind: "internacional",
      name: "Pago internacional",
      pct: "1.5",
      payout_days_override: 7,
      payout_days_override_max: 10,
      sort: 1,
    });
    if (international.error) throw new Error(`No se pudo agregar el recargo: ${international.error.message}`);
  });

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

  test("la ficha de Stripe: «Días al depósito: de 3 a 5» y el pago internacional con sus días, de 7 a 10", async ({
    page,
  }) => {
    const solo = await newUser();
    const soloDb = await signInAal1(solo.email, solo.password);
    const gatewayId = solo.basics.gatewayId;
    await login(page, solo);
    await page.goto(`/pasarelas/pasarelas/${gatewayId}`);
    const data = page.getByRole("region", { name: "Datos" });
    const days = data.getByRole("group", { name: "Días al depósito", exact: true });
    await expect(days.getByLabel("De", { exact: true })).toHaveValue("2");
    await expect(days.getByLabel("A (opcional)")).toHaveValue("");
    await checkScreen(page);

    // Un máximo menor que el mínimo no se guarda: lo dice junto al campo.
    await days.getByLabel("De", { exact: true }).fill("3");
    await days.getByLabel("A (opcional)").fill("2");
    await data.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(days.getByText("Escribe un número de días entre 3 y 60")).toBeVisible();
    expect((await savedDays(soloDb, gatewayId)).gateway).toEqual({ payout_days: 2, payout_days_max: null });

    await days.getByLabel("A (opcional)").fill("5");
    await data.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(toastWith(page, "Cambios guardados.")).toBeVisible();
    expect((await savedDays(soloDb, gatewayId)).gateway).toEqual({ payout_days: 3, payout_days_max: 5 });
    // El tiempo configurado lo dice; el real no cambia (mide lo que de verdad tardó).
    await expect(page.getByRole("region", { name: "Tiempo real de depósito" })).toContainText("De 3 a 5 días hábiles");

    const card = page.getByRole("region", { name: "Pagos internacionales" });
    await card.getByLabel("Recargo", { exact: true }).fill("1,5");
    const choice = card.getByLabel("Días al depósito", { exact: true });
    await expect(choice).toHaveValue("iguales");
    await choice.selectOption({ label: "Tienen sus propios días" });
    const own = card.getByRole("group", { name: "Sus días al depósito" });
    await own.getByLabel("De", { exact: true }).fill("7");
    await own.getByLabel("A (opcional)").fill("10");
    await card.getByRole("button", { name: "Agregar recargo" }).click();
    await expect(toastWith(page, "Recargo agregado")).toBeVisible();
    const [international, ...more] = (await savedDays(soloDb, gatewayId)).international;
    expect(more).toEqual([]);
    expect(international).toMatchObject({ payout_days_override: 7, payout_days_override_max: 10 });
    await page.reload();
    const reloaded = page.getByRole("region", { name: "Pagos internacionales" });
    await expect(reloaded.getByLabel("Días al depósito", { exact: true })).toHaveValue("propios");
    await expect(reloaded.getByRole("group", { name: "Sus días al depósito" }).getByLabel("A (opcional)")).toHaveValue(
      "10",
    );
    await checkScreen(page);
  });

  /** Abre «Registrar cobro» con Escuela Demo y Stripe, 100 USD el martes 10 de noviembre a las 10:00. */
  async function startCharge(page: Page): Promise<{ reference: string; preview: Locator }> {
    await login(page, owner);
    await page.goto("/pasarelas/registrar");
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
    await expect(page.getByRole("switch", { name: "Pago rápido" })).not.toBeChecked();
    await page.getByLabel("Monto").fill("100");
    await page.getByLabel("Fecha y hora").fill("2026-11-10T10:00");
    const reference = `VENTANA-${randomUUID().slice(0, 8)}`;
    await page.getByLabel("Referencia").fill(reference);
    return { reference, preview: page.getByRole("region", { name: "Vista previa" }) };
  }

  /** Guarda el cobro y abre su detalle desde el aviso. */
  async function saveAndOpen(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Guardar" }).click();
    await toastWith(page, "Cobro guardado").getByRole("button", { name: "Ver cobro" }).click();
    await expect(page).toHaveURL(/\/pasarelas\/cobros\/[0-9a-f-]{36}$/);
  }

  /** Las dos fechas guardadas del cobro con esa referencia: [desde, la estimada]. */
  async function savedWindow(reference: string) {
    const { data } = await ownerDb
      .from("pay_transactions")
      .select("estimated_deposit_from, estimated_deposit_on")
      .eq("reference", reference)
      .single();
    return [data?.estimated_deposit_from, data?.estimated_deposit_on];
  }

  test("de 3 a 5 hábiles desde el mar 10 nov, feriado en medio: «Llega entre el lun 16 y el mié 18 nov»", async ({
    page,
  }) => {
    const { reference, preview } = await startCharge(page);
    await expect(preview.getByTestId("fecha-estimada")).toHaveText("Llega entre el lun 16 y el mié 18 nov");
    expect(await windowTimes(preview)).toEqual(["2026-11-16", "2026-11-18"]);
    await checkScreen(page);

    await saveAndOpen(page);
    const detail = page.getByRole("main");
    await expect(detail.getByTestId("fecha-estimada")).toHaveText("Llega entre el lun 16 y el mié 18 nov");
    expect(await windowTimes(detail)).toEqual(["2026-11-16", "2026-11-18"]);
    expect(await savedWindow(reference)).toEqual(["2026-11-16", "2026-11-18"]);
    await checkScreen(page);

    // Ya depositado, la ventana se lee en pasado: ya no «llega».
    await page.getByRole("region", { name: "Acciones" }).getByRole("button", { name: "Marcar depositado" }).click();
    const deposit = page.getByRole("dialog", { name: "Marcar depositado" });
    await deposit.getByLabel("Fecha del depósito").fill(todayNY(new Date()));
    await deposit.getByRole("button", { name: "Marcar depositado" }).click();
    await expect(deposit).toBeHidden();
    await expect(detail.getByTestId("fecha-estimada")).toHaveText("Se estimaba entre el lun 16 y el mié 18 nov");
  });

  test("con «Pago rápido» (0 días): el mismo día", async ({ page }) => {
    const { reference, preview } = await startCharge(page);
    await page.getByRole("switch", { name: "Pago rápido" }).check();
    await expect(preview.getByTestId("fecha-estimada")).toHaveText("Llega el mar 10 nov");
    expect(await windowTimes(preview)).toEqual(["2026-11-10"]);

    await saveAndOpen(page);
    await expect(page.getByRole("main").getByTestId("fecha-estimada")).toHaveText("Llega el mar 10 nov");
    expect(await savedWindow(reference)).toEqual([null, "2026-11-10"]);
  });

  test("internacional de 7 a 10 hábiles: su ventana, «Llega entre el vie 20 y el mié 25 nov»", async ({ page }) => {
    const { reference, preview } = await startCharge(page);
    await page.getByLabel(QUESTION).selectOption("internacional");
    await expect(preview.getByTestId("fecha-estimada")).toHaveText("Llega entre el vie 20 y el mié 25 nov");
    await checkScreen(page);

    await saveAndOpen(page);
    await expect(page.getByRole("main").getByTestId("fecha-estimada")).toHaveText(
      "Llega entre el vie 20 y el mié 25 nov",
    );
    expect(await savedWindow(reference)).toEqual(["2026-11-20", "2026-11-25"]);
  });

  test("«Atrasado» solo después de la más tardía; la lista y el Resumen dicen la ventana corta", async ({
    page,
    isMobile,
  }) => {
    const today = todayNY(new Date());
    const occurredOn = addDays(today, -10);
    const prefix = `atr_${randomUUID().slice(0, 6)}`;
    /** Un cobro E1 por caer con esa ventana, guardado directo en la base. */
    const pending = (reference: string, from: string, on: string) =>
      e1Item(owner.basics, {
        reference,
        occurred_on: occurredOn,
        occurred_at: wallTimeToInstant(`${occurredOn}T12:00`, ZONE),
        estimated_deposit_from: from,
        estimated_deposit_on: on,
      });
    // La más temprana ya pasó, pero la más tardía es hoy: todavía no está atrasado.
    const onTime = { reference: `${prefix}_hoy`, from: addDays(today, -3), to: today };
    // Hasta la más tardía ya pasó (ayer): atrasado.
    const late = { reference: `${prefix}_ayer`, from: addDays(today, -5), to: addDays(today, -1) };
    await saveTransactions(ownerDb, [
      pending(onTime.reference, onTime.from, onTime.to),
      pending(late.reference, late.from, late.to),
    ]);

    await login(page, owner);
    await page.goto(`/pasarelas/cobros?periodo=30d&q=${prefix}`);
    const onTimeRow = cobro(page, isMobile, onTime.reference);
    const lateRow = cobro(page, isMobile, late.reference);
    await expect(onTimeRow).toContainText("Registrado");
    await expect(onTimeRow).not.toContainText("Atrasado");
    await expect(onTimeRow).toContainText(formatWindowShort(onTime));
    await expect(lateRow).toContainText("Atrasado");
    await expect(lateRow).toContainText(formatWindowShort(late));
    await checkScreen(page);

    await page.goto("/pasarelas");
    const deposits = page.getByRole("region", { name: "Próximos depósitos" });
    // Cada uno cuenta en el día de su fecha más tardía; el grupo dice la ventana corta.
    const onTimeGroup = deposits.getByRole("article", { name: groupName(onTime.from, onTime.to) });
    const lateGroup = deposits.getByRole("article", { name: groupName(late.from, late.to) });
    await expect(onTimeGroup).toContainText(formatWindowShort(onTime));
    await expect(onTimeGroup).not.toContainText("Atrasado");
    await expect(lateGroup).toContainText(formatWindowShort(late));
    await expect(lateGroup).toContainText("Atrasado");
    await checkScreen(page);
  });
});
