import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, expectNoSeriousAxe } from "./axe";

/**
 * El kit de interfaz y el marco, sobre la galería `/kit` (solo existe en desarrollo, o en un build con
 * PASARELAS_KIT=1). Corre en los dos tamaños del proyecto: celular 390×844 y escritorio 1280×800.
 */
const MAIN_LINKS = ["Resumen", "Cobros", "Repartos"];
const MORE_LINKS = ["Empresas", "Pasarelas", "Cuentas destino", "Importar", "Feriados", "Papelera", "Ajustes"];

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

async function openKit(page: Page, query = "") {
  await page.goto(`/kit${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Kit de interfaz" })).toBeVisible();
}

for (const scheme of ["light", "dark"] as const) {
  const mode = scheme === "light" ? "claro" : "oscuro";

  test.describe(`galería en modo ${mode}`, () => {
    test.use({ colorScheme: scheme });

    test("sin violaciones serias ni críticas de axe y sin desbordamiento horizontal", async ({ page }) => {
      await openKit(page);
      const paper = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(paper).toBe(scheme === "light" ? "rgb(238, 242, 239)" : "rgb(14, 23, 24)");
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousAxe(page);
    });

    test("un diálogo abierto tampoco tiene violaciones", async ({ page }) => {
      await openKit(page);
      await page.getByRole("button", { name: "Abrir diálogo" }).click();
      await expect(page.getByRole("dialog", { name: "Marcar como depositado" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoSeriousAxe(page);
    });
  });
}

test.describe("marco", () => {
  test("barra inferior en celular y barra lateral desde 768 px", async ({ page }) => {
    await page.goto("/pasarelas");
    await expect(page.getByRole("heading", { level: 1, name: "Resumen" })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Principal" });
    await expect(nav).toHaveCount(1);

    for (const name of MAIN_LINKS) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Registrar cobro" })).toHaveAttribute("href", "/pasarelas/registrar");
    await expect(nav.getByRole("link", { name: "Resumen", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Cobros", exact: true })).not.toHaveAttribute("aria-current", "page");

    if (isPhone(page)) {
      await expect(nav.getByRole("link")).toHaveCount(4);
      await expect(nav.getByRole("button", { name: "Más" })).toBeVisible();
      const box = await nav.boundingBox();
      expect(box && Math.round(box.y + box.height)).toBe(844); // pegada al borde inferior
    } else {
      await expect(nav.getByRole("button", { name: "Más" })).toHaveCount(0);
      for (const name of MORE_LINKS) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
      const box = await nav.boundingBox();
      expect(box?.x).toBe(0); // a la izquierda
    }
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxe(page);
  });

  test("«Más» abre el resto de secciones y lleva a la elegida", async ({ page }) => {
    test.skip(!isPhone(page), "En escritorio la barra lateral ya muestra todas las secciones");
    await page.goto("/pasarelas");
    await page.getByRole("button", { name: "Más" }).click();
    const sheet = page.getByRole("dialog", { name: "Más" });
    await expect(sheet).toBeVisible();
    for (const name of MORE_LINKS) await expect(sheet.getByRole("link", { name, exact: true })).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("button", { name: "Más" })).toBeFocused();

    await page.getByRole("button", { name: "Más" }).click();
    await sheet.getByRole("link", { name: "Feriados", exact: true }).click();
    await expect(page).toHaveURL(/\/pasarelas\/feriados$/);
  });

  test("la raíz lleva al Resumen y una ruta que no existe dice cómo volver", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/pasarelas$/);

    const response = await page.goto("/no-existe");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Esta página no existe" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir al Resumen" })).toHaveAttribute("href", "/pasarelas");
    await expectNoSeriousAxe(page);
  });

  test("el manifiesto permite instalar la app y sus íconos existen", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.ok()).toBe(true);
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "Pasarelas",
      lang: "es",
      display: "standalone",
      start_url: "/pasarelas",
      background_color: "#eef2ef",
      theme_color: "#0e6249",
    });
    expect(manifest.icons.map((icon: { src: string; sizes: string; purpose?: string }) => [icon.src, icon.sizes, icon.purpose])).toEqual([
      ["/icons/icon-192.png", "192x192", "any"],
      ["/icons/icon-512.png", "512x512", "any"],
      ["/icons/icon-maskable-512.png", "512x512", "maskable"],
    ]);
    for (const src of [...manifest.icons.map((icon: { src: string }) => icon.src), "/icons/apple-touch-icon.png"]) {
      const icon = await request.get(src);
      expect(icon.status(), src).toBe(200);
      expect(icon.headers()["content-type"], src).toBe("image/png");
    }
  });
});

test.describe("componentes", () => {
  test("diálogo: título enlazado, foco atrapado, Escape cierra y el foco vuelve al botón", async ({ page }) => {
    await openKit(page);
    const opener = page.getByRole("button", { name: "Abrir diálogo" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Marcar como depositado" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => el instanceof HTMLDialogElement && el.matches(":modal"))).toBe(true);

    // El foco entra al diálogo y no sale de él por más que se tabule.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await dialog.evaluate((el) => el.contains(document.activeElement));
      const onPage = await page.evaluate(() => document.activeElement !== document.body);
      if (onPage) expect(inside).toBe(true);
    }
    // Lo de atrás no se puede tocar.
    await expect(opener).not.toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();

    // También se cierra con su botón.
    await opener.click();
    await dialog.getByRole("button", { name: "Cerrar" }).click();
    await expect(dialog).toBeHidden();
  });

  test("confirmación: cancelar no hace nada; confirmar ejecuta y avisa", async ({ page }) => {
    await openKit(page);
    const opener = page.getByRole("button", { name: "Enviar a la papelera" });
    await opener.click();
    const confirm = page.getByRole("alertdialog", { name: "¿Enviar este cobro a la papelera?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText("Cobro enviado a la papelera")).toHaveCount(0);

    await opener.click();
    await confirm.getByRole("button", { name: "Enviar a la papelera" }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText("Cobro enviado a la papelera")).toBeVisible();
  });

  test("avisos: éxito y error se anuncian en pantalla", async ({ page }) => {
    await openKit(page);
    await page.getByRole("button", { name: "Aviso de éxito" }).click();
    await expect(page.getByText("Cobro guardado")).toBeVisible();
    await page.getByRole("button", { name: "Aviso de error" }).click();
    await expect(page.getByText("No se pudo guardar el cobro")).toBeVisible();
    await expectNoSeriousAxe(page);
  });

  test("botón de enviar: mientras la acción corre queda desactivado y lo dice", async ({ page }) => {
    await openKit(page);
    await page.getByRole("button", { name: "Guardar cobro" }).click();
    const pending = page.getByRole("button", { name: "Guardando…" });
    await expect(pending).toBeDisabled();
    await expect(pending).toHaveAttribute("aria-busy", "true");
    // Al terminar la acción vuelve a estar disponible.
    await expect(page.getByRole("button", { name: "Guardar cobro" })).toBeEnabled();
  });

  test("campos: etiqueta, ayuda y error quedan enlazados al control", async ({ page }) => {
    await openKit(page);
    const withError = page.getByRole("textbox", { name: "Referencia" });
    await expect(withError).toHaveAttribute("aria-invalid", "true");
    await expect(withError).toHaveAccessibleDescription(/Ya existe un cobro con esta referencia/);

    const withHint = page.getByRole("textbox", { name: "Nota" });
    await expect(withHint).not.toHaveAttribute("aria-invalid", "true");
    await expect(withHint).toHaveAccessibleDescription("Hasta 280 caracteres.");

    await expect(page.getByRole("textbox", { name: "Monto" })).toHaveAttribute("inputmode", "decimal");
    await expect(page.getByRole("textbox", { name: "Comisión" })).toHaveAttribute("inputmode", "decimal");
    await expect(page.getByRole("switch", { name: "Pago rápido" })).toBeChecked();
    await page.getByRole("switch", { name: "Pago rápido" }).click();
    await expect(page.getByRole("switch", { name: "Pago rápido" })).not.toBeChecked();
    await page.getByRole("checkbox", { name: "La pasarela devuelve la comisión al reembolsar" }).check();
  });

  test("cifras: tabulares, y los negativos con signo y tono propio", async ({ page }) => {
    await openKit(page);
    const figures = page.getByRole("region", { name: "Cifras" });
    // La galería solo pasa el valor canónico ("-3.20", "USD"): el texto lo escribe formatMoney.
    const negative = figures.getByText("-$3,20", { exact: true });
    await expect(negative).toHaveAttribute("data-tone", "negative");
    await expect(figures.getByText("$90,30", { exact: true })).toHaveAttribute("data-tone", "positive");
    await expect(figures.getByText("$0,00", { exact: true })).toHaveAttribute("data-tone", "zero");
    await expect(figures.getByText("5,00 MXN", { exact: true })).toHaveAttribute("data-currency", "MXN");
    await expect(figures.getByText("-$121,25", { exact: true })).toHaveAttribute("data-tone", "negative");
    await expect(figures.getByText("2,9 %", { exact: true })).toHaveAttribute("data-value", "2.9");
    await expect(figures.getByText("9,7 % del bruto")).toBeVisible();

    const styles = await negative.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { numeric: computed.fontVariantNumeric, color: computed.color };
    });
    expect(styles.numeric).toContain("tabular-nums");
    const positiveColor = await figures
      .getByText("$90,30", { exact: true })
      .evaluate((el) => getComputedStyle(el).color);
    expect(styles.color).not.toBe(positiveColor);

    // Tabulares de verdad: dos cifras con los mismos dígitos en otro orden miden lo mismo.
    const widths = await figures
      .getByTestId("ancho-tabular")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBe(widths[1]);

    await expect(figures.locator("time", { hasText: "vie 13 nov 2026" }).first()).toHaveAttribute(
      "datetime",
      "2026-11-13",
    );
  });

  test("objetivos táctiles de al menos 44 px", async ({ page }) => {
    await openKit(page);
    const small = await page.evaluate(() => {
      const selector =
        "button, select, textarea, a[href], summary, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), label:has(input[type=checkbox])";
      return [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((el) => el.getClientRects().length > 0 && !el.closest("[data-sonner-toaster], .sr-only"))
        .map((el) => ({ el, box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.height < 43.5 || box.width < 43.5)
        .map(
          ({ el, box }) =>
            `${el.tagName.toLowerCase()} «${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}» ${Math.round(box.width)}×${Math.round(box.height)}`,
        );
    });
    expect(small, `Controles de menos de 44 px:\n${small.join("\n")}`).toEqual([]);
  });

  test("filtros en la URL: elegir, buscar, período y paginación", async ({ page }) => {
    await openKit(page, "?pagina=2");
    const filters = page.getByRole("region", { name: "Filtros en la URL" });
    await expect(filters.getByText("Página 2 de 3")).toBeVisible();

    await filters.getByRole("link", { name: "Siguiente" }).click();
    await expect(page).toHaveURL(/[?&]pagina=3(&|$)/);
    await expect(filters.getByText("Página 3 de 3")).toBeVisible();
    await expect(filters.getByRole("link", { name: "Siguiente" })).toHaveCount(0);

    // Cambiar un filtro vuelve a la primera página.
    await filters.getByRole("combobox", { name: "Empresa" }).selectOption({ label: "Tienda Demo" });
    await expect(page).toHaveURL(/[?&]empresa=tienda(&|$)/);
    await expect(page).not.toHaveURL(/pagina=/);
    await expect(filters.getByText("Página 1 de 3")).toBeVisible();
    await expect(filters.getByRole("combobox", { name: "Empresa" })).toHaveValue("tienda");

    // Período: los fijos y «Elegir fechas».
    const period = filters.getByRole("combobox", { name: "Período" });
    await expect(period).toHaveValue("este_mes");
    await expect(filters.getByLabel("Desde")).toHaveCount(0);
    await period.selectOption({ label: "Elegir fechas" });
    await expect(page).toHaveURL(/[?&]periodo=personalizado(&|$)/);
    await filters.getByLabel("Desde").fill("2026-11-01");
    await expect(page).toHaveURL(/[?&]desde=2026-11-01(&|$)/);
    await filters.getByLabel("Hasta").fill("2026-11-09");
    await expect(page).toHaveURL(/[?&]hasta=2026-11-09(&|$)/);
    await period.selectOption({ label: "Últimos 30 días" });
    await expect(page).toHaveURL(/[?&]periodo=30d(&|$)/);
    await expect(page).not.toHaveURL(/desde=|hasta=/);
    await expect(page).toHaveURL(/[?&]empresa=tienda(&|$)/);

    // Búsqueda: se aplica al enviar y se puede borrar.
    const search = filters.getByRole("searchbox", { name: "Buscar" });
    await search.fill("demo 42");
    await search.press("Enter");
    await expect(page).toHaveURL(/[?&]q=demo\+42(&|$)/);
    await filters.getByRole("button", { name: "Borrar la búsqueda" }).click();
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(filters.getByRole("searchbox", { name: "Buscar" })).toHaveValue("");
  });
});
