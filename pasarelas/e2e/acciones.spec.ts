import { crc32, deflateSync } from "node:zlib";
import { expect, request as playwrightRequest, test, type Page, type Request } from "@playwright/test";
import { adminClient, createUser, enrollTotp, signInAal1 } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * Las Server Actions y los comprobantes desde el navegador, sobre el banco de pruebas `/kit/acciones` (solo existe
 * en desarrollo, o en un build con PASARELAS_KIT=1). En el celular (390×844), con usuarios reales del stack local.
 */
test.skip(({ isMobile }) => !isMobile, "Las acciones se prueban en el celular (390×844)");

const BUCKET = "comprobantes";
const MB = 1024 * 1024;
const SIGNED_PATH = "/storage/v1/object/sign/";

const admin = adminClient();

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

async function openBench(page: Page): Promise<void> {
  await page.goto("/kit/acciones");
  await expect(page.getByRole("heading", { level: 1, name: "Banco de pruebas de acciones" })).toBeVisible();
}

async function expectCleanScreen(page: Page): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

/** Los archivos de una carpeta de Storage, vistos con la clave secreta. */
async function filesIn(folder: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit: 1000 });
  if (error) throw new Error(`No se pudo listar ${folder}: ${error.message}`);
  return data.map((file) => file.name).sort();
}

async function receiptsOf(transactionId: string) {
  const { data, error } = await admin
    .from("pay_transaction_receipts")
    .select("id, path, mime, size_bytes, original_name")
    .eq("transaction_id", transactionId);
  if (error) throw new Error(`No se pudieron leer los comprobantes: ${error.message}`);
  return data;
}

/** Los segundos que vale el token de una URL firmada (`exp − iat`). */
function lifetimeOf(signedUrl: string): number {
  const token = new URL(signedUrl).searchParams.get("token") ?? "";
  const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()) as {
    iat: number;
    exp: number;
  };
  return claims.exp - claims.iat;
}

/**
 * Las cabeceras que hacen falta para repetir una llamada a una Server Action desde fuera del navegador. Ni las
 * cookies (la sesión la pone quien repite) ni los ids con los que `next dev` ata la respuesta a esa pestaña.
 */
function actionHeaders(call: Request): Record<string, string> {
  const keep = new Set(["next-action", "next-router-state-tree", "accept", "content-type"]);
  return Object.fromEntries(Object.entries(call.headers()).filter(([name]) => keep.has(name)));
}

const isActionCall = (call: Request) => call.method() === "POST" && call.headers()["next-action"] !== undefined;

