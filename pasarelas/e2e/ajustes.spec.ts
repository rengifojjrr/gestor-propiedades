import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { todayNY } from "../src/lib/pasarelas/dates";
import { e1Item, enrollTotp, saveTransactions, signInAal1 } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser } from "./helpers";

/**
 * Ajustes → «Exportar todo»: la copia propia del dueño, en el celular (390×844), como las demás pruebas de la sesión.
 */
test.skip(({ isMobile }) => !isMobile, "Ajustes se prueba en el celular (390×844)");

const TABLAS = [
  "pay_allocations",
  "pay_bank_accounts",
  "pay_beneficiaries",
  "pay_channels",
  "pay_companies",
  "pay_company_gateways",
  "pay_gateway_extras",
  "pay_gateway_fee_versions",
  "pay_gateway_retention_recipients",
  "pay_gateways",
  "pay_holidays",
  "pay_retention_shares",
  "pay_scheme_lines",
  "pay_scheme_versions",
  "pay_schemes",
  "pay_settlement_items",
  "pay_settlements",
  "pay_transaction_events",
  "pay_transaction_receipts",
  "pay_transactions",
];

type ExportFile = {
  format: string;
  version: number;
  exportedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
};

/** El nombre del archivo de hoy (en Nueva York). Antes y después, por si la prueba cruza la medianoche. */
function namesAround(before: Date): string[] {
  return [before, new Date()].map((now) => `pasarelas-${todayNY(now)}.json`);
}

test("«Exportar todo» descarga un JSON con las 20 tablas y los cobros, con el dinero como texto", async ({ page }) => {
  const user = await newUser();
  const client = await signInAal1(user.email, user.password);
  const cobros = await saveTransactions(client, [
    e1Item(user.basics),
    e1Item(user.basics, { reference: "pi_demo_2", occurred_at: "2026-11-14T15:00:00+00:00", occurred_on: "2026-11-14" }),
  ]);

  await login(page, user);
  await page.goto("/ajustes");
  const card = page.getByRole("region", { name: "Exportar todo" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("copia propia");
  await expect(card).toContainText(/no incluye los comprobantes/i);
  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page);

  const before = new Date();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByRole("link", { name: "Descargar copia (JSON)" }).click(),
  ]);
  expect(namesAround(before)).toContain(download.suggestedFilename());

  const file = JSON.parse(await readFile(await download.path(), "utf8")) as ExportFile;
  expect(file.format).toBe("pasarelas-export");
  expect(file.version).toBe(1);
  expect(Date.parse(file.exportedAt)).toBeGreaterThanOrEqual(before.getTime() - 1_000);
  expect(Object.keys(file.tables).sort()).toEqual(TABLAS);

  const exportados = file.tables.pay_transactions ?? [];
  expect(exportados.map((fila) => fila.id).sort()).toEqual(cobros.map((cobro) => cobro.id).sort());
  for (const cobro of exportados) {
    expect(cobro).toMatchObject({ user_id: user.id, gross_amount: "100.00", fees_total: "9.70", net_amount: "90.30" });
  }
  expect(file.tables.pay_allocations).toHaveLength(6);
  expect(file.tables.pay_companies).toEqual([expect.objectContaining({ name: "Escuela Demo" })]);

  // La respuesta no se guarda en ninguna caché y se ofrece como archivo.
  const response = await page.request.get("/ajustes/exportar", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/json; charset=utf-8");
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(namesAround(before).map((name) => `attachment; filename="${name}"`)).toContain(
    response.headers()["content-disposition"],
  );
});

test("sin sesión, o sin el código del segundo factor, la ruta de exportar no entrega datos", async ({ page, request }) => {
  const sinSesion = await request.get("/ajustes/exportar", { maxRedirects: 0 });
  expect(sinSesion.status()).toBe(307);
  expect(new URL(sinSesion.headers().location ?? "", "http://x").pathname).toBe("/login");
  expect(await sinSesion.text()).not.toContain("pasarelas-export");

  // Con un segundo factor y solo la contraseña (aal1) tampoco: la base devolvería tablas vacías como si nada.
  const user = await newUser();
  await enrollTotp(await signInAal1(user.email, user.password));
  await page.goto("/login");
  await page.getByLabel("Correo").fill(user.email);
  await page.getByLabel("Contraseña").fill(user.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/login\/verificar/);
  const aal1 = await page.request.get("/ajustes/exportar", { maxRedirects: 0 });
  expect(aal1.status()).toBe(307);
  expect(new URL(aal1.headers().location ?? "", "http://x").pathname).toBe("/login/verificar");
  expect(await aal1.text()).not.toContain("pasarelas-export");
});
