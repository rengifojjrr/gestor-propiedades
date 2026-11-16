import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { addDays, todayNY } from "../src/lib/pasarelas";
import { e1Item, saveTransactions, signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Los cargadores: la persona que trajo cada venta, para reportarle lo suyo. En el celular (390×844) y en el
 * escritorio (1280×800): crearlos (C1), registrar un cobro con uno y verlo en el detalle, la lista, el CSV y el PDF
 * (C2), asignarlo en lote y filtrar por él (C3), el reporte del período (C4) y desactivar en vez de borrar (C5).
 * Datos inventados: «Cargador Uno», «Cargador Dos». Cada prueba usa su propio usuario.
 */

let today: string;

test.beforeAll(() => {
  today = todayNY(new Date());
});

/** Un usuario nuevo con su cliente, ya dentro de la app. */
async function enter(page: Page): Promise<{ user: TestUser; db: Db }> {
  const user = await newUser();
  const db = await signInAal1(user.email, user.password);
  await login(page, user);
  return { user, db };
}

async function newLoader(db: Db, name: string): Promise<string> {
  return unwrap(await db.from("pay_loaders").insert({ name }).select("id").single(), name).id;
}

/** Cobros E1 (100,00 → comisiones 9,70, neto 90,30) de ayer, con esas referencias y ese cargador (o ninguno). */
async function register(db: Db, user: TestUser, refs: readonly string[], loaderId: string | null = null) {
  const on = addDays(today, -1);
  return saveTransactions(
    db,
    refs.map((reference) =>
      e1Item(user.basics, {
        reference,
        occurred_at: `${on}T15:00:00+00:00`,
        occurred_on: on,
        estimated_deposit_on: on,
        loader_id: loaderId,
      }),
    ),
  );
}

/** La fila (escritorio) o la tarjeta (celular) del cobro con esa referencia. */
function cobro(page: Page, isMobile: boolean, reference: string): Locator {
  return page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: reference });
}

async function expectCleanScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Abre un `<details>` por el texto de su `<summary>`, si está cerrado. */
async function openDetails(page: Page, summary: string): Promise<void> {
  const details = page.locator("details", { has: page.locator("summary", { hasText: summary }) });
  if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) {
    await page.locator("summary", { hasText: summary }).click();
  }
}

async function pdfTextOf(download: Download): Promise<string> {
  const bytes = await readFile(await download.path());
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return text;
}

