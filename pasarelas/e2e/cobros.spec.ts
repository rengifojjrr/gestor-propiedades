import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDays, compute, todayNY, type Currency, type Rules } from "../src/lib/pasarelas";
import type { Json } from "../src/lib/supabase/types";
import { e1Item, saveTransactions, signInAal1, unwrap, type Basics, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Cobros: la lista con sus filtros, sus totales, la selección múltiple con sus acciones y el CSV. En el celular
 * (tarjetas) y en el escritorio (tabla). Los cobros se crean por la capa de datos (`pay_save_transactions`) con un
 * desglose calculado por el motor: «Registrar cobro» es otra pantalla.
 */

let user: TestUser;
let client: Db;
let today: string;

test.beforeAll(async () => {
  user = await newUser();
  client = await signInAal1(user.email, user.password);
  today = todayNY(new Date());
});

/** Las reglas que congela un cobro con la configuración de `seedBasics`: Stripe, «Pago rápido», canal al 5 %, 50/30/20. */
function basicsRules(b: Basics): Rules {
  return {
    gateway: {
      id: b.gatewayId,
      name: "Stripe",
      feeVersionId: b.feeVersionId,
      pct: "2.9",
      fixed: "0.30",
      refundsReturnFee: false,
      disputeFee: "0.00",
    },
    extras: [{ id: b.extraId, name: "Pago rápido", pct: "1.5", fixed: "0.00", base: "bruto", payoutDaysOverride: 0 }],
    platform: { channelId: b.channelId, name: "Inscripciones en línea", pct: "5", fixed: "0.00" },
    scheme: {
      schemeId: b.schemeId,
      versionId: b.schemeVersionId,
      name: "Reparto 50/30/20",
      base: "neto",
      lines: [
        { beneficiaryId: b.beneficiaryIds.a, name: "Grupo A", pct: "50" },
        { beneficiaryId: b.beneficiaryIds.b, name: "Grupo B", pct: "30" },
        { beneficiaryId: b.beneficiaryIds.c, name: "Grupo C", pct: "20" },
      ],
      remainder: null,
    },
  };
}

/**
 * Registra cobros E1 del spec (100,00 → comisiones 9,70, neto 90,30) por Stripe, cada uno con su referencia,
 * `daysAgo` días antes de hoy (con «Pago rápido» cae el mismo día). Devuelve sus ids, en el mismo orden.
 */
async function register(
  refs: readonly string[],
  opts: { daysAgo: number; currency?: Currency } = { daysAgo: 1 },
): Promise<string[]> {
  const currency = opts.currency ?? "USD";
  const on = addDays(today, -opts.daysAgo);
  const breakdown = compute(
    basicsRules(user.basics),
    { grossOriginal: "100.00", refunded: "0.00", dispute: null, failed: false },
    currency,
  ) as unknown as Json;
  const saved = await saveTransactions(
    client,
    refs.map((reference) =>
      e1Item(user.basics, {
        reference,
        currency,
        breakdown,
        occurred_at: `${on}T15:00:00+00:00`,
        occurred_on: on,
        estimated_deposit_on: on,
      }),
    ),
  );
  return saved.map((row) => row.id);
}

/** La fila (escritorio) o la tarjeta (celular) del cobro con esa referencia. */
function cobro(page: Page, isMobile: boolean, reference: string): Locator {
  return page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: reference });
}

