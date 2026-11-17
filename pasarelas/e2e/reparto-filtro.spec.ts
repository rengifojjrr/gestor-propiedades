import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { addDays, formatDate, todayNY } from "../src/lib/pasarelas";
import { signInAal1, unwrap, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";
import { serverData } from "./server-data";

/**
 * El «Reparto del filtro» de Cobros, «Fechas de: el depósito» y «Pagar…» desde el resumen, en el celular (390×844) y
 * en el escritorio (1280×800). Cada prueba crea su usuario con su libro inventado: «Tienda Demo», «Stripe Demo»
 * (2,9 % + 0,30), «OTF Demo» (2,9 % + 0,20, retiene el 5 % para «Titular A»), el esquema «Socios» sobre el neto
 * (Socio Uno 50 %, Socio Dos 40 %, Titular A 10 %) y «Cargador Uno».
 *
 * R1, con Cargador Uno, del 10 al 12 nov 2026: Stripe 100,00 (48,40 · 38,72 · 9,68), OTF 1000,00 (485,40 · 388,32 ·
 * 97,08; 50,00 retenidos a Titular A) y Stripe 200,00 (96,95 · 77,56 · 19,39). Por parte: Socio Uno 630,75, Socio Dos
 * 504,60 y Titular A 126,15, de los que ya recibió 50,00: le faltan 76,15.
 */

type Book = {
  user: TestUser;
  db: Db;
  ids: Record<"Socio Uno" | "Socio Dos" | "Titular A", string>;
  loaderId: string;
  charge: (a: {
    gross: string;
    on: string;
    gateway: "stripe" | "otf";
    reference: string;
    estimatedOn?: string;
    depositedOn?: string;
  }) => Promise<string>;
};

/** El libro de la prueba, sin pasar por la pantalla, con el cliente del usuario (la RLS manda). */
async function setupBook(): Promise<Book> {
  const user = await newUser();
  const db = await signInAal1(user.email, user.password);
  const people = unwrap(
    await db
      .from("pay_beneficiaries")
      .insert([{ name: "Socio Uno" }, { name: "Socio Dos" }, { name: "Titular A" }])
      .select("id, name"),
    "partes",
  );
  const idOf = (name: string) => people.find((row) => row.name === name)?.id ?? "";
  const ids = { "Socio Uno": idOf("Socio Uno"), "Socio Dos": idOf("Socio Dos"), "Titular A": idOf("Titular A") };
  const company = await db.from("pay_companies").insert({ name: "Tienda Demo" }).select("id").single();
  const companyId = unwrap(company, "empresa").id;
  const gateway = async (name: string, fixed: string) =>
    unwrap(await db.rpc("pay_create_gateway", { p: { name, fee: { pct: "2.9", fixed } } }), name) as string;
  const stripe = await gateway("Stripe Demo", "0.30");
  const otf = await gateway("OTF Demo", "0.20");
  await db
    .rpc("pay_save_gateway_retention", {
      p: { gateway_id: otf, pct: "5", days: 30, recipients: [{ beneficiary_id: ids["Titular A"], pct: "100" }] },
    })
    .throwOnError();
  const scheme = unwrap(
    await db.rpc("pay_save_scheme", {
      p: {
        name: "Socios",
        base: "neto",
        lines: [
          { beneficiary_id: ids["Socio Uno"], pct: "50" },
          { beneficiary_id: ids["Socio Dos"], pct: "40" },
          { beneficiary_id: ids["Titular A"], pct: "10" },
        ],
      },
    }),
    "esquema",
  ) as { scheme_id: string };
  const loader = await db.from("pay_loaders").insert({ name: "Cargador Uno" }).select("id").single();
  const loaderId = unwrap(loader, "cargador").id;
  const charge: Book["charge"] = async ({ gross, on, gateway: which, reference, estimatedOn, depositedOn }) => {
    const id = randomUUID();
    await serverData().createTx(db, {
      id,
      companyId,
      channelId: null,
      gatewayId: which === "stripe" ? stripe : otf,
      extraIds: [],
      schemeId: scheme.scheme_id,
      occurredAt: `${on}T17:00:00Z`,
      occurredOn: on,
      currency: "USD",
      grossOriginal: gross,
      reference,
      note: null,
      loaderId,
      ...(estimatedOn === undefined ? {} : { estimatedDepositOn: estimatedOn }),
      ...(depositedOn === undefined ? {} : { status: "depositado" as const, depositedOn }),
    });
    return id;
  };
  return { user, db, ids, loaderId, charge };
}

/** R1: los tres cobros de Cargador Uno del 10 al 12 nov 2026 (con `tag` en la referencia). */
async function r1(book: Book, tag: string): Promise<[string, string, string]> {
  return [
    await book.charge({ gross: "100.00", on: "2026-11-10", gateway: "stripe", reference: `${tag}-1` }),
    await book.charge({ gross: "1000.00", on: "2026-11-11", gateway: "otf", reference: `${tag}-2` }),
    await book.charge({ gross: "200.00", on: "2026-11-12", gateway: "stripe", reference: `${tag}-3` }),
  ];
}

/** Pagos ya hechos, sin pasar por la pantalla: [parte, cobro, monto]. */
async function paid(book: Book, payments: [string, string, string][]): Promise<void> {
  unwrap(
    await book.db.rpc("pay_record_payouts", {
      p: {
        settlements: payments.map(([beneficiary, transaction, amount]) => ({
          id: randomUUID(),
          beneficiary_id: beneficiary,
          paid_on: "2026-11-15",
          currency: "USD",
          amount,
          items: [{ transaction_id: transaction, amount }],
        })),
      },
    }),
    "pagos",
  );
}

const r1Url = (book: Book, more = "") =>
  `/pasarelas/cobros?periodo=personalizado&desde=2026-11-10&hasta=2026-11-12&cargador=${book.loaderId}${more}`;

/** El «Reparto del filtro», abierto. */
async function openSplit(page: Page): Promise<Locator> {
  const section = page.getByRole("region", { name: "Reparto del filtro" });
  await section.getByText("Reparto del filtro").click();
  await expect(section.getByRole("list", { name: "Partes en USD" })).toBeVisible();
  return section;
}

/** Lo de una parte en el reparto del filtro. */
const party = (section: Locator, name: string): Locator =>
  section.getByRole("list", { name: "Partes en USD" }).getByRole("listitem").filter({ hasText: name });

/** Un cobro de la lista por su referencia: tarjeta en el celular, fila en el escritorio. */
const listed = (page: Page, isMobile: boolean, reference: string): Locator =>
  page.getByRole(isMobile ? "listitem" : "row").filter({ hasText: reference });

/** Un aviso pasajero con ese texto. */
const toastWith = (page: Page, text: string) =>
  page.getByRole("region", { name: /Avisos/ }).getByRole("listitem").filter({ hasText: text });

async function checkScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

test.describe("el reparto del filtro de Cobros", () => {
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

  test("R1: por parte, lo de los tres cobros de Cargador Uno; lo mismo dice el PDF del filtro", async ({ page }) => {
    const book = await setupBook();
    await r1(book, `R1-${randomUUID().slice(0, 6)}`);
    await login(page, book.user);
    await page.goto(r1Url(book));
    await expect(page.getByText("Cobros 1–3 de 3")).toBeVisible();

    // Plegado: una línea por moneda.
    const section = page.getByRole("region", { name: "Reparto del filtro" });
    await expect(section).toContainText("USD: Falta pagar $1.211,50 a 3 partes");
    await expect(section.getByRole("list", { name: "Partes en USD" })).toBeHidden();
    await checkScreen(page);

    await openSplit(page);
    await expect(party(section, "Socio Uno")).toContainText("Falta $630,75");
    await expect(party(section, "Socio Uno")).toContainText("Le toca$630,75");
    await expect(party(section, "Socio Dos")).toContainText("Falta $504,60");
    // R6: lo retenido por OTF Demo ya lo recibió Titular A, y no cuenta en lo que falta.
    await expect(party(section, "Titular A")).toContainText("Retenido$50,00");
    await expect(party(section, "Titular A")).toContainText("Falta $76,15");
    for (const name of ["Socio Uno", "Socio Dos", "Titular A"]) {
      await expect(party(section, name).getByRole("button", { name: `Pagar… a ${name} en USD` })).toBeVisible();
    }
    await checkScreen(page);

    // El PDF del mismo filtro: las mismas cifras por parte.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PDF de los cobros del filtro" }).click(),
    ]);
    const bytes = await readFile(await download.path());
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
    expect(text).toContain("Cargador: Cargador Uno");
    for (const figure of ["$630,75", "$504,60", "$126,15", "$76,15"]) expect(text).toContain(figure);
  });

  test("R2: por depósito, «Mañana» trae lo que cae mañana y «Ayer», lo depositado ayer", async ({ page, isMobile }) => {
    const book = await setupBook();
    const today = todayNY(new Date());
    const tag = `R2-${randomUUID().slice(0, 6)}`;
    const sold = addDays(today, -5);
    await book.charge({
      gross: "100.00",
      on: sold,
      gateway: "stripe",
      reference: `${tag}-manana`,
      estimatedOn: addDays(today, 1),
    });
    await book.charge({
      gross: "100.00",
      on: sold,
      gateway: "stripe",
      reference: `${tag}-ayer`,
      estimatedOn: addDays(today, 1),
      depositedOn: addDays(today, -1),
    });
    await login(page, book.user);
    await page.goto(`/pasarelas/cobros?q=${tag}`);

    // Con la venta, ni «Mañana» ni «Próximos 7 días».
    const period = page.getByLabel("Período");
    await expect(period.getByRole("option", { name: "Mañana" })).toHaveCount(0);
    await expect(page.getByText(/^Por depósito:/)).toHaveCount(0);

    await page.getByLabel("Fechas de").selectOption({ label: "El depósito" });
    await expect(page).toHaveURL(/fechas=deposito/);
    await expect(
      page.getByText(
        "Por depósito: la fecha en que lo marcaste depositado o, si no, la estimada (el último día de su ventana).",
      ),
    ).toBeVisible();
    await period.selectOption({ label: "Mañana" });
    await expect(page).toHaveURL(/periodo=manana/);
    await expect(page.getByText("Cobros 1–1 de 1")).toBeVisible();
    await expect(listed(page, isMobile, `${tag}-manana`)).toBeVisible();
    await expect(listed(page, isMobile, `${tag}-ayer`)).toHaveCount(0);
    await checkScreen(page);

    // El depositado ayer sale con «Ayer», aunque su estimada fuera mañana.
    await period.selectOption({ label: "Ayer" });
    await expect(page).toHaveURL(/periodo=ayer/);
    await expect(page.getByText("Cobros 1–1 de 1")).toBeVisible();
    await expect(listed(page, isMobile, `${tag}-ayer`)).toBeVisible();

    // De vuelta a la venta con «Mañana»: «Este mes».
    await period.selectOption({ label: "Mañana" });
    await expect(page).toHaveURL(/periodo=manana/);
    await page.getByLabel("Fechas de").selectOption({ label: "La venta" });
    await expect(page).not.toHaveURL(/fechas=/);
    await expect(period).toHaveValue("este_mes");
    await checkScreen(page);
  });

  test("R4: «Pagar…» a Socio Dos desde el resumen, de los cobros donde se le debía", async ({ page, isMobile }) => {
    const book = await setupBook();
    const tag = `R4-${randomUUID().slice(0, 6)}`;
    const [first, second, third] = await r1(book, tag);
    // Ya pagado: a Socio Dos, lo del primero; a Socio Uno y a Titular A, lo del tercero.
    await paid(book, [
      [book.ids["Socio Dos"], first, "38.72"],
      [book.ids["Socio Uno"], third, "96.95"],
      [book.ids["Titular A"], third, "19.39"],
    ]);
    await login(page, book.user);
    await page.goto(r1Url(book, "&reparto=pendiente"));
    await expect(page.getByText("Cobros 1–3 de 3")).toBeVisible();
    const section = await openSplit(page);
    await expect(party(section, "Socio Dos")).toContainText("Falta $465,88");
    await expect(party(section, "Socio Uno")).toContainText("Falta $533,80");

    await party(section, "Socio Dos").getByRole("button", { name: "Pagar… a Socio Dos en USD" }).click();
    const dialog = page.getByRole("dialog", { name: "Pagar a Socio Dos" });
    await expect(dialog).toContainText("no se mueve dinero");
    const choice = dialog.getByRole("checkbox", { name: /^Socio Dos/ });
    await expect(choice).toBeChecked();
    await expect(dialog.getByText("Socio Dos", { exact: true }).locator("..")).toContainText("$465,88");
    await expect(dialog.getByText("en 2 cobros", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Fecha del pago")).toHaveValue(todayNY(new Date()));
    await dialog.getByLabel("Medio").fill("Transferencia");
    await checkScreen(page);
    await dialog.getByRole("button", { name: "Registrar 1 pago" }).click();
    await expect(toastWith(page, "Pago registrado")).toBeVisible();
    await expect(dialog).toBeHidden();

    // El resumen y la lista se ponen al día: el tercero quedó saldado y «Reparto pendiente» ya no lo trae.
    await expect(page.getByText("Cobros 1–2 de 2")).toBeVisible();
    await expect(listed(page, isMobile, `${tag}-3`)).toHaveCount(0);
    await expect(party(section, "Socio Dos")).toContainText("Pagado");
    await expect(party(section, "Socio Dos").getByRole("button")).toHaveCount(0);
    await expect(party(section, "Socio Uno")).toContainText("Falta $533,80");
    await expect(page.getByRole("heading", { name: /^USD · / })).toBeFocused();
    await checkScreen(page);

    // El historial del cobro dice lo mismo que con «Pagar repartos…»: el pago y los dos cobros que cubre.
    await page.goto(`/pasarelas/cobros/${second}`);
    const share = page.getByRole("list", { name: "Reparto" }).getByRole("listitem").filter({ hasText: "Socio Dos" });
    await expect(share.getByText("Pagado", { exact: true })).toBeVisible();
    await expect(share).toContainText(/Pagado el .+: \$388,32/);
    await expect(share).toContainText("(de un pago de $465,88 por 2 cobros)");
    await checkScreen(page);
  });

  test("R5: a quien se le pagó de más lo dice, y no tiene «Pagar…»; si en total le falta, se descuenta", async ({
    page,
  }) => {
    const book = await setupBook();
    const [first] = await r1(book, `R5-${randomUUID().slice(0, 6)}`);
    await paid(book, [[book.ids["Socio Uno"], first, "48.40"]]);
    // Después de pagarle, se reembolsa todo el cobro: lo que le tocaba pasa a ser su parte de la pérdida (−1,60).
    await serverData().setRefundTotalTx(book.db, first, "100.00");
    await login(page, book.user);
    await page.goto(r1Url(book).replace("hasta=2026-11-12", "hasta=2026-11-10"));
    const section = page.getByRole("region", { name: "Reparto del filtro" });
    await expect(section).toContainText("USD: Todo pagado · a 3 se les pagó de más");
    await openSplit(page);
    await expect(party(section, "Socio Uno")).toContainText("Se le pagó de más $50,00");
    await expect(party(section, "Socio Uno").getByRole("button")).toHaveCount(0);
    await expect(section.getByRole("button", { name: /^Pagar…/ })).toHaveCount(0);
    await checkScreen(page);

    // Con los tres cobros, en total le falta 485,40 + 96,95 − 50,00: «Pagar…» propone eso mismo (lo de más se
    // descuenta, y lo dice) y, pagado, queda en «Pagado».
    await page.goto(r1Url(book));
    await openSplit(page);
    await expect(party(section, "Socio Uno")).toContainText("Falta $532,35");
    await party(section, "Socio Uno").getByRole("button", { name: "Pagar… a Socio Uno en USD" }).click();
    const dialog = page.getByRole("dialog", { name: "Pagar a Socio Uno" });
    await expect(dialog.getByText("Socio Uno", { exact: true }).locator("..")).toContainText("$532,35");
    await expect(dialog.getByText("en 3 cobros", { exact: true })).toBeVisible();
    await expect(dialog).toContainText("En 1 cobro del filtro se le pagó de más $50,00: se descuenta de este pago.");
    await checkScreen(page);
    await dialog.getByRole("button", { name: "Registrar 1 pago" }).click();
    await expect(toastWith(page, "Pago registrado")).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(party(section, "Socio Uno")).toContainText("Pagado");
    await expect(party(section, "Socio Uno").getByRole("button")).toHaveCount(0);
    await checkScreen(page);
  });

  test("D1: el cobro descontado de un pago lo dice como descuento, no como devolución; y su «Deshacer», también", async ({
    page,
  }) => {
    const book = await setupBook();
    const tag = `D1-${randomUUID().slice(0, 6)}`;
    const [first] = await r1(book, tag);
    // Como en R5: a Socio Uno se le pagó lo del primero y después se reembolsó entero (le sobran 50,00 ahí).
    await paid(book, [[book.ids["Socio Uno"], first, "48.40"]]);
    await serverData().setRefundTotalTx(book.db, first, "100.00");
    await login(page, book.user);
    await page.goto(r1Url(book));
    const section = await openSplit(page);
    await party(section, "Socio Uno").getByRole("button", { name: "Pagar… a Socio Uno en USD" }).click();
    const dialog = page.getByRole("dialog", { name: "Pagar a Socio Uno" });
    await expect(dialog).toContainText("En 1 cobro del filtro se le pagó de más $50,00: se descuenta de este pago.");
    await dialog.getByRole("button", { name: "Registrar 1 pago" }).click();
    await expect(toastWith(page, "Pago registrado")).toBeVisible();
    await expect(dialog).toBeHidden();

    // En el detalle del primero: un descuento del pago de 532,35 (en positivo), no una devolución.
    await page.goto(`/pasarelas/cobros/${first}`);
    const share = page.getByRole("list", { name: "Reparto" }).getByRole("listitem").filter({ hasText: "Socio Uno" });
    const line = share.getByText(/^Descontado del pago del /);
    await expect(line).toHaveText(/^Descontado del pago del .+: \$50,00 \(de un pago de \$532,35 por 3 cobros\)$/);
    await expect(share).not.toContainText("Devolvió");
    await expect(share).not.toContainText("-$532,35");
    await checkScreen(page);

    // Su «Deshacer» es el del pago, y en los cobros que cubre el descontado se dice como descuento.
    await line.locator("..").getByRole("button", { name: /^Deshacer el pago a Socio Uno del / }).click();
    const confirm = page.getByRole("alertdialog", { name: "¿Deshacer este pago?" });
    await expect(confirm).toContainText("El pago a Socio Uno de $532,35 del ");
    await expect(confirm).toContainText(
      `cubre 3 cobros, y se desmarcan los tres: este (descuento de $50,00), el cobro ${tag}-2 ($485,40) y el cobro ` +
        `${tag}-3 ($96,95).`,
    );
    await checkScreen(page);
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirm).toBeHidden();

    // En la ficha de Socio Uno: un «Pago» de $532,35, con el primero como descuento.
    await page.goto(`/pasarelas/repartos/beneficiarios/${book.ids["Socio Uno"]}`);
    const settlements = page.getByRole("region", { name: "Liquidaciones" });
    const payment = settlements.getByRole("listitem").filter({ hasText: "$532,35" });
    await expect(payment.getByText("Pago", { exact: true })).toBeVisible();
    const covered = payment.getByRole("list", { name: "Cobros que paga" }).getByRole("listitem");
    await expect(covered.filter({ hasText: `${tag}-1` })).toHaveText(new RegExp(`^${tag}-1.*descuento de \\$50,00$`));
    await expect(covered.filter({ hasText: `${tag}-2` })).toContainText("$485,40");
    await expect(settlements).not.toContainText("-$50,00");
    await checkScreen(page);
  });

  test("D3: «Ayer» escrito a mano en el Resumen, Cargadores o la ficha de una empresa vale lo que dice su selector", async ({
    page,
    isMobile,
  }) => {
    const book = await setupBook();
    const today = todayNY(new Date());
    const yesterday = addDays(today, -1);
    const tag = `D3-${randomUUID().slice(0, 6)}`;
    await book.charge({ gross: "100.00", on: today, gateway: "stripe", reference: `${tag}-hoy` });
    await book.charge({ gross: "200.00", on: yesterday, gateway: "stripe", reference: `${tag}-ayer` });
    // «Este mes», lo que dicen sus selectores: los dos (o solo el de hoy, si hoy es día 1). «Ayer» sería el de 200,00.
    const sameMonth = yesterday.slice(0, 7) === today.slice(0, 7);
    const [count, gross] = sameMonth ? ["2", "$300,00"] : ["1", "$100,00"];
    const range = `Del ${formatDate(`${today.slice(0, 8)}01`)} al ${formatDate(today)}`;
    await login(page, book.user);

    // El Resumen: el selector dice «Este mes» y las cifras y el período son los de este mes.
    await page.goto("/pasarelas?periodo=ayer");
    const figures = page.getByRole("region", { name: "Cifras del período" });
    await expect(figures.getByRole("group", { name: "Cobros", exact: true })).toHaveText(new RegExp(`^Cobros\\s*${count}$`));
    await expect(figures.getByRole("group", { name: "Bruto", exact: true })).toContainText(gross);
    await expect(page.getByText(range)).toBeVisible();
    if (isMobile) await page.getByRole("button", { name: /^Filtros Este mes/ }).click();
    await expect(page.getByLabel("Período", { exact: true })).toHaveValue("este_mes");
    await checkScreen(page);

    // Cargadores: lo mismo, y su enlace lleva a la lista con ese mismo período (sin «ayer»).
    await page.goto("/pasarelas/cargadores?periodo=ayer");
    await expect(page.getByLabel("Período", { exact: true })).toHaveValue("este_mes");
    await expect(page.getByText(`${range}.`)).toBeVisible();
    const loader = page.getByRole("region", { name: "Cargador Uno" });
    await expect(loader.getByRole("group", { name: "Cobros", exact: true })).toHaveText(new RegExp(`^Cobros\\s*${count}$`));
    await expect(loader.getByRole("group", { name: "Bruto", exact: true })).toContainText(gross);
    await expect(loader.getByRole("link", { name: "Ver los cobros de Cargador Uno" })).toHaveAttribute(
      "href",
      `/pasarelas/cobros?cargador=${book.loaderId}`,
    );
    await checkScreen(page);

    // La ficha de la empresa: lo facturado en el período es lo de este mes.
    const company = unwrap(await book.db.from("pay_companies").select("id").eq("name", "Tienda Demo").single(), "empresa");
    await page.goto(`/pasarelas/empresas/${company.id}?periodo=ayer`);
    await expect(page.getByLabel("Período", { exact: true })).toHaveValue("este_mes");
    await expect(page.getByRole("region", { name: "Lo facturado" })).toContainText(
      `Esta empresa ha facturado ${gross} en el período y $300,00 en total.`,
    );
    await checkScreen(page);
  });
});
