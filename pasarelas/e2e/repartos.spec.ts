import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { SCHEME_ISSUE_TEXT } from "../src/lib/pasarelas/schemes";
import { adminClient, e1Item, saveTransactions, signInAal1 } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Repartos: el libro por beneficiario y moneda (un saldo negativo dice «a favor de la empresa»), armar un esquema
 * 50/30/20 (con 50/30 y sin «Resto» no se guarda, y se dice por qué) y registrar una liquidación de 45,15 al
 * Grupo A con su comprobante. Un usuario nuevo por proyecto (celular y escritorio), con el cobro E1 ya registrado.
 */

const admin = adminClient();

let user: TestUser;

test.beforeAll(async () => {
  user = await newUser();
  const client = await signInAal1(user.email, user.password);
  // E1: A 45,15 · B 27,09 · C 18,06. Al Grupo B ya se le pagaron 30,00: su saldo queda en −2,91.
  await saveTransactions(client, [e1Item(user.basics, { reference: "pi_e2e_repartos" })]);
  await client
    .from("pay_settlements")
    .insert({
      beneficiary_id: user.basics.beneficiaryIds.b,
      paid_on: "2026-11-14",
      currency: "USD",
      amount: "30.00",
      method: "Transferencia",
    })
    .throwOnError();
});

test.beforeEach(async ({ page }) => {
  await login(page, user);
});

/** Un PNG de verdad, de un solo color, armado en memoria (firma, IHDR, IDAT comprimido e IEND). */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits por canal
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([0x2a, 0x7a, 0x5c], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * axe sin violaciones serias y nada que se desborde. Antes se espera a que terminen las transiciones (la entrada de
 * un aviso pasajero): a medio aparecer, su texto todavía es translúcido y axe lo mide sin el contraste final.
 */
async function expectCleanScreen(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running" || animation.effect?.getTiming().iterations === Infinity),
  );
  await expectNoSeriousAxe(page);
  await expectNoHorizontalOverflow(page);
}

/** El renglón de un beneficiario en el libro. */
const ledgerEntry = (page: Page, name: string) =>
  page.getByRole("region", { name: "Libro" }).getByRole("listitem").filter({ hasText: name });

test("el libro: asignado, liquidado y saldo por beneficiario; un saldo negativo dice «a favor de la empresa»", async ({
  page,
}) => {
  await page.goto("/pasarelas/repartos");
  await expect(page.getByRole("heading", { level: 1, name: "Repartos" })).toBeVisible();

  const a = ledgerEntry(page, "Grupo A");
  await expect(a.getByText("Asignado")).toBeVisible();
  await expect(a).toContainText("$45,15");
  await expect(a).not.toContainText("a favor de la empresa");

  const b = ledgerEntry(page, "Grupo B");
  await expect(b).toContainText("$27,09");
  await expect(b).toContainText("$30,00");
  await expect(b).toContainText("-$2,91");
  await expect(b).toContainText("a favor de la empresa");

  // Los esquemas y los beneficiarios, en la misma pantalla.
  await expect(page.getByRole("region", { name: "Esquemas" })).toContainText("Reparto 50/30/20");
  await expect(page.getByRole("region", { name: "Beneficiarios" }).getByRole("link", { name: "Grupo C" })).toBeVisible();
  await expectCleanScreen(page);
});