async function expectCleanScreen(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Abre «Más filtros» si está cerrado. */
async function openMoreFilters(page: Page): Promise<void> {
  const more = page.locator("details", { has: page.getByText("Más filtros") });
  if (!(await more.evaluate((details: HTMLDetailsElement) => details.open))) {
    await page.getByText("Más filtros").click();
  }
}

test("«Listo cuando» n.º 5: tres cobros de Stripe depositados en lote, «Sin comprobante» y el CSV", async ({
  page,
  isMobile,
}) => {
  const three = ["pi_lc5_1", "pi_lc5_2", "pi_lc5_3"];
  // Hace 2, 3 y 4 días: depositados hoy, la pasarela tarda 3 días en promedio.
  for (const [index, reference] of three.entries()) await register([reference], { daysAgo: index + 2 });
  // Uno más, con comprobante: «Sin comprobante» no lo trae.
  const [withReceipt = ""] = await register(["pi_lc5_con"], { daysAgo: 1 });
  unwrap(
    await client
      .from("pay_transaction_receipts")
      .insert({
        transaction_id: withReceipt,
        path: `${user.id}/${withReceipt}/recibo.png`,
        mime: "image/png",
        size_bytes: 10,
      })
      .select("id")
      .single(),
    "comprobante",
  );

  const gatewayTotals = async () =>
    unwrap(
      await client
        .from("pay_gateway_totals")
        .select("deposited_count, avg_days::text")
        .eq("gateway_id", user.basics.gatewayId)
        .eq("currency", "USD")
        .single(),
      "totales de la pasarela",
    );
  expect(await gatewayTotals()).toEqual({ deposited_count: 0, avg_days: null });

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=pi_lc5");
  await expect(page.getByRole("heading", { level: 1, name: "Cobros" })).toBeVisible();
  for (const reference of [...three, "pi_lc5_con"]) {
    await expect(cobro(page, isMobile, reference)).toContainText("Registrado");
  }
  await expectCleanScreen(page);

  for (const reference of three) {
    await page.getByRole("checkbox", { name: `Seleccionar el cobro ${reference}` }).check();
  }
  await expect(page.getByText("3 seleccionados")).toBeVisible();
  await page.getByRole("button", { name: "Marcar depositado" }).click();
  const dialog = page.getByRole("dialog", { name: "Marcar depositado" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Fecha del depósito").fill(today);
  await expectCleanScreen(page);
  await dialog.getByRole("button", { name: "Marcar depositado" }).click();

  await expect(page.getByText("3 cobros marcados como depositados.")).toBeVisible();
  await expect(dialog).toBeHidden();
  for (const reference of three) {
    await expect(cobro(page, isMobile, reference)).toContainText("Depositado");
  }
  await expect(cobro(page, isMobile, "pi_lc5_con")).toContainText("Registrado");
  await expect(page.getByText(/seleccionados/)).toBeHidden();
  // El tiempo real de la pasarela: depositados hoy, cobrados hace 2, 3 y 4 días.
  expect(await gatewayTotals()).toEqual({ deposited_count: 3, avg_days: "3.00" });

  // «Sin comprobante» los encuentra (y deja fuera el que tiene uno).
  await openMoreFilters(page);
  await page.getByLabel("Comprobante").selectOption({ label: "Sin comprobante" });
  await expect(page).toHaveURL(/comprobante=sin/);
  await expect(cobro(page, isMobile, "pi_lc5_con")).toHaveCount(0);
  for (const reference of three) await expect(cobro(page, isMobile, reference)).toContainText("Depositado");
  await expectCleanScreen(page);

  // El CSV (en español) de ese filtro: sus referencias y sus montos con coma.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "CSV en español" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^cobros-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile(await download.path(), "utf8");
  const rows = csv.replace(/^﻿/, "").trim().split("\r\n");
  expect(rows).toHaveLength(4);
  for (const reference of three) {
    const row = rows.find((line) => line.includes(reference));
    expect(row?.split(";")).toEqual(
      expect.arrayContaining(["Stripe", "USD", "100,00", "9,70", "90,30", "Depositado", today]),
    );
  }
  expect(csv).not.toContain("pi_lc5_con");

  // El archivo no se guarda en ninguna caché y se ofrece como descarga; el estándar va con coma y punto decimal.
  const standard = await page.request.get(
    "/pasarelas/cobros/exportar?periodo=30d&q=pi_lc5&comprobante=sin&formato=estandar",
    { maxRedirects: 0 },
  );
  expect(standard.status()).toBe(200);
  expect(standard.headers()["cache-control"]).toBe("no-store");
  expect(standard.headers()["content-type"]).toBe("text/csv; charset=utf-8");
  expect(standard.headers()["content-disposition"]).toMatch(/^attachment; filename="cobros-\d{4}-\d{2}-\d{2}\.csv"$/);
  const standardText = await standard.text();
  expect(standardText).toContain(",100.00,0.00,100.00,9.70,9.7,90.30,Depositado,");
  expect(standardText).not.toContain("pi_lc5_con");
});

test("los totales son de todo el filtro (no de la página) y no mezclan monedas", async ({ page, isMobile }) => {
  const usd = Array.from({ length: 51 }, (_, i) => `tot_us_${String(i + 1).padStart(2, "0")}`);
  await register(usd, { daysAgo: 1 });
  await register(["tot_mx_01"], { daysAgo: 1, currency: "MXN" });

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=tot_");
  const totals = page.getByRole("region", { name: "Totales del filtro" });
  await expect(totals).toContainText("USD · 51 cobros");
  await expect(totals).toContainText("$5.100,00");
  await expect(totals).toContainText("$4.605,30");
  await expect(totals).toContainText("MXN · 1 cobro");
  await expect(totals).toContainText("100,00 MXN");
  await expect(totals).toContainText("90,30 MXN");
  // 51 + 1 cobros en páginas de 50.
  await expect(page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: "tot_" })).toHaveCount(50);
  await expect(page.getByRole("navigation", { name: "Paginación" })).toContainText("1 de 2");
  await expectCleanScreen(page);

  await page.getByRole("link", { name: /Siguiente/ }).click();
  await expect(page).toHaveURL(/pagina=2/);
  await expect(page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: "tot_" })).toHaveCount(2);
  // Los totales no cambian con la página.
  await expect(totals).toContainText("USD · 51 cobros");
});

