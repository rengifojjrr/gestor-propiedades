import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addDays, formatDate, todayNY, windowDayLabels } from "../src/lib/pasarelas/dates";
import { transitLabel } from "../src/lib/pasarelas/transit";
import type { ISODate } from "../src/lib/pasarelas/types";
import { e1Item, saveTransactions, signInAal1, type Db } from "../tests/integration/helpers";
import { expectNoHorizontalOverflow } from "./axe";
import { waitForStillToasts } from "./avisos";
import { expectNoSeriousAxe, login, newUser, type TestUser } from "./helpers";

/**
 * «Dinero en camino», arriba del Resumen, en el celular (390×844) y en el escritorio (1280×800), con un usuario
 * nuevo en cada uno. Cuatro cobros E1 de Escuela Demo por Stripe (neto 90,30, a la Cuenta principal …4321), con su
 * ventana estimada respecto de hoy:
 *  - T1: de hace 10 días, con fecha hace 4 días → «Debió llegar hace 4 días»;
 *  - T2: ventana de hoy a pasado mañana → «Hoy o hasta el …»;
 *  - T3: mañana (un solo día) → «Llega mañana»;
 *  - T4: ventana de dentro de 3 a dentro de 7 días → «Llega en 3–7 días».
 */

const ACCOUNT = "Cuenta principal (…4321)";

let user: TestUser;
let client: Db;
let today: ISODate;
const refs = { t1: "", t2: "", t3: "", t4: "" };
const ids: Record<keyof typeof refs, string> = { t1: "", t2: "", t3: "", t4: "" };
/** La ventana de cada caso. */
const windows = {} as Record<keyof typeof refs, { from: ISODate; to: ISODate }>;

test.beforeAll(async () => {
  user = await newUser();
  client = await signInAal1(user.email, user.password);
  today = todayNY(new Date());
  const tag = randomUUID().slice(0, 6);
  windows.t1 = { from: addDays(today, -4), to: addDays(today, -4) };
  windows.t2 = { from: today, to: addDays(today, 2) };
  windows.t3 = { from: addDays(today, 1), to: addDays(today, 1) };
  windows.t4 = { from: addDays(today, 3), to: addDays(today, 7) };
  const occurred = { t1: addDays(today, -10), t2: addDays(today, -3), t3: addDays(today, -3), t4: today };
  const keys = ["t1", "t2", "t3", "t4"] as const;
  for (const key of keys) refs[key] = `${key.toUpperCase()}-${tag}`;
  const saved = await saveTransactions(
    client,
    keys.map((key) =>
      e1Item(user.basics, {
        reference: refs[key],
        occurred_on: occurred[key],
        occurred_at: `${occurred[key]}T17:00:00+00:00`,
        estimated_deposit_from: windows[key].from === windows[key].to ? null : windows[key].from,
        estimated_deposit_on: windows[key].to,
      }),
    ),
  );
  keys.forEach((key, index) => {
    ids[key] = saved[index]?.id ?? "";
  });
});

async function checkScreen(page: Page): Promise<void> {
  await waitForStillToasts(page);
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousAxe(page);
}

const section = (page: Page): Locator => page.getByRole("region", { name: "Dinero en camino" });

/** Una tarjeta de «Dinero en camino» por su nombre. */
const card = (page: Page, name: string): Locator => section(page).getByRole("group", { name, exact: true });

/** El grupo de un caso: por su fecha (o su ventana) y su cuenta. */
function group(page: Page, key: keyof typeof refs): Locator {
  const [first, last] = windowDayLabels(windows[key]);
  const name = last === undefined ? formatDate(windows[key].to) : `Entre el ${first} y el ${last}`;
  return section(page).getByRole("article", { name: `${name} · ${ACCOUNT}` });
}

