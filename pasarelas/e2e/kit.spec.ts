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

  test("casillas e interruptores: el error queda enlazado al control, junto a su ayuda", async ({ page }) => {
    await openKit(page);
    const fields = page.getByRole("region", { name: "Campos" });

    const checkbox = fields.getByRole("checkbox", { name: "Entiendo que borrar del todo no se puede deshacer" });
    await expect(checkbox).toHaveAttribute("aria-invalid", "true");
    await expect(checkbox).toHaveAccessibleDescription("Se borran también sus comprobantes. Marca la casilla para continuar.");
    await expect(fields.getByText("Marca la casilla para continuar.")).toBeVisible();
    // Sigue funcionando como casilla: se marca tocando su etiqueta.
    await fields.getByText("Entiendo que borrar del todo no se puede deshacer").click();
    await expect(checkbox).toBeChecked();

    const toggle = fields.getByRole("switch", { name: "Aplicar a los cobros ya registrados" });
    await expect(toggle).toHaveAttribute("aria-invalid", "true");
    await expect(toggle).toHaveAccessibleDescription("Hay cobros depositados en ese período: no se pueden recalcular.");

    // Los que no tienen error no quedan marcados.
    await expect(fields.getByRole("switch", { name: "Pago rápido" })).not.toHaveAttribute("aria-invalid");
    await expect(fields.getByRole("switch", { name: "Pago rápido" })).toHaveAccessibleDescription(
      "1,5 % sobre el bruto; el dinero cae el mismo día.",
    );
    await expect(
      fields.getByRole("checkbox", { name: "La pasarela devuelve la comisión al reembolsar" }),
    ).not.toHaveAttribute("aria-invalid");
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
  });

  test("fechas: las escribe el motor, en español y en hora de Nueva York", async ({ page }) => {
    await openKit(page);
    const figures = page.getByRole("region", { name: "Cifras" });
    // La galería solo pasa la fecha ("2026-11-13") o el instante en UTC: el texto sale de formatDate y formatDateTime.
    const date = figures.getByText("vie 13 nov 2026", { exact: true });
    await expect(date).toHaveAttribute("datetime", "2026-11-13");
    expect(await date.evaluate((el) => el.tagName)).toBe("TIME");
    await expect(figures.getByText("vie 13 nov 2026, 10:30", { exact: true })).toHaveAttribute(
      "datetime",
      "2026-11-13T15:30:00Z",
    );
    // 03:30 UTC del sábado 14 todavía es viernes 13 en Nueva York: el día no se corre.
    await expect(figures.getByText("vie 13 nov 2026, 22:30", { exact: true })).toHaveAttribute(
      "datetime",
      "2026-11-14T03:30:00Z",
    );
    // Ninguna fecha de la galería queda en ISO crudo a la vista.
    const raw = await page
      .locator("time")
      .evaluateAll((els) => els.map((el) => el.textContent ?? "").filter((text) => /\d{4}-\d{2}-\d{2}/.test(text)));
    expect(raw).toEqual([]);
    await expect(page.getByRole("region", { name: "Tarjetas" }).getByText("mar 17 nov 2026", { exact: true })).toHaveAttribute(
      "datetime",
      "2026-11-17",
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

test.describe("pulido del kit", () => {
  /** Un punto del fondo oscuro: el diálogo centrado deja 16 px libres a cada lado. */
  const BACKDROP = { x: 8, y: 8 };

  const CLOSE_WAYS: [string, (page: Page) => Promise<void>][] = [
    ["«Cancelar»", (page) => page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click()],
    ["Escape", (page) => page.keyboard.press("Escape")],
    ["su botón de cerrar", (page) => page.getByRole("alertdialog").getByRole("button", { name: "Cerrar" }).click()],
    ["un clic en el fondo", (page) => page.mouse.click(BACKDROP.x, BACKDROP.y)],
  ];

  for (const [way, close] of CLOSE_WAYS) {
    test(`confirmación: cerrarla con ${way} llama a onClose una sola vez y nunca a onConfirm`, async ({ page }) => {
      await openKit(page);
      const opener = page.getByRole("button", { name: "Enviar a la papelera" });
      const confirm = page.getByRole("alertdialog", { name: "¿Enviar este cobro a la papelera?" });
      const calls = page.getByTestId("llamadas-confirmacion");
      await expect(calls).toHaveText("Llamadas: onClose 0 · onConfirm 0");

      await opener.click();
      await expect(confirm).toBeVisible();
      await close(page);
      await expect(confirm).toBeHidden();
      await expect(calls).toHaveText("Llamadas: onClose 1 · onConfirm 0");

      // Otra vuelta: si la primera hubiera dejado una llamada de más en camino, aquí ya se vería.
      await opener.click();
      await expect(confirm).toBeVisible();
      await close(page);
      await expect(confirm).toBeHidden();
      await expect(calls).toHaveText("Llamadas: onClose 2 · onConfirm 0");
    });
  }

  test("confirmación: confirmar llama a onConfirm una sola vez y no dispara onClose", async ({ page }) => {
    await openKit(page);
    const opener = page.getByRole("button", { name: "Enviar a la papelera" });
    const confirm = page.getByRole("alertdialog", { name: "¿Enviar este cobro a la papelera?" });
    const calls = page.getByTestId("llamadas-confirmacion");

    await opener.click();
    await confirm.getByRole("button", { name: "Enviar a la papelera" }).click();
    await expect(confirm).toBeHidden();
    await expect(calls).toHaveText("Llamadas: onClose 0 · onConfirm 1");

    // El cierre que hace el código después de confirmar no cuenta como un cierre de la persona, ni tarde.
    await opener.click();
    await confirm.getByRole("button", { name: "Enviar a la papelera" }).click();
    await expect(confirm).toBeHidden();
    await expect(calls).toHaveText("Llamadas: onClose 0 · onConfirm 2");
  });

  test("diálogo: el clic en el fondo solo lo cierra si empezó y terminó en el fondo", async ({ page }) => {
    await openKit(page);
    const calls = page.getByTestId("llamadas-dialogo");
    await page.getByRole("button", { name: "Abrir diálogo" }).click();
    const dialog = page.getByRole("dialog", { name: "Marcar como depositado" });
    const comment = dialog.getByRole("textbox", { name: "Comentario" });
    await comment.fill("Cayó completo el lunes");
    const field = await comment.boundingBox();
    if (!field) throw new Error("El campo «Comentario» no está en pantalla");
    const inField = { x: field.x + field.width - 12, y: field.y + field.height / 2 };

    // Seleccionar el texto arrastrando y soltar ya fuera del diálogo.
    await page.mouse.move(inField.x, inField.y);
    await page.mouse.down();
    await page.mouse.move(BACKDROP.x, BACKDROP.y, { steps: 8 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await expect(comment).toHaveValue("Cayó completo el lunes");

    // Al revés tampoco: empezar en el fondo y soltar dentro.
    await page.mouse.move(BACKDROP.x, BACKDROP.y);
    await page.mouse.down();
    await page.mouse.move(inField.x, inField.y, { steps: 8 });
    await page.mouse.up();
    await expect(dialog).toBeVisible();
    await expect(calls).toHaveText("Llamadas: onClose 0");

    // Un clic limpio en el fondo sí lo cierra, y avisa una sola vez.
    await page.mouse.click(BACKDROP.x, BACKDROP.y);
    await expect(dialog).toBeHidden();
    await expect(calls).toHaveText("Llamadas: onClose 1");
  });

  test("diálogo: usar su barra de desplazamiento no lo cierra", async ({ page }) => {
    test.skip(isPhone(page), "En el celular la barra va superpuesta y no se puede tocar");
    // Tan bajo que el diálogo no cabe y tiene que desplazarse por dentro.
    await page.setViewportSize({ width: 1280, height: 300 });
    await openKit(page);
    await page.getByRole("button", { name: "Abrir diálogo" }).click();
    const dialog = page.getByRole("dialog", { name: "Marcar como depositado" });
    await expect(dialog).toBeVisible();
    const bar = await dialog.evaluate((el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      const width = el.offsetWidth - el.clientWidth - 2; // sin los dos bordes de 1 px
      return { width, overflows: el.scrollHeight > el.clientHeight, x: box.right - 1 - width / 2, top: box.top, height: box.height };
    });
    expect(bar.overflows).toBe(true);
    expect(bar.width).toBeGreaterThan(4);

    // Un clic en el riel de la barra, cerca del final: desplaza el contenido y el diálogo sigue ahí.
    await page.mouse.click(bar.x, bar.top + bar.height - 30);
    await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("llamadas-dialogo")).toHaveText("Llamadas: onClose 0");
  });

  const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** Una utilidad `shadow-*` compone varias sombras: la del token es la última de la lista. */
  const endsWith = (shadow: string) => new RegExp(`${escapeRegExp(shadow)}$`);

  const SHADOWS = [
    {
      scheme: "light",
      mode: "claro",
      raised: "rgba(20, 33, 58, 0.08) 0px 1px 2px 0px, rgba(20, 33, 58, 0.1) 0px 4px 12px 0px",
      overlay: "rgba(8, 14, 20, 0.28) 0px 12px 40px 0px",
    },
    {
      scheme: "dark",
      mode: "oscuro",
      raised: "rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.35) 0px 4px 12px 0px",
      overlay: "rgba(0, 0, 0, 0.6) 0px 12px 40px 0px",
    },
  ] as const;

  for (const { scheme, mode, raised, overlay } of SHADOWS) {
    test.describe(`sombras en modo ${mode}`, () => {
      test.use({ colorScheme: scheme });

      test("lo que flota sobre la página lleva la sombra de su modo", async ({ page }) => {
        await openKit(page);

        // shadow-raised como clase: el enlace para saltar al contenido, que aparece al recibir el foco.
        await page.keyboard.press("Tab");
        const skip = page.getByRole("link", { name: "Saltar al contenido" });
        await expect(skip).toBeFocused();
        await expect(skip).toHaveCSS("box-shadow", endsWith(raised));

        // La misma sombra, leída como variable: los avisos pasajeros.
        await page.getByRole("button", { name: "Aviso de éxito" }).click();
        await expect(page.locator("[data-sonner-toast]")).toHaveCSS("box-shadow", raised);

        // shadow-overlay: el diálogo.
        await page.getByRole("button", { name: "Abrir diálogo" }).click();
        const dialog = page.getByRole("dialog", { name: "Marcar como depositado" });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS("box-shadow", endsWith(overlay));
      });
    });
  }

  test("campo: si el control trae su propio id, la etiqueta apunta a él", async ({ page }) => {
    await openKit(page);
    const date = page.getByRole("region", { name: "Campos" }).getByLabel("Fecha del cobro");
    await expect(date).toHaveAttribute("id", "kit-fecha-del-cobro");
    await expect(date).toHaveValue("2026-11-13");
  });

  test("avisos fijos: solo interrumpe al lector de pantalla el que lo pide con announce", async ({ page }) => {
    await openKit(page);
    const region = page.getByRole("region", { name: "Etiquetas y avisos" });
    const announced = region.getByRole("alert");
    await expect(announced).toHaveCount(1);
    await expect(announced).toContainText("No se pudo registrar la liquidación");
    // Los de aviso y de error que ya estaban en la página no interrumpen.
    for (const title of ["2 depósitos atrasados", "El esquema no suma 100 %"]) {
      await expect(region.getByRole("status").filter({ hasText: title })).toHaveCount(1);
    }
  });

  test("barra inferior: las secciones principales rodean al «＋», todas del mismo ancho", async ({ page }) => {
    test.skip(!isPhone(page), "En escritorio no hay barra inferior");
    await openKit(page);
    const items = page.getByRole("navigation", { name: "Principal" }).getByRole("listitem");
    const names = await items.evaluateAll((els) =>
      els.map((el) => {
        const control = el.querySelector("a, button");
        return control?.getAttribute("aria-label") ?? control?.textContent?.trim() ?? "";
      }),
    );
    expect(names).toEqual(["Resumen", "Cobros", "Registrar cobro", "Repartos", "Más"]);
    const widths = await items.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(widths).toEqual([78, 78, 78, 78, 78]);
  });
});