test.describe.serial("acciones del servidor y comprobantes", () => {
  let owner: TestUser;
  let other: TestUser;
  let txId: string;
  let receiptId: string;
  let receiptPath: string;

  /** Los errores sin atrapar de la página: cada prueba termina sin ninguno. */
  let pageErrors: string[] = [];

  test.beforeAll(async () => {
    [owner, other] = await Promise.all([newUser(), newUser()]);
  });

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
  });

  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test("createTransaction registra E1 y la página enseña sus cifras; dos pulsaciones con el mismo id dejan un solo cobro", async ({
    page,
  }) => {
    await login(page, owner);
    // Se cuentan desde aquí: la entrada también es una Server Action y no es de las que se prueban.
    let actionCalls = 0;
    page.on("response", (response) => {
      if (isActionCall(response.request())) actionCalls += 1;
    });
    await openBench(page);
    // La página lee la configuración con getPayConfig, que siembra los feriados la primera vez.
    const holidays = await admin.from("pay_holidays").select("day").eq("user_id", owner.id);
    expect(holidays.data?.length ?? 0).toBeGreaterThan(0);
    await expect(page.getByText("Todavía no hay cobros.")).toBeVisible();
    await expectCleanScreen(page);

    const register = page.getByRole("button", { name: "Registrar cobro E1" });
    await register.click();
    await register.click();

    await expect.poll(() => actionCalls).toBe(2);
    const last = page.getByRole("region", { name: "Último cobro" });
    await expect(last.getByTestId("comisiones")).toHaveText("$9,70");
    await expect(last.getByTestId("neto")).toHaveText("$90,30");
    await expect(last.getByRole("listitem").filter({ hasText: "Grupo A" })).toContainText("$45,15");
    const rows = await admin.from("pay_transactions").select("id").eq("user_id", owner.id);
    expect(rows.data).toHaveLength(1);
    txId = rows.data?.[0]?.id ?? "";
    await expectCleanScreen(page);
  });

  test("se adjunta un PNG generado en memoria: se achica a 1600 px, se guarda como WebP y se ve por su URL firmada", async ({
    page,
  }) => {
    await login(page, owner);
    await openBench(page);

    await page.getByLabel("Elegir archivo").setInputFiles({
      name: "recibo-demo.png",
      mimeType: "image/png",
      buffer: png(2400, 1200),
    });
    await page.getByRole("button", { name: "Subir comprobante" }).click();
    await expect(page.getByText("Comprobante agregado.")).toBeVisible();

    const [receipt, ...more] = await receiptsOf(txId);
    expect(more).toEqual([]);
    expect(receipt).toMatchObject({ mime: "image/webp", original_name: "recibo-demo.png" });
    expect(receipt?.path).toMatch(new RegExp(`^${owner.id}/${txId}/[0-9a-f-]{36}\\.webp$`));
    receiptId = receipt?.id ?? "";
    receiptPath = receipt?.path ?? "";

    await page.getByRole("button", { name: "Ver comprobante" }).click();
    const image = page.getByRole("img", { name: "Comprobante" });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => [el.complete, el.naturalWidth, el.naturalHeight]))
      .toEqual([true, 1600, 800]);
    const signedUrl = (await image.getAttribute("src")) ?? "";
    expect(signedUrl).toContain(`${SIGNED_PATH}${BUCKET}/${receiptPath}`);
    // El enlace que da la app vale 60 segundos.
    expect(lifetimeOf(signedUrl)).toBe(60);
    await expectCleanScreen(page);
  });

  test("un archivo de 11 MB y un .txt se rechazan antes de subir", async ({ page }) => {
    const storageWrites: string[] = [];
    page.on("request", (call) => {
      if (call.url().includes("/storage/v1/object/") && call.method() !== "GET") storageWrites.push(call.url());
    });
    await login(page, owner);
    await openBench(page);
    const picker = page.getByLabel("Elegir archivo");
    const upload = page.getByRole("button", { name: "Subir comprobante" });

    await picker.setInputFiles({ name: "grande.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(11 * MB, 0x25) });
    await expect(page.getByText("El archivo pesa más de 10 MB.")).toBeVisible();
    await expect(upload).toBeDisabled();
    await expectCleanScreen(page);

    await picker.setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("Pagado a Grupo A") });
    await expect(page.getByText("Ese tipo de archivo no se admite: solo JPG, PNG, WebP o PDF.")).toBeVisible();
    await expect(upload).toBeDisabled();

    expect(storageWrites).toEqual([]);
    expect(await filesIn(`${owner.id}/${txId}`)).toEqual([receiptPath.split("/").at(-1)]);
    expect(await receiptsOf(txId)).toHaveLength(1);
  });

  test("otro usuario no abre ese comprobante ni registra uno en un cobro ajeno, y un enlace caducado deja de abrir", async ({
    page,
  }) => {
    await login(page, other);
    await openBench(page);
    const receipts = page.getByRole("region", { name: "Comprobantes" });

    // (a) Con la app: la acción no le da la URL a otro usuario…
    await page.getByLabel("Id del comprobante").fill(receiptId);
    await page.getByRole("button", { name: "Abrir comprobante" }).click();
    await expect(receipts.getByRole("alert")).toHaveText("Ese comprobante ya no existe.");
    await expect(page.getByRole("img", { name: "Comprobante" })).toHaveCount(0);
    await expectCleanScreen(page);

    // …ni le deja registrar un comprobante en el cobro de otro (y no le queda el archivo subido).
    await page.getByLabel("Cobro", { exact: true }).fill(txId);
    await page.getByLabel("Elegir archivo").setInputFiles({ name: "ajeno.png", mimeType: "image/png", buffer: png(40, 20) });
    await page.getByRole("button", { name: "Subir comprobante" }).click();
    await expect(receipts.getByRole("alert")).toHaveText("Algo de lo elegido ya no existe. Vuelve a cargar la página.");
    expect(await receiptsOf(txId)).toHaveLength(1);
    await expect.poll(() => filesIn(`${other.id}/${txId}`)).toEqual([]);

    // (b) Hablando directo con Storage tampoco puede firmar esa ruta.
    const otherClient = await signInAal1(other.email, other.password);
    const stolen = await otherClient.storage.from(BUCKET).createSignedUrl(receiptPath, 60);
    expect(stolen.data).toBeNull();
    expect(stolen.error).not.toBeNull();

    // (c) Un enlace caducado deja de abrir: uno de 2 segundos, firmado por el dueño.
    const ownerClient = await signInAal1(owner.email, owner.password);
    const short = await ownerClient.storage.from(BUCKET).createSignedUrl(receiptPath, 2);
    const shortUrl = short.data?.signedUrl ?? "";
    expect((await fetch(shortUrl)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect((await fetch(shortUrl)).ok).toBe(false);
  });

  test("una acción llamada sin sesión, o sin el segundo factor, no devuelve datos", async ({ page, baseURL }) => {
    await login(page, owner);
    await openBench(page);
    const [call] = await Promise.all([
      page.waitForRequest(isActionCall),
      page.getByRole("button", { name: "Ver comprobante" }).click(),
    ]);
    const replay = { headers: actionHeaders(call), data: call.postData() ?? "", maxRedirects: 0 };

    // Con la sesión del dueño, la misma llamada repetida devuelve la URL: la repetición funciona.
    const own = await page.request.post(page.url(), replay);
    expect(await own.text()).toContain(SIGNED_PATH);

    // Sin sesión: el proxy la manda a la entrada y no llega a la acción.
    const anonymous = await playwrightRequest.newContext({ baseURL });
    const noSession = await anonymous.post(page.url(), replay);
    expect(noSession.status()).toBe(307);
    expect(noSession.headers().location).toMatch(/^\/login\?siguiente=/);
    expect(await noSession.text()).not.toContain(SIGNED_PATH);
    await anonymous.dispose();

    // Con sesión pero sin el código del segundo factor (aal1): el proxy la deja pasar y la acción no da nada.
    const guarded = await createUser();
    await enrollTotp(guarded.client);
    const signIn = await page.context().browser()?.newContext({ baseURL });
    if (signIn === undefined) throw new Error("No hay navegador");
    const signInPage = await signIn.newPage();
    await signInPage.goto("/login");
    await signInPage.getByLabel("Correo").fill(guarded.email);
    await signInPage.getByLabel("Contraseña").fill(guarded.password);
    await signInPage.getByRole("button", { name: "Entrar" }).click();
    await expect(signInPage).toHaveURL(/\/login\/verificar/);
    const withoutCode = await signInPage.request.post(page.url(), replay);
    expect(await withoutCode.text()).not.toContain(SIGNED_PATH);
    expect(withoutCode.headers()["x-action-redirect"] ?? withoutCode.headers().location).toMatch(/\/login\/verificar/);
    await signIn.close();
  });
});