test("arriba del Resumen: las tarjetas, la fase de cada grupo y sus textos", async ({ page }) => {
  await login(page, user);
  await page.goto("/pasarelas");
  await expect(section(page)).toBeVisible();
  await expect(section(page)).toContainText("Ahora mismo, sin importar el período");
  await expect(section(page)).toContainText("La app no ve tu banco");

  // Va antes de las cifras del período.
  const transitTop = (await section(page).boundingBox())?.y ?? Infinity;
  const periodTop = (await page.getByRole("group", { name: "Bruto", exact: true }).boundingBox())?.y ?? -Infinity;
  expect(transitTop).toBeLessThan(periodTop);

  await expect(card(page, "Ya debió llegar")).toContainText("$90,30");
  await expect(card(page, "Ya debió llegar")).toContainText("1 cobro");
  await expect(card(page, "Puede llegar hoy")).toContainText("$90,30");
  await expect(card(page, "Próximos 7 días")).toContainText("$180,60");
  await expect(card(page, "Próximos 7 días")).toContainText("2 cobros");
  await expect(card(page, "Más adelante")).toContainText("$0,00");
  await expect(card(page, "Total en camino")).toContainText("$361,20");
  // Lo atrasado y el total llevan a la lista de cobros con ese filtro; las demás no son enlaces.
  await expect(card(page, "Ya debió llegar").getByRole("link")).toHaveAttribute("href", /estado=atrasado/);
  await expect(card(page, "Total en camino").getByRole("link", { name: "Ver 4 cobros" })).toHaveAttribute(
    "href",
    /estado=por_caer/,
  );
  await expect(card(page, "Puede llegar hoy").getByRole("link")).toHaveCount(0);

  // Por cuenta: todo va a la Cuenta principal, y de eso 90,30 ya debió llegar.
  const accounts = section(page).getByRole("list", { name: "Por cuenta destino" });
  await expect(accounts.getByRole("listitem").filter({ hasText: ACCOUNT })).toContainText("$361,20");
  await expect(accounts.getByRole("listitem").filter({ hasText: ACCOUNT })).toContainText("$90,30 ya debió llegar");

  // Los grupos: lo atrasado primero, cada uno con su fase.
  const groups = section(page).getByRole("article");
  await expect(groups).toHaveCount(4);
  await expect(groups.first()).toHaveAccessibleName(`${formatDate(windows.t1.to)} · ${ACCOUNT}`);
  await expect(group(page, "t1")).toContainText("Atrasado");
  await expect(group(page, "t1")).toContainText("Debió llegar hace 4 días");
  await expect(group(page, "t2")).toContainText(transitLabel(windows.t2, today));
  await expect(group(page, "t3")).toContainText("Llega mañana");
  await expect(group(page, "t4")).toContainText("Llega en 3–7 días");
  await checkScreen(page);
});

test("abrir un grupo muestra sus cobros uno por uno, con su fase, su barra y el enlace al cobro", async ({ page }) => {
  await login(page, user);
  await page.goto("/pasarelas");
  const late = group(page, "t1");
  await late.getByText("Ver el cobro", { exact: true }).click();
  const item = late.getByRole("listitem").filter({ hasText: refs.t1 });
  await expect(item).toBeVisible();
  await expect(item).toContainText("Escuela Demo · Stripe");
  await expect(item).toContainText("$90,30");
  await expect(item).toContainText("Debió llegar hace 4 días");
  await expect(item).toContainText(windowDayLabels(windows.t1)[0]);
  await expect(item.getByRole("link", { name: refs.t1 })).toHaveAttribute("href", `/pasarelas/cobros/${ids.t1}`);
  await checkScreen(page);

  const soon = group(page, "t4");
  await soon.getByText("Ver el cobro", { exact: true }).click();
  await expect(soon.getByRole("listitem").filter({ hasText: refs.t4 })).toContainText("Llega en 3–7 días");
  await checkScreen(page);
});

test("«Marcar depositado» de un grupo lo saca de «en camino» y lo suma a lo marcado en los últimos 30 días", async ({
  page,
}) => {
  await login(page, user);
  await page.goto("/pasarelas");
  const deposited = section(page).getByRole("list", { name: "Marcado depositado en los últimos 30 días" });
  await expect(section(page)).toContainText("Nada marcado depositado en los últimos 30 días");

  await group(page, "t1").getByRole("button", { name: "Marcar depositado" }).click();
  const dialog = page.getByRole("dialog", { name: "Marcar depositado" });
  await expect(dialog).toContainText("1 cobro");
  // Lo atrasado se propone con su fecha estimada, que ya pasó.
  await expect(dialog.getByLabel("Fecha del depósito")).toHaveValue(windows.t1.to);
  await checkScreen(page);
  await dialog.getByRole("button", { name: "Marcar depositado" }).click();

  await expect(page.getByText("1 cobro marcado como depositado")).toBeVisible();
  await expect(group(page, "t1")).toHaveCount(0);
  await expect(card(page, "Ya debió llegar")).toContainText("$0,00");
  await expect(card(page, "Total en camino")).toContainText("$270,90");
  await expect(deposited.getByRole("listitem").filter({ hasText: ACCOUNT })).toContainText("$90,30");
  await expect(section(page).getByTestId("depositado-total")).toHaveText("$90,30");
  await checkScreen(page);
});
