import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDays, formatDate, todayNY } from "../src/lib/pasarelas";
import { e1Item, saveTransactions, signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * Cambiar el estado de un cobro desde la lista de Cobros, sin entrar al detalle: el botón «Cambiar estado» de
 * cada cobro (tarjeta en el celular, fila de la tabla en el escritorio) abre un menú con los cambios que el motor
 * admite. Tras cada cambio: el aviso, la fila al día (estado y columna Depósito) y los totales del filtro, sin
 * perder los filtros, la página ni la selección. Los cobros se crean por la capa de datos con el desglose del motor
 * (E1: 100,00 → comisiones 9,70, neto 90,30).
 */

let user: TestUser;
let client: Db;
let today: string;

test.beforeAll(async () => {
  user = await newUser();
  client = await signInAal1(user.email, user.password);
  today = todayNY(new Date());
});

/** El nombre del botón que abre el menú del cobro con esa referencia: el mismo sujeto que su enlace. */
const triggerName = (reference: string): string => `Cambiar estado del cobro ${reference}`;

/**
 * Registra cobros E1 (Stripe, «Pago rápido»: cae el mismo día) `daysAgo` días antes de hoy, uno por referencia
 * (`null`: sin referencia) y cada uno un minuto después del anterior (la lista, de lo más nuevo a lo más viejo, queda
 * en orden inverso). Devuelve sus ids, en el mismo orden.
 */
async function register(refs: readonly (string | null)[], daysAgo: number): Promise<string[]> {
  const on = addDays(today, -daysAgo);
  const saved = await saveTransactions(
    client,
    refs.map((reference, index) =>
      e1Item(user.basics, {
        reference,
        occurred_at: `${on}T15:${String(index).padStart(2, "0")}:00+00:00`,
        occurred_on: on,
        estimated_deposit_on: on,
      }),
    ),
  );
  return saved.map((row) => row.id);
}

/** La fila (escritorio) o la tarjeta (celular) del cobro con ese texto (su referencia). */
function cobro(page: Page, isMobile: boolean, text: string): Locator {
  return page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: text });
}

/** El menú de estado abierto. */
const menuOf = (page: Page): Locator => page.getByRole("dialog", { name: "Cambiar estado" });

async function stored(id: string): Promise<{ status: string; deposited_on: string | null; net_amount: string }> {
  return unwrap(
    await client.from("pay_transactions").select("status, deposited_on, net_amount::text").eq("id", id).single(),
    "cobro",
  );
}

async function expectCleanScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Lo que dice el detalle (y el menú) antes de revertir un depósito. */
const REVERT = {
  title: "¿Revertir el depósito?",
  description: "El cobro vuelve a «En tránsito» y se borra la fecha real del depósito.",
  confirm: "Revertir depósito",
} as const;

