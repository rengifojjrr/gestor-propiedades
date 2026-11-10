import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import sharp from "sharp";
import { todayNY } from "@/lib/pasarelas";
import { trashTx } from "@/server/pasarelas/ops/transactions";
import { adminClient, createUser, totp, unwrap, type Db } from "../tests/integration/helpers";
import { seedDemo } from "./demo-data";

/**
 * Las capturas de `docs/capturas/`: cada pantalla en el celular (390×844, escala 2; lo que se ve al abrirla), en
 * claro, con el libro de la semilla demo; el Resumen, también en oscuro. Contra un servidor que ya esté corriendo
 * con el stack LOCAL:
 *
 *   npm run build && npm run start                  (en producción no aparece el indicador de desarrollo)
 *   npx tsx --conditions=react-server --env-file-if-exists=.env.local scripts/capturas.ts [http://127.0.0.1:3000]
 *
 * Crea un usuario de usar y tirar (`prueba-…@example.com`) con la semilla demo y el segundo factor activo, como
 * lo tendrá el dueño (así tampoco sale el aviso de activarlo), y lo borra al terminar. Todo lo que se ve es
 * inventado; la entrada y el código se capturan vacíos. Las imágenes van en WebP con el `sharp` que ya instala
 * Next: sin dependencias nuevas.
 */

const OUT_DIR = path.join(__dirname, "..", "docs", "capturas");
const WEBP_QUALITY = 80;
/** Lo que tarda en quedarse quieto lo que se anima al cargar (los gráficos del Resumen, los avisos). */
const SETTLE_MS = 1500;

type Shot = { file: string; path: string; heading: string | RegExp };

/** Los registros de la semilla que tienen pantalla propia. */
type Ids = { tx: string; company: string; gateway: string; scheme: string; beneficiary: string };

function lightShots(ids: Ids): Shot[] {
  return [
    { file: "01-resumen", path: "/pasarelas", heading: "Resumen" },
    { file: "02-registrar", path: "/pasarelas/registrar", heading: "Registrar cobro" },
    { file: "03-cobros", path: "/pasarelas/cobros", heading: "Cobros" },
    { file: "04-cobro-detalle", path: `/pasarelas/cobros/${ids.tx}`, heading: /^Cobro de / },
    { file: "05-cobro-editar", path: `/pasarelas/cobros/${ids.tx}/editar`, heading: "Editar cobro" },
    { file: "06-papelera", path: "/pasarelas/papelera", heading: "Papelera" },
    { file: "07-empresas", path: "/pasarelas/empresas", heading: "Empresas" },
    { file: "08-empresa-nueva", path: "/pasarelas/empresas/nueva", heading: "Nueva empresa" },
    { file: "09-empresa", path: `/pasarelas/empresas/${ids.company}`, heading: "Tienda Demo" },
    { file: "10-pasarelas", path: "/pasarelas/pasarelas", heading: "Pasarelas" },
    { file: "11-pasarela-nueva", path: "/pasarelas/pasarelas/nueva", heading: "Agregar pasarela" },
    { file: "12-pasarela", path: `/pasarelas/pasarelas/${ids.gateway}`, heading: "Stripe" },
    { file: "13-repartos", path: "/pasarelas/repartos", heading: "Repartos" },
    { file: "14-esquema-nuevo", path: "/pasarelas/repartos/esquemas/nuevo", heading: "Nuevo esquema" },
    { file: "15-esquema", path: `/pasarelas/repartos/esquemas/${ids.scheme}`, heading: "Reparto 50/30/20" },
    { file: "16-beneficiario", path: `/pasarelas/repartos/beneficiarios/${ids.beneficiary}`, heading: "Grupo A" },
    { file: "17-cuentas", path: "/pasarelas/cuentas", heading: "Cuentas destino" },
    { file: "18-feriados", path: "/pasarelas/feriados", heading: "Feriados" },
    { file: "19-importar", path: "/pasarelas/importar", heading: "Importar CSV" },
    { file: "20-ajustes", path: "/ajustes", heading: "Ajustes" },
  ];
}

const DARK_SHOTS: Shot[] = [{ file: "01-resumen-oscuro", path: "/pasarelas", heading: "Resumen" }];

