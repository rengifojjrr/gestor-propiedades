import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { addDays, formatDate, todayNY } from "../src/lib/pasarelas";
import { e1Item, saveTransactions, signInAal1, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * El PDF de Cobros, en el celular (390×844) y en el escritorio (1280×800): el de los elegidos (en la barra de
 * seleccionados), el del filtro de la lista y el de hoy (junto a «Exportar CSV»), el botón que dice que está
 * trabajando y el mensaje del tope. Cada prueba usa su usuario: «PDF de hoy» trae todos los cobros de hoy.
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

/** Cobros E1 (100,00 → neto 90,30) con esas referencias, `daysAgo` días antes de hoy (en Nueva York). */
async function register(db: Db, user: TestUser, refs: readonly string[], daysAgo: number): Promise<void> {
  const on = addDays(today, -daysAgo);
  await saveTransactions(
    db,
    refs.map((reference) =>
      e1Item(user.basics, {
        reference,
        occurred_at: `${on}T15:00:00+00:00`,
        occurred_on: on,
        estimated_deposit_on: on,
      }),
    ),
  );
}

/** El texto del PDF descargado. */
async function pdfTextOf(download: Download): Promise<string> {
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return text;
}

/** Pulsa el botón y devuelve la descarga que provoca. */
async function downloadWith(page: Page, name: string): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
  return download;
}

async function expectCleanScreen(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

const FILTER_PDF = "PDF de los cobros del filtro";
const SELECTED_PDF = "PDF de los cobros elegidos";

test.describe("PDF de cobros", () => {
  /**
   * Los errores sin atrapar de la página y lo que React avisa por consola: cada prueba termina sin ninguno. El 422 de
   * la ruta del PDF es su respuesta al tope (el navegador lo anota en la consola): ese no cuenta.
   */
  let pageErrors: string[] = [];
  const TOPE_RESPONSE = /status of 422 .*\/pasarelas\/cobros\/pdf\?/;

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      const text = `${message.text()} (${message.location().url})`;
      if (message.type() === "error" && !TOPE_RESPONSE.test(text)) pageErrors.push(text);
    });
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("elegir dos cobros, «PDF», y la descarga es un PDF con sus referencias", async ({ page }) => {
    const { user, db } = await enter(page);
    await register(db, user, ["pdf_sel_1", "pdf_sel_2", "pdf_sel_3"], 1);
    await page.goto("/pasarelas/cobros?periodo=30d&q=pdf_sel");
    await expect(page.getByRole("heading", { level: 1, name: "Cobros" })).toBeVisible();
    // Sin nada elegido, la barra (y su botón) no está.
    await expect(page.getByRole("button", { name: SELECTED_PDF })).toHaveCount(0);

    for (const reference of ["pdf_sel_1", "pdf_sel_2"]) {
      await page.getByRole("checkbox", { name: `Seleccionar el cobro ${reference}` }).check();
    }
    await expect(page.getByText("2 seleccionados")).toBeVisible();
    await expect(page.getByRole("button", { name: SELECTED_PDF })).toBeVisible();
    await expectCleanScreen(page);

    const download = await downloadWith(page, SELECTED_PDF);
    expect(download.suggestedFilename()).toBe(`cobros-elegidos-${today}.pdf`);
    const text = await pdfTextOf(download);
    expect(text).toContain("Seleccionados (2)");
    expect(text).toContain("Ref. pdf_sel_1");
    expect(text).toContain("Ref. pdf_sel_2");
    expect(text).not.toContain("pdf_sel_3");
    expect(text).toContain("Neto $90,30");
    // Terminado, el botón vuelve a estar listo y la selección sigue.
    await expect(page.getByRole("button", { name: SELECTED_PDF })).toBeEnabled();
    await expect(page.getByText("2 seleccionados")).toBeVisible();
  });

  test("el PDF del filtro de la lista y el PDF de hoy", async ({ page }) => {
    const { user, db } = await enter(page);
    await register(db, user, ["pdf_hoy_1", "pdf_hoy_2"], 0);
    await register(db, user, ["pdf_ayer_1"], 1);
    await page.goto("/pasarelas/cobros?periodo=30d&q=pdf_");
    await expect(page.getByText("Cobros 1–3 de 3")).toBeVisible();
    await expectCleanScreen(page);

    const filtered = await downloadWith(page, FILTER_PDF);
    expect(filtered.suggestedFilename()).toBe(`cobros-${today}.pdf`);
    const filterText = await pdfTextOf(filtered);
    expect(filterText).toContain("Búsqueda: «pdf_»");
    for (const reference of ["pdf_hoy_1", "pdf_hoy_2", "pdf_ayer_1"]) expect(filterText).toContain(reference);

    const ofToday = await downloadWith(page, "PDF de hoy");
    expect(ofToday.suggestedFilename()).toBe(`cobros-${today}.pdf`);
    const todayText = await pdfTextOf(ofToday);
    expect(todayText).toContain(`Hoy, ${formatDate(today)}`);
    expect(todayText).toContain("pdf_hoy_1");
    expect(todayText).toContain("pdf_hoy_2");
    expect(todayText).not.toContain("pdf_ayer_1");
  });

  test("mientras se arma, el botón dice que está trabajando y no se puede pulsar dos veces", async ({ page }) => {
    const { user, db } = await enter(page);
    await register(db, user, ["pdf_lento_1"], 1);
    let requests = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/pasarelas/cobros/pdf?**", async (route) => {
      requests += 1;
      await held;
      await route.continue();
    });
    await page.goto("/pasarelas/cobros?periodo=30d&q=pdf_lento");
    await expect(page.getByText("Cobros 1–1 de 1")).toBeVisible();

    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: FILTER_PDF }).click();
    const working = page.getByRole("button", { name: "Armando el PDF…" });
    await expect(working).toBeVisible();
    await expect(working).toBeDisabled();
    await working.dispatchEvent("click");
    await expectCleanScreen(page);
    release();

    const download = await downloaded;
    expect(await pdfTextOf(download)).toContain("pdf_lento_1");
    await expect(page.getByRole("button", { name: FILTER_PDF })).toBeEnabled();
    expect(requests).toBe(1);
  });

  test("con 301 cobros en el filtro sale el mensaje del tope y no se descarga nada", async ({ page }) => {
    const { user, db } = await enter(page);
    const refs = Array.from({ length: 301 }, (_, i) => `pdf_tope_${String(i + 1).padStart(3, "0")}`);
    await register(db, user, refs, 1);
    let downloads = 0;
    page.on("download", () => {
      downloads += 1;
    });
    await page.goto("/pasarelas/cobros?periodo=30d&q=pdf_tope");
    await expect(page.getByText("Cobros 1–50 de 301")).toBeVisible();

    await page.getByRole("button", { name: FILTER_PDF }).click();
    const alert = page.getByRole("alert").filter({ hasText: "Son 301 cobros" });
    await expect(alert).toHaveText("Son 301 cobros; el PDF admite hasta 300. Acota el filtro.");
    await expect(page.getByRole("button", { name: FILTER_PDF })).toBeEnabled();
    await expectCleanScreen(page);
    expect(downloads).toBe(0);
  });
});

test("sin sesión, la ruta del PDF no entrega nada", async ({ request }) => {
  for (const path of ["/pasarelas/cobros/pdf", "/pasarelas/cobros/pdf?periodo=hoy"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location ?? "", "http://x").pathname).toBe("/login");
  }
});