test("desde la lista, registrado → en tránsito → depositado (con fecha) → revertir", async ({ page, isMobile }) => {
  const [id = ""] = await register(["est_ciclo"], 2);
  const yesterday = addDays(today, -1);

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=est_ciclo");
  const row = cobro(page, isMobile, "est_ciclo");
  await expect(row).toContainText("Registrado");
  const trigger = row.getByRole("button", { name: triggerName("est_ciclo") });
  await expect(trigger).toBeEnabled();
  await expectCleanScreen(page);

  // Con el teclado: se abre con Enter, el foco empieza en la primera opción y Tab recorre las demás.
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = menuOf(page);
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("El cobro est_ciclo está «Registrado».");
  await expect(menu.getByRole("listitem")).toHaveText(["Pasar a en tránsito", "Marcar depositado…", "Marcar como fallido"]);
  await expect(menu.getByRole("button", { name: "Pasar a en tránsito" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "Marcar depositado…" })).toBeFocused();
  await expectCleanScreen(page);
  // Escape lo cierra sin cambiar nada y el foco vuelve al botón.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  expect((await stored(id)).status).toBe("registrado");

  await page.keyboard.press("Enter");
  await expect(menu.getByRole("button", { name: "Pasar a en tránsito" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Cobro en tránsito.")).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(row).toContainText("En tránsito");
  await expect(trigger).toBeFocused();
  expect((await stored(id)).status).toBe("en_transito");

  // «Marcar depositado…» abre el diálogo de siempre, con hoy puesto; se elige ayer.
  await trigger.click();
  await expect(menu.getByRole("listitem")).toHaveText(["Marcar depositado…", "Marcar como fallido"]);
  await menu.getByRole("button", { name: "Marcar depositado…" }).click();
  const deposit = page.getByRole("dialog", { name: "Marcar depositado" });
  await expect(deposit).toBeVisible();
  await expect(menu).toBeHidden();
  const date = deposit.getByLabel("Fecha del depósito");
  await expect(date).toHaveValue(today);
  await date.fill(yesterday);
  await expectCleanScreen(page);
  await deposit.getByRole("button", { name: "Marcar depositado" }).click();
  await expect(page.getByText("1 cobro marcado como depositado.")).toBeVisible();
  await expect(deposit).toBeHidden();
  await expect(row).toContainText("Depositado");
  await expect(row).toContainText("Cayó");
  await expect(row).toContainText(formatDate(yesterday));
  await expect(trigger).toBeFocused();
  expect(await stored(id)).toMatchObject({ status: "depositado", deposited_on: yesterday });
  await expectCleanScreen(page);

  // Ya depositado, solo se revierte (la fecha del depósito se cambia en el detalle). Como en el detalle, pide
  // confirmación antes: se borra la fecha real del depósito. Cancelar no cambia nada.
  await trigger.click();
  await expect(menu.getByRole("listitem")).toHaveText(["Revertir el depósito"]);
  await menu.getByRole("button", { name: "Revertir el depósito" }).click();
  const revert = page.getByRole("alertdialog", { name: REVERT.title });
  await expect(revert).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(revert).toContainText(REVERT.description);
  await expectCleanScreen(page);
  await revert.getByRole("button", { name: "Cancelar" }).click();
  await expect(revert).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(row).toContainText("Depositado");
  expect(await stored(id)).toMatchObject({ status: "depositado", deposited_on: yesterday });

  await trigger.click();
  await menu.getByRole("button", { name: "Revertir el depósito" }).click();
  await revert.getByRole("button", { name: REVERT.confirm }).click();
  await expect(page.getByText("Depósito revertido.")).toBeVisible();
  await expect(revert).toBeHidden();
  await expect(menu).toBeHidden();
  await expect(row).toContainText("En tránsito");
  await expect(row).toContainText("Estimado");
  await expect(row).not.toContainText("Cayó");
  await expect(trigger).toBeFocused();
  expect(await stored(id)).toMatchObject({ status: "en_transito", deposited_on: null });
  // Los filtros siguen puestos.
  await expect(page).toHaveURL(/periodo=30d/);
  await expect(page).toHaveURL(/q=est_ciclo/);
});

test("el detalle pide la misma confirmación para revertir el depósito", async ({ page }) => {
  const [id = ""] = await register(["est_detalle"], 2);
  expect(await serverData().depositTx(client, [id], addDays(today, -1))).toBe(1);

  await login(page, user);
  await page.goto(`/pasarelas/cobros/${id}`);
  const actions = page.getByRole("region", { name: "Acciones" });
  await actions.getByRole("button", { name: "Más acciones" }).click();
  await actions.getByRole("button", { name: "Revertir depósito", exact: true }).click();
  const revert = page.getByRole("alertdialog", { name: REVERT.title });
  await expect(revert).toContainText(REVERT.description);
  await expect(revert.getByRole("button", { name: REVERT.confirm })).toBeVisible();
  await revert.getByRole("button", { name: "Cancelar" }).click();
  await expect(revert).toBeHidden();
});

test("el botón se llama como el enlace de su fila: dos cobros parecidos no se confunden", async ({
  page,
  isMobile,
}) => {
  // Tres cobros de 100,00 del mismo día: dos con referencia y uno sin ella, al que luego se le reembolsan 40,00.
  const day = addDays(today, -20);
  const [, , plain = ""] = await register(["est_par_1", "est_par_2", null], 20);
  await serverData().refundTx(client, plain, { amount: "40.00", on: day });

  await login(page, user);
  await page.goto(`/pasarelas/cobros?periodo=personalizado&desde=${day}&hasta=${day}`);
  // Con referencia, la referencia: la de la fila.
  for (const reference of ["est_par_1", "est_par_2"]) {
    const row = cobro(page, isMobile, reference);
    await expect(row.getByRole("link", { name: reference, exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: triggerName(reference), exact: true })).toBeVisible();
  }
  // Sin referencia, como su enlace «Ver cobro»: la fecha y el bruto que enseña la fila (60,00, no los 100,00 cobrados).
  const name = `del ${formatDate(day)} por $60,00`;
  const row = cobro(page, isMobile, "Ver cobro");
  await expect(row).toContainText("$60,00");
  await expect(row.getByRole("link", { name: `Ver cobro ${name}`, exact: true })).toBeVisible();
  const trigger = row.getByRole("button", { name: `Cambiar estado del cobro ${name}`, exact: true });
  await trigger.click();
  await expect(menuOf(page)).toContainText(`El cobro ${name} está «Registrado».`);
  await expectCleanScreen(page);
});

test("marcar como fallido pide confirmación, y luego se reabre", async ({ page, isMobile }) => {
  const [id = ""] = await register(["est_fallido"], 1);

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=est_fallido");
  const row = cobro(page, isMobile, "est_fallido");
  const trigger = row.getByRole("button", { name: triggerName("est_fallido") });
  const menu = menuOf(page);
  const confirm = page.getByRole("alertdialog", { name: "¿Marcar como fallido el cobro est_fallido?" });

  // Cancelar no cambia nada.
  await trigger.click();
  await menu.getByRole("button", { name: "Marcar como fallido" }).click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Sus comisiones, su neto y su reparto quedan en cero");
  await expectCleanScreen(page);
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(row).toContainText("Registrado");
  expect((await stored(id)).status).toBe("registrado");

  await trigger.click();
  await menu.getByRole("button", { name: "Marcar como fallido" }).click();
  await confirm.getByRole("button", { name: "Marcar como fallido" }).click();
  await expect(page.getByText("Cobro marcado como fallido.")).toBeVisible();
  await expect(confirm).toBeHidden();
  await expect(row).toContainText("Fallido");
  await expect(row).toContainText("$0,00");
  expect(await stored(id)).toMatchObject({ status: "fallido", net_amount: "0.00" });
  await expectCleanScreen(page);

  // Un fallido solo se reabre.
  await trigger.click();
  await expect(menu.getByRole("listitem")).toHaveText(["Reabrir"]);
  await menu.getByRole("button", { name: "Reabrir" }).click();
  await expect(page.getByText("Cobro reabierto.")).toBeVisible();
  await expect(row).toContainText("Registrado");
  await expect(row).toContainText("$90,30");
  expect(await stored(id)).toMatchObject({ status: "registrado", net_amount: "90.30" });
});

test("si la confirmación de «fallido» falla, el menú vuelve con el error y el foco en él", async ({
  page,
  isMobile,
}) => {
  const [id = ""] = await register(["est_falla"], 4);

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=est_falla");
  const row = cobro(page, isMobile, "est_falla");
  const trigger = row.getByRole("button", { name: triggerName("est_falla") });
  const menu = menuOf(page);
  const confirm = page.getByRole("alertdialog", { name: "¿Marcar como fallido el cobro est_falla?" });
  await trigger.click();
  await menu.getByRole("button", { name: "Marcar como fallido" }).click();
  await expect(confirm).toBeVisible();

  // Mientras tanto, otra pestaña le cambia la fecha estimada: la versión que se ve ya no es la guardada.
  await serverData().setEstimatedTx(client, id, today);
  await confirm.getByRole("button", { name: "Marcar como fallido" }).click();
  await expect(confirm).toBeHidden();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("alert")).toContainText("Este cobro cambió mientras lo editabas");
  await expect(menu.getByRole("button", { name: "Pasar a en tránsito" })).toBeFocused();
  expect((await stored(id)).status).toBe("registrado");
  await expectCleanScreen(page);

  // Escape lo cierra y el foco vuelve al botón del cobro, como siempre.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

/** Lo que dice la app cuando la llamada a una acción no vuelve: no se sabe si se guardó. */
const UNSURE_TEXT = "Se perdió la conexión y no se sabe si se guardó. Revisa cómo quedó antes de repetirlo.";

test("con mala señal, el menú dice que no se sabe si se guardó y «Ver cómo quedó» enseña que sí", async ({
  page,
  isMobile,
}) => {
  const [id = ""] = await register(["est_corte"], 1);

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=est_corte");
  await page.evaluate(() => {
    document.body.dataset.marca = "sin recargar";
  });
  const row = cobro(page, isMobile, "est_corte");
  const trigger = row.getByRole("button", { name: triggerName("est_corte") });
  await trigger.click();
  const menu = menuOf(page);

  // La acción llega al servidor (y se guarda), pero su respuesta no vuelve.
  await page.route("**/pasarelas/cobros*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || request.headers()["next-action"] === undefined) return route.fallback();
    await route.fetch();
    return route.abort("internetdisconnected");
  });
  await menu.getByRole("button", { name: "Pasar a en tránsito" }).click();
  await expect(menu.getByRole("alert")).toHaveText(UNSURE_TEXT);
  await expect(menu.getByRole("button", { name: "Ver cómo quedó" })).toBeVisible();
  await expect(page.getByText("Cobro en tránsito.")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.dataset.marca)).toBe("sin recargar");
  expect((await stored(id)).status).toBe("en_transito");
  await expectCleanScreen(page);

  // Vuelve la señal: «Ver cómo quedó» pinta la lista con lo guardado, y el menú ya ofrece lo que sigue.
  await page.unrouteAll();
  await menu.getByRole("button", { name: "Ver cómo quedó" }).click();
  await expect(row).toContainText("En tránsito");
  await expect(menu.getByRole("listitem")).toHaveText(["Marcar depositado…", "Marcar como fallido"]);
  expect(await page.evaluate(() => document.body.dataset.marca)).toBe("sin recargar");
});

test("si el cambio saca el cobro del filtro, el foco pasa al siguiente, al anterior o al encabezado", async ({
  page,
  isMobile,
}) => {
  // De lo más nuevo a lo más viejo: est_foco_3, est_foco_2, est_foco_1. El filtro: solo los registrados.
  await register(["est_foco_1", "est_foco_2", "est_foco_3"], 3);

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=est_foco_&estado=registrado");
  const menu = menuOf(page);
  const triggerOf = (reference: string) =>
    cobro(page, isMobile, reference).getByRole("button", { name: triggerName(reference) });
  await expect(page.getByText("Cobros 1–3 de 3")).toBeVisible();

  // El del medio pasa a en tránsito y se va: el foco, al botón del siguiente.
  await triggerOf("est_foco_2").click();
  await menu.getByRole("button", { name: "Pasar a en tránsito" }).click();
  await expect(page.getByText("Cobro en tránsito.")).toBeVisible();
  await expect(cobro(page, isMobile, "est_foco_2")).toHaveCount(0);
  await expect(triggerOf("est_foco_1")).toBeFocused();

  // El último se deposita (con el diálogo de la fecha) y se va: el foco, al botón del anterior.
  await triggerOf("est_foco_1").click();
  await menu.getByRole("button", { name: "Marcar depositado…" }).click();
  await page.getByRole("dialog", { name: "Marcar depositado" }).getByRole("button", { name: "Marcar depositado" }).click();
  await expect(page.getByText("1 cobro marcado como depositado.")).toBeVisible();
  await expect(cobro(page, isMobile, "est_foco_1")).toHaveCount(0);
  await expect(triggerOf("est_foco_3")).toBeFocused();
  await expectCleanScreen(page);

  // El único que queda se marca fallido (tras confirmarlo): la lista queda vacía y el foco, en su aviso.
  await triggerOf("est_foco_3").click();
  await menu.getByRole("button", { name: "Marcar como fallido" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Marcar como fallido" }).click();
  await expect(page.getByText("Cobro marcado como fallido.")).toBeVisible();
  await expect(page.getByText("No hay cobros con estos filtros")).toBeVisible();
  await expect(page.locator(":focus")).toContainText("No hay cobros con estos filtros");
  await expectCleanScreen(page);
});

/**
 * Lo que el HTML no admite dentro de un `<span>` (que solo lleva texto y elementos de texto): bloques como la lista
 * del menú o su `<dialog>`. Fuera de la norma, el navegador lo acepta, pero un lector de pantalla o una herramienta
 * pueden leerlo mal.
 */
async function blocksInsideSpans(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("span dialog, span ul, span ol, span div, span p, span table")].map(
      (element) => element.tagName.toLowerCase(),
    ),
  );
}

test("el menú y sus diálogos van en un contenedor que los admite, no dentro de un <span>", async ({
  page,
  isMobile,
}) => {
  await register(["est_html"], 5);

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=est_html");
  const trigger = cobro(page, isMobile, "est_html").getByRole("button", { name: triggerName("est_html") });
  // Los diálogos se montan la primera vez que se abre el menú.
  await trigger.click();
  await expect(menuOf(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  expect(await blocksInsideSpans(page)).toEqual([]);
});

test("un cobro de la papelera no tiene menú", async ({ page, isMobile }) => {
  const [id = ""] = await register(["est_papelera"], 1);

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=est_papelera");
  await expect(cobro(page, isMobile, "est_papelera").getByRole("button", { name: /^Cambiar estado/ })).toBeVisible();

  // Otra pestaña lo manda a la papelera: ya no está en la lista ni tiene menú.
  expect(await serverData().trashTx(client, [id])).toBe(1);
  await page.reload();
  await expect(page.getByText("No hay cobros con estos filtros")).toBeVisible();
  await expect(page.getByRole("button", { name: /Cambiar estado/ })).toHaveCount(0);

  // En la Papelera tampoco: ahí solo se restaura o se borra. Se mira cuando la página ya responde (abrir y cancelar
  // «Borrar del todo» lo prueba), y se cuentan todos sus botones: uno de más, como un menú de estado, hace fallar.
  await page.goto("/pasarelas/papelera");
  const trashed = page.getByRole("listitem").filter({ hasText: "est_papelera" });
  await trashed.getByRole("button", { name: /^Borrar del todo/ }).click();
  const purge = page.getByRole("alertdialog");
  await expect(purge).toBeVisible();
  await purge.getByRole("button", { name: "Cancelar" }).click();
  await expect(purge).toBeHidden();
  await expect(trashed.getByRole("button")).toHaveText([/^Restaurar/, /^Borrar del todo/]);
  await expect(page.getByRole("button", { name: /Cambiar estado/ })).toHaveCount(0);
  await expectCleanScreen(page);
});

test("los totales del filtro se actualizan, sin perder los filtros, la página ni la selección", async ({
  page,
  isMobile,
}) => {
  // 51 cobros: pg_51 es el más nuevo y pg_01, el más viejo, queda solo en la página 2.
  const refs = Array.from({ length: 51 }, (_, i) => `pg_${String(i + 1).padStart(2, "0")}`);
  await register(refs, 1);

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=pg_&pagina=2");
  const url = page.url();
  const totals = page.getByRole("region", { name: "Totales del filtro" });
  await expect(totals.getByText("USD: 51 cobros · neto $4.605,30")).toBeVisible();
  const row = cobro(page, isMobile, "pg_01");
  await expect(row).toContainText("Registrado");

  // La casilla sigue a lo suyo: lo elegido sigue elegido tras cambiar el estado desde el menú.
  const checkbox = page.getByRole("checkbox", { name: "Seleccionar el cobro pg_01" });
  await checkbox.check();
  await expect(page.getByText("1 seleccionado")).toBeVisible();

  const trigger = row.getByRole("button", { name: triggerName("pg_01") });
  await trigger.click();
  await menuOf(page).getByRole("button", { name: "Marcar como fallido" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Marcar como fallido" }).click();
  await expect(page.getByText("Cobro marcado como fallido.")).toBeVisible();
  // Los fallidos no cuentan en los totales.
  await expect(totals.getByText("USD: 50 cobros · neto $4.515,00")).toBeVisible();
  await expect(row).toContainText("Fallido");
  expect(page.url()).toBe(url);
  await expect(page.getByText(/^Cobros 51–51 de 51$/)).toBeVisible();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText("1 seleccionado")).toBeVisible();
  await expectCleanScreen(page);

  await trigger.click();
  await menuOf(page).getByRole("button", { name: "Reabrir" }).click();
  await expect(page.getByText("Cobro reabierto.")).toBeVisible();
  await expect(totals.getByText("USD: 51 cobros · neto $4.605,30")).toBeVisible();
  await expect(row).toContainText("Registrado");
  expect(page.url()).toBe(url);
  await expect(checkbox).toBeChecked();
});