/** Crea un usuario con la clave secreta: solo contra el stack local. */
function assertLocalStack(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL. Corre `npm run db:start` (escribe .env.local).");
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Las capturas solo se sacan contra el stack local, no contra ${host}.`);
  }
}

async function idByName(
  client: Db,
  table: "pay_companies" | "pay_gateways" | "pay_schemes" | "pay_beneficiaries",
  name: string,
): Promise<string> {
  return unwrap(await client.from(table).select("id").eq("name", name).single(), `${table} «${name}»`).id;
}

/** Siembra el libro demo y manda a la papelera el cobro más viejo (para que no salga vacía). */
async function seedBook(client: Db): Promise<Ids> {
  await seedDemo(client, { today: todayNY(new Date()) });
  const [recent] = unwrap(
    await client
      .from("pay_transactions")
      .select("id")
      .not("scheme_id", "is", null)
      .neq("status", "fallido")
      .order("occurred_at", { ascending: false })
      .limit(1),
    "el cobro más reciente con reparto",
  );
  const [oldest] = unwrap(
    await client.from("pay_transactions").select("id").order("occurred_at").limit(1),
    "el cobro más viejo",
  );
  if (!recent || !oldest) throw new Error("La semilla no dejó cobros");
  await trashTx(client, [oldest.id]);
  return {
    tx: recent.id,
    company: await idByName(client, "pay_companies", "Tienda Demo"),
    gateway: await idByName(client, "pay_gateways", "Stripe"),
    scheme: await idByName(client, "pay_schemes", "Reparto 50/30/20"),
    beneficiary: await idByName(client, "pay_beneficiaries", "Grupo A"),
  };
}

/**
 * Activa el segundo factor con un nombre de dispositivo inventado (sale en Ajustes) y devuelve su secreto, para
 * generar los códigos al entrar. La sesión de `client` queda con el código: ya no la usa nadie.
 */
async function enrollPhone(client: Db): Promise<string> {
  const enrolled = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Teléfono demo" });
  if (enrolled.error) throw enrolled.error;
  const { id, totp: factor } = enrolled.data;
  const verified = await client.auth.mfa.challengeAndVerify({ factorId: id, code: totp(factor.secret) });
  if (verified.error) throw verified.error;
  return factor.secret;
}

/** Espera a que la pantalla se quede quieta y guarda lo que se ve en WebP. */
async function capture(page: Page, file: string, heading: string | RegExp): Promise<void> {
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(SETTLE_MS);
  const png = await page.screenshot({ type: "png" });
  const info = await sharp(png)
    .webp({ quality: WEBP_QUALITY })
    .toFile(path.join(OUT_DIR, `${file}.webp`));
  console.log(`  ${file}.webp  ${Math.round(info.size / 1024)} KB`);
}

async function main(): Promise<void> {
  assertLocalStack();
  const baseURL = process.argv[2] ?? "http://127.0.0.1:3000";
  // Lo primero: un fallo antes de crear el usuario no deja nada que borrar.
  // Los controles nativos (fecha y hora, archivo) no siguen el `locale` del contexto sino el idioma del navegador:
  // sin esto salen «11/09/2026, 06:18 PM» y «Choose File». El Chromium completo (no el de solo pruebas) lo toma de
  // `LANGUAGE` en Linux y de `--lang` en Windows.
  const browser = await chromium.launch({
    channel: "chromium",
    args: ["--lang=es-ES"],
    env: { ...process.env, LANG: "es_ES.UTF-8", LANGUAGE: "es" },
  });
  let ownerId: string | null = null;
  try {
    const owner = await createUser();
    ownerId = owner.id;
    const ids = await seedBook(owner.client);
    // Después de sembrar: con el factor activo, una sesión sin el código ya no puede escribir.
    const secret = await enrollPhone(owner.client);

    await mkdir(OUT_DIR, { recursive: true });
    for (const old of await readdir(OUT_DIR)) if (old.endsWith(".webp")) await rm(path.join(OUT_DIR, old));
    console.log(`Capturas en ${OUT_DIR}:`);

    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "es-ES",
      timezoneId: "America/New_York",
      colorScheme: "light",
    });
    const page = await context.newPage();

    // La entrada y el código, vacíos; después se entra de verdad.
    await page.goto("/login");
    await capture(page, "21-entrar", "Entrar");
    await page.getByLabel("Correo").fill(owner.email);
    await page.getByLabel("Contraseña").fill(owner.password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await capture(page, "22-codigo", "Código de verificación");
    await page.getByLabel("Código").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));

    for (const shot of lightShots(ids)) {
      await page.goto(shot.path);
      await capture(page, shot.file, shot.heading);
    }
    await page.emulateMedia({ colorScheme: "dark" });
    for (const shot of DARK_SHOTS) {
      await page.goto(shot.path);
      await capture(page, shot.file, shot.heading);
    }
  } finally {
    await browser.close();
    if (ownerId !== null) {
      const { error } = await adminClient().auth.admin.deleteUser(ownerId);
      if (error) console.error(`No se pudo borrar el usuario de las capturas (${ownerId}): ${error.message}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error("Las capturas fallaron:", error);
  process.exitCode = 1;
});