test("recalcular enseña el antes y el después antes de aplicar", async ({ page, isMobile }) => {
  const [id = ""] = await register(["rc_1"], { daysAgo: 5 });
  // Stripe sube su tarifa desde hoy: 3,5 % + 0,30.
  unwrap(
    await client
      .from("pay_gateway_fee_versions")
      .insert({ gateway_id: user.basics.gatewayId, pct: "3.5", fixed: "0.30", effective_from: today })
      .select("id")
      .single(),
    "tarifa nueva",
  );
  const netOf = async () =>
    unwrap(await client.from("pay_transactions").select("net_amount::text").eq("id", id).single(), "cobro")
      .net_amount;

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=rc_1");
  await page.getByRole("checkbox", { name: "Seleccionar el cobro rc_1" }).check();
  await page.getByRole("button", { name: "Recalcular" }).click();
  const dialog = page.getByRole("dialog", { name: "Recalcular" });
  await expect(dialog.getByRole("radio", { name: "Tarifa vigente hoy" })).toBeChecked();

  // Con la tarifa de la fecha del cobro no cambia nada.
  await dialog.getByRole("radio", { name: "La de la fecha del cobro" }).check();
  await dialog.getByRole("button", { name: "Ver el antes y el después" }).click();
  await expect(dialog).toContainText("1 cobro queda igual.");
  await expect(dialog.getByRole("button", { name: /Aplicar/ })).toHaveCount(0);

  // Con la de hoy: Stripe 3,20 → 3,80; comisiones 9,70 → 10,30; neto 90,30 → 89,70.
  await dialog.getByRole("radio", { name: "Tarifa vigente hoy" }).check();
  await expect(dialog).not.toContainText("queda igual");
  await dialog.getByRole("button", { name: "Ver el antes y el después" }).click();
  const table = dialog.getByRole("table");
  await expect(table.getByRole("row").filter({ hasText: "Stripe" })).toContainText(/\$3,20.*\$3,80/);
  await expect(table.getByRole("row").filter({ hasText: "Comisiones" })).toContainText(/\$9,70.*\$10,30/);
  await expect(table.getByRole("row").filter({ hasText: "Neto" })).toContainText(/\$90,30.*\$89,70/);
  await expectCleanScreen(page);
  // Enseñar no es aplicar: todavía no cambió nada.
  expect(await netOf()).toBe("90.30");

  await dialog.getByRole("button", { name: "Aplicar a 1 cobro" }).click();
  await expect(page.getByText("1 cobro recalculado.")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(await netOf()).toBe("89.70");
  await expect(cobro(page, isMobile, "rc_1")).toContainText("$89,70");
});

test("en tránsito y a la papelera, en lote", async ({ page, isMobile }) => {
  await register(["lt_1", "lt_2"], { daysAgo: 1 });

  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=lt_");
  await page.getByRole("checkbox", { name: "Seleccionar todos los cobros de esta página" }).check();
  await expect(page.getByText("2 seleccionados")).toBeVisible();
  await page.getByRole("button", { name: "Marcar en tránsito" }).click();
  await expect(page.getByText("2 cobros marcados en tránsito.")).toBeVisible();
  for (const reference of ["lt_1", "lt_2"]) {
    await expect(cobro(page, isMobile, reference)).toContainText("En tránsito");
  }

  await page.getByRole("checkbox", { name: "Seleccionar el cobro lt_2" }).check();
  await page.getByRole("button", { name: "A la papelera" }).click();
  const confirm = page.getByRole("alertdialog", { name: "¿Enviar 1 cobro a la papelera?" });
  await expectCleanScreen(page);
  await confirm.getByRole("button", { name: "Enviar a la papelera" }).click();
  await expect(page.getByText("1 cobro enviado a la papelera.")).toBeVisible();
  await expect(cobro(page, isMobile, "lt_2")).toHaveCount(0);
  await expect(cobro(page, isMobile, "lt_1")).toBeVisible();
});

test("sin cobros que cumplan el filtro, lo dice y ofrece registrar uno", async ({ page }) => {
  await login(page, user);
  await page.goto("/pasarelas/cobros?periodo=30d&q=no_existe_nada");
  await expect(page.getByText("No hay cobros con estos filtros")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Registrar cobro" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Totales del filtro" })).toHaveCount(0);
  await expectCleanScreen(page);
});

test("sin sesión, la ruta del CSV no entrega datos", async ({ request }) => {
  const response = await request.get("/pasarelas/cobros/exportar", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(new URL(response.headers().location ?? "", "http://x").pathname).toBe("/login");
});