test.describe("cargadores", () => {
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

  test("C1: crear «Cargador Uno»; « cargador uno » da el error de nombre repetido", async ({ page }) => {
    await enter(page);
    await page.goto("/pasarelas/cargadores");
    await expect(page.getByRole("heading", { level: 1, name: "Cargadores" })).toBeVisible();
    await expect(page.getByText("Un cargador no cobra del reparto")).toBeVisible();
    await expect(page.getByText("Todavía no hay cargadores")).toBeVisible();
    await expectCleanScreen(page);

    await page.getByRole("button", { name: "Agregar cargador" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Nuevo cargador" });
    await dialog.getByLabel("Nombre").fill("Cargador Uno");
    await dialog.getByLabel("Nota").fill("Trae las ventas de la feria");
    await expectCleanScreen(page);
    await dialog.getByRole("button", { name: "Guardar cargador" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Cargador guardado.")).toBeVisible();
    const uno = page.getByRole("region", { name: "Cargador Uno" });
    await expect(uno).toContainText("Trae las ventas de la feria");
    await expect(uno).toContainText("Sin cobros en este período");
    await expect(page.getByRole("region", { name: "Sin cargador" })).toBeVisible();
    await expectCleanScreen(page);

    await page.getByRole("button", { name: "Agregar cargador" }).click();
    const again = page.getByRole("dialog", { name: "Nuevo cargador" });
    await again.getByLabel("Nombre").fill(" cargador uno ");
    await again.getByRole("button", { name: "Guardar cargador" }).click();
    await expect(again.getByText("Ya hay un cargador con ese nombre.")).toBeVisible();
    await expect(again.getByLabel("Nombre")).toHaveValue(" cargador uno ");
    await expectCleanScreen(page);
    await again.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("region", { name: /cargador uno/i })).toHaveCount(1);
  });

  test("C2: registrar con «Cargador Uno»: el detalle, la lista, el CSV y el PDF lo dicen; se edita", async ({
    page,
    isMobile,
  }) => {
    const { db } = await enter(page);
    const uno = await newLoader(db, "Cargador Uno");
    const reference = `c2_${randomUUID().slice(0, 8)}`;

    await page.goto("/pasarelas/registrar");
    await page.getByLabel("Empresa").selectOption({ label: "Escuela Demo" });
    await page.getByLabel("Canal").selectOption({ label: "Inscripciones en línea" });
    await page.getByLabel("Pasarela").selectOption({ label: "Stripe" });
    await page.getByLabel("Monto").fill("100");
    await page.getByLabel("Referencia").fill(reference);
    // A la vista, sin abrir «Más opciones».
    await page.getByLabel("Cargador").selectOption({ label: "Cargador Uno" });
    await expectCleanScreen(page);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByText("Cobro guardado.")).toBeVisible();
    // Queda elegido para el siguiente, como la empresa y la pasarela.
    await expect(page.getByLabel("Cargador")).toHaveValue(uno);

    // «Repetir el último» lo repite.
    await page.reload();
    await expect(page.getByLabel("Cargador")).toHaveValue("");
    await page.getByRole("button", { name: "Repetir el último" }).click();
    await expect(page.getByLabel("Cargador")).toHaveValue(uno);

    // La lista: una columna en el escritorio, una línea en el celular.
    await page.goto(`/pasarelas/cobros?q=${reference}`);
    await expect(cobro(page, isMobile, reference)).toContainText("Cargador Uno");
    await expectCleanScreen(page);

    // El CSV y el PDF del filtro.
    await openDetails(page, "Exportar CSV");
    const [csvDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "CSV en español" }).click(),
    ]);
    const csv = (await readFile(await csvDownload.path(), "utf8")).replace(/^﻿/, "").trim().split("\r\n");
    expect(csv[0]?.split(";").at(-1)).toBe("Cargador");
    expect(csv.find((line) => line.includes(reference))?.split(";").at(-1)).toBe("Cargador Uno");
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PDF de los cobros del filtro" }).click(),
    ]);
    expect(await pdfTextOf(pdfDownload)).toContain("Cargador: Cargador Uno");

    // El detalle, en «Datos».
    await cobro(page, isMobile, reference).getByRole("link", { name: reference }).click();
    await expect(page.getByTestId("cargador")).toHaveText("Cargador Uno");
    await expectCleanScreen(page);

    // Editar (en «Más acciones»): quitarlo deja «Editado: cargador» en el historial.
    await page.getByRole("button", { name: "Más acciones" }).click();
    await page.getByRole("link", { name: "Editar" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Editar cobro" })).toBeVisible();
    await expect(page.getByLabel("Cargador")).toHaveValue(uno);
    await page.getByLabel("Cargador").selectOption({ label: "Sin cargador" });
    await expectCleanScreen(page);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByTestId("cargador")).toHaveText("Sin cargador");
    await expect(page.getByRole("list", { name: "Historial" })).toContainText("Editado: cargador");
  });

  test("C3: tres cobros sin cargador, «Asignar cargador…» → «Cargador Dos», y el filtro los trae con sus totales", async ({
    page,
    isMobile,
  }) => {
    const { user, db } = await enter(page);
    const dos = await newLoader(db, "Cargador Dos");
    const refs = ["c3_a", "c3_b", "c3_c"].map((ref) => `${ref}_${randomUUID().slice(0, 6)}`);
    const saved = await register(db, user, refs);
    await register(db, user, ["c3_otro"], await newLoader(db, "Cargador Uno"));

    await page.goto("/pasarelas/cobros?periodo=30d");
    for (const reference of refs) {
      await page.getByRole("checkbox", { name: `Seleccionar el cobro ${reference}` }).check();
    }
    await expect(page.getByText("3 seleccionados")).toBeVisible();
    await page.getByRole("button", { name: "Asignar cargador…" }).click();
    const dialog = page.getByRole("dialog", { name: "Asignar cargador" });
    await expect(dialog).toContainText("3 cobros");
    await dialog.getByLabel("Cargador").selectOption({ label: "Cargador Dos" });
    await expectCleanScreen(page);
    await dialog.getByRole("button", { name: "Asignar" }).click();
    await expect(page.getByText("3 cobros con «Cargador Dos».")).toBeVisible();
    for (const reference of refs) await expect(cobro(page, isMobile, reference)).toContainText("Cargador Dos");
    await expectCleanScreen(page);

    // Cada uno con su evento en el historial.
    const events = unwrap(
      await db
        .from("pay_transaction_events")
        .select("transaction_id")
        .eq("summary", "Editado: cargador")
        .in(
          "transaction_id",
          saved.map((row) => row.id),
        ),
      "historial",
    );
    expect(events).toHaveLength(3);

    // El filtro «Cargador Dos» trae esos tres, con sus totales.
    await openDetails(page, "Más filtros");
    await page.getByLabel("Cargador", { exact: true }).selectOption({ label: "Cargador Dos" });
    await expect(page).toHaveURL(new RegExp(`cargador=${dos}`));
    await expect(page.getByText("Cobros 1–3 de 3")).toBeVisible();
    await expect(page.getByText("USD: 3 cobros · neto $270,90")).toBeVisible();
    await expect(cobro(page, isMobile, "c3_otro")).toHaveCount(0);
    await expectCleanScreen(page);

    // «Sin cargador»: ya no queda ninguno.
    await page.getByLabel("Cargador", { exact: true }).selectOption({ label: "Sin cargador" });
    await expect(page).toHaveURL(/cargador=sin/);
    await expect(page.getByText("No hay cobros con estos filtros")).toBeVisible();
  });

  test("C4: el reporte del período por cargador, con «Sin cargador», cuadra con el Resumen", async ({
    page,
    isMobile,
  }) => {
    const { user, db } = await enter(page);
    const [uno, dos] = [await newLoader(db, "Cargador Uno"), await newLoader(db, "Cargador Dos")];
    await register(db, user, ["c4_u1"], uno);
    await register(db, user, ["c4_d1", "c4_d2", "c4_d3"], dos);
    await register(db, user, ["c4_s1", "c4_s2"]);

    await page.goto("/pasarelas/cargadores?periodo=30d");
    await expect(page.getByLabel("Período")).toHaveValue("30d");
    const regionUno = page.getByRole("region", { name: "Cargador Uno" });
    const regionDos = page.getByRole("region", { name: "Cargador Dos" });
    const regionSin = page.getByRole("region", { name: "Sin cargador" });
    await expect(regionUno.getByRole("group", { name: "Cobros" })).toHaveText(/^Cobros\s*1$/);
    await expect(regionUno.getByRole("group", { name: "Bruto" })).toContainText("$100,00");
    await expect(regionDos.getByRole("group", { name: "Cobros" })).toHaveText(/^Cobros\s*3$/);
    await expect(regionDos.getByRole("group", { name: "Bruto" })).toContainText("$300,00");
    await expect(regionDos.getByRole("group", { name: "Comisiones" })).toContainText("$29,10");
    await expect(regionDos.getByRole("group", { name: "Neto" })).toContainText("$270,90");
    await expect(regionDos.getByRole("group", { name: "Por caer" })).toContainText("$270,90");
    await expect(regionSin.getByRole("group", { name: "Cobros" })).toHaveText(/^Cobros\s*2$/);
    await expect(regionSin.getByRole("group", { name: "Bruto" })).toContainText("$200,00");
    await expectCleanScreen(page);

    // Lo mismo que el Resumen del mismo período: 1 + 3 + 2 cobros, 100 + 300 + 200.
    await page.goto("/pasarelas?periodo=30d");
    const cifras = page.getByRole("region", { name: "Cifras del período" });
    await expect(cifras.getByRole("group", { name: "Cobros" })).toHaveText(/^Cobros\s*6$/);
    await expect(cifras.getByRole("group", { name: "Bruto" })).toContainText("$600,00");

    // El enlace lleva a la lista de ese cargador y ese período, desde donde se exporta.
    await page.goto("/pasarelas/cargadores?periodo=30d");
    await regionDos.getByRole("link", { name: "Ver los cobros de Cargador Dos" }).click();
    await expect(page).toHaveURL(new RegExp(`/pasarelas/cobros\\?periodo=30d&cargador=${dos}`));
    await expect(page.getByText("Cobros 1–3 de 3")).toBeVisible();
    for (const reference of ["c4_d1", "c4_d2", "c4_d3"]) await expect(cobro(page, isMobile, reference)).toBeVisible();
    await page.goto("/pasarelas/cargadores?periodo=30d");
    await regionSin.getByRole("link", { name: "Ver los cobros sin cargador" }).click();
    await expect(page).toHaveURL(/cargador=sin/);
    await expect(page.getByText("Cobros 1–2 de 2")).toBeVisible();
  });

  test("C5: borrar «Cargador Dos» con cobros se niega y ofrece desactivarlo; desactivado no sale en Registrar", async ({
    page,
    isMobile,
  }) => {
    const { user, db } = await enter(page);
    const dos = await newLoader(db, "Cargador Dos");
    await newLoader(db, "Cargador Tres");
    await register(db, user, ["c5_d1"], dos);

    await page.goto("/pasarelas/cargadores?periodo=30d");
    const regionDos = page.getByRole("region", { name: "Cargador Dos" });
    await regionDos.getByRole("button", { name: "Borrar" }).click();
    const confirm = page.getByRole("alertdialog", { name: "¿Borrar «Cargador Dos»?" });
    await expect(confirm).toContainText("Tiene 1 cobro: no se puede borrar.");
    await expect(confirm.getByRole("button", { name: "Borrar" })).toHaveCount(0);
    await expectCleanScreen(page);
    await confirm.getByRole("button", { name: "Desactivar" }).click();
    await expect(confirm).toBeHidden();
    await expect(regionDos.getByText("Desactivado")).toBeVisible();
    await expect(regionDos.getByRole("button", { name: "Activar" })).toBeVisible();
    // Sus ventas siguen en el reporte.
    await expect(regionDos.getByRole("group", { name: "Cobros" })).toHaveText(/^Cobros\s*1$/);
    await expectCleanScreen(page);

    // Uno sin cobros sí se borra.
    const regionTres = page.getByRole("region", { name: "Cargador Tres" });
    await regionTres.getByRole("button", { name: "Borrar" }).click();
    const borrar = page.getByRole("alertdialog", { name: "¿Borrar «Cargador Tres»?" });
    await borrar.getByRole("button", { name: "Borrar" }).click();
    await expect(page.getByText("Cargador borrado.")).toBeVisible();
    await expect(regionTres).toHaveCount(0);

    // Desactivado no se ofrece al registrar.
    await page.goto("/pasarelas/registrar");
    await expect(page.getByLabel("Cargador").locator("option", { hasText: "Cargador Dos" })).toHaveCount(0);

    // Sus cobros lo siguen mostrando, en la lista y en el detalle.
    await page.goto("/pasarelas/cobros?periodo=30d");
    await expect(cobro(page, isMobile, "c5_d1")).toContainText("Cargador Dos");
    await cobro(page, isMobile, "c5_d1").getByRole("link", { name: "c5_d1" }).click();
    await expect(page.getByTestId("cargador")).toHaveText("Cargador Dos");
  });
});