test("armar un esquema 50/30/20; con 50/30 y sin «Resto» no se guarda y dice por qué; con «Resto» sí", async ({
  page,
}) => {
  await page.goto("/pasarelas/repartos");
  await page.getByRole("link", { name: "Nuevo esquema" }).click();
  await expect(page).toHaveURL(/\/pasarelas\/repartos\/esquemas\/nuevo$/);
  await expect(page.getByRole("heading", { level: 1, name: "Nuevo esquema" })).toBeVisible();

  await page.getByLabel("Nombre del esquema").fill("Socios Demo");
  const line = (n: number) => page.getByRole("group", { name: `Línea ${n}` });
  await line(1).getByLabel("Beneficiario").selectOption({ label: "Grupo A" });
  await line(1).getByLabel("Porcentaje").fill("50");
  await page.getByRole("button", { name: "Agregar línea" }).click();
  await line(2).getByLabel("Beneficiario").selectOption({ label: "Grupo B" });
  await line(2).getByLabel("Porcentaje").fill("30");
  await page.getByRole("button", { name: "Agregar línea" }).click();
  await line(3).getByLabel("Beneficiario").selectOption({ label: "Grupo C" });
  await line(3).getByLabel("Porcentaje").fill("20");

  const sum = page.getByTestId("suma-esquema");
  const save = page.getByRole("button", { name: "Guardar esquema" });
  await expect(sum).toHaveText("Suman 100 %");
  await expect(save).toBeEnabled();
  await expectCleanScreen(page);

  // Sin el Grupo C quedan 50/30: suma 80 % y nadie recibe el resto.
  await page.getByRole("button", { name: "Quitar la línea 3" }).click();
  await expect(sum).toHaveText("Suman 80 %");
  await expect(page.getByText(SCHEME_ISSUE_TEXT.suma_menor_sin_resto)).toBeVisible();
  await expect(save).toBeDisabled();
  await expectCleanScreen(page);

  // Con «Resto» para el Grupo C sí se puede.
  await page.getByLabel("Resto").selectOption({ label: "Grupo C" });
  await expect(page.getByText(SCHEME_ISSUE_TEXT.suma_menor_sin_resto)).toBeHidden();
  await expect(page.getByText("El resto, 20 %, va a Grupo C.")).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page).toHaveURL(/\/pasarelas\/repartos\/esquemas\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Socios Demo" })).toBeVisible();
  const current = page.getByRole("region", { name: "Vigente hoy" });
  await expect(current).toContainText("Grupo A");
  await expect(current).toContainText("50 %");
  await expect(current).toContainText("Grupo B");
  await expect(current).toContainText("30 %");
  await expect(current).toContainText("Resto: Grupo C");
  await expect(current).toContainText("Desde el inicio");
  await expectCleanScreen(page);
});

test("registrar una liquidación de 45,15 al Grupo A con comprobante: su saldo baja a cero", async ({ page }) => {
  await page.goto("/pasarelas/repartos");
  await page.getByRole("region", { name: "Libro" }).getByRole("link", { name: "Grupo A" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Grupo A" })).toBeVisible();

  const balance = page.getByRole("region", { name: "Saldo" });
  await expect(balance.getByTestId("saldo-USD")).toHaveText("$45,15");
  await expectCleanScreen(page);

  const form = page.getByRole("region", { name: "Registrar liquidación" });
  await form.getByLabel("Monto").fill("45,15");
  await form.getByLabel("Medio").fill("Transferencia");
  await form.getByLabel("Elegir archivo").setInputFiles({
    name: "liquidacion-demo.png",
    mimeType: "image/png",
    buffer: png(800, 400),
  });
  await expect(form).toContainText("liquidacion-demo.png");
  await form.getByRole("button", { name: "Registrar liquidación" }).click();

  await expect(page.getByText("Liquidación registrada")).toBeVisible();
  await expect(balance.getByTestId("saldo-USD")).toHaveText("$0,00");
  const settlements = page.getByRole("region", { name: "Liquidaciones" });
  await expect(settlements).toContainText("$45,15");
  await expect(settlements).toContainText("Transferencia");
  await expect(settlements.getByRole("button", { name: "Ver comprobante" })).toBeVisible();
  await expectCleanScreen(page);

  // El comprobante quedó en la carpeta de la liquidación.
  const { data } = await admin
    .from("pay_settlements")
    .select("id, receipt_path, receipt_mime")
    .eq("beneficiary_id", user.basics.beneficiaryIds.a)
    .single()
    .throwOnError();
  expect(data.receipt_path?.startsWith(`${user.id}/${data.id}/`)).toBe(true);
  const { data: files } = await admin.storage.from("comprobantes").list(`${user.id}/${data.id}`);
  expect(files).toHaveLength(1);

  // Y se puede ver.
  await settlements.getByRole("button", { name: "Ver comprobante" }).click();
  const viewer = page.getByRole("dialog", { name: "Comprobante" });
  await expect(viewer.getByRole("img", { name: "Comprobante de la liquidación" })).toBeVisible();
  await expectCleanScreen(page);
});
