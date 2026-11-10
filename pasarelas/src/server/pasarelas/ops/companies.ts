import "server-only";
import type { Currency, Money, Pct } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";
import { RECEIPTS_BUCKET, storedFile } from "./receipts";
import { emptyFolder } from "./transactions";

/**
 * Las escrituras de la pantalla Empresas: la empresa (su ficha, su logo, activa o no), sus canales de venta y las
 * cuentas de cada pasarela en ella. Reciben el cliente con la sesión del usuario: la RLS decide qué puede tocar, y
 * lo que no es suyo se comporta como si no existiera.
 *
 * El logo es un archivo del bucket privado, en la carpeta `{usuario}/{empresa}/`: lo sube el navegador y aquí se
 * comprueba y se guarda su ruta. La base no puede borrar archivos: el anterior se borra al cambiarlo o quitarlo, y
 * todos los de la carpeta antes de borrar la empresa.
 */

const COMPANY_NOT_FOUND = "Esa empresa ya no existe.";
const CHANNEL_NOT_FOUND = "Ese canal ya no existe.";
const GATEWAY_NOT_FOUND = "Esa pasarela ya no está en esta empresa.";
const IN_USE = "Tiene cobros: desactívala en su lugar";
const REPEATED_GATEWAY = "Esa pasarela ya está en esta empresa";
const LOGO_FILES_FAILED = "No se pudo borrar el logo de la empresa. La empresa sigue ahí: inténtalo de nuevo.";

/** La restricción `unique (company_id, gateway_id)` de `pay_company_gateways` (el nombre que le da Postgres). */
const COMPANY_GATEWAY_UNIQUE = "pay_company_gateways_company_id_gateway_id_key";

/** Lo que un logo puede ser: una imagen que el navegador pinta con un `<img>`. */
const LOGO_MIMES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp"]);

export type CompanyInput = {
  /** Con `id` se edita esa empresa; sin él se crea una. */
  id?: string;
  name: string;
  website: string | null;
  currency: Currency;
  defaultSchemeId: string | null;
  notes: string | null;
};

export type ChannelInput = {
  /** Con `id` se edita ese canal de esa empresa; sin él se crea uno. */
  id?: string;
  companyId: string;
  name: string;
  url: string | null;
  platformFeePct: Pct;
  platformFeeFixed: Money;
  active: boolean;
};

export type CompanyGatewayInput = {
  /** Con `id` se edita esa cuenta de esa empresa; sin él se agrega una. */
  id?: string;
  companyId: string;
  gatewayId: string;
  dashboardUrl: string | null;
  checkoutUrl: string | null;
  bankAccountId: string | null;
  /** Días propios de esta empresa (0–60); `null` = los de la pasarela. */
  payoutDaysOverride: number | null;
  /** Las opciones encendidas por defecto en esta empresa; `null` = las que la pasarela trae encendidas. */
  defaultExtraIds: string[] | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** ¿La base rechazó porque algo (un cobro) todavía apunta a la fila que se quería borrar? */
const isReferenced = (error: unknown): boolean => isRecord(error) && error.code === "23503";

/** ¿La base rechazó porque esa pasarela ya está en esa empresa? */
function isRepeatedGateway(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.code === "23505" &&
    typeof error.message === "string" &&
    error.message.includes(COMPANY_GATEWAY_UNIQUE)
  );
}

/** Corre una escritura y traduce el rechazo por `match` a un `UserError` con `message`. Lo demás lo deja pasar. */
async function translating<T>(write: () => PromiseLike<T>, match: (error: unknown) => boolean, message: string) {
  try {
    return await write();
  } catch (error) {
    if (match(error)) throw new UserError(message);
    throw error;
  }
}

/** Si la escritura no alcanzó ninguna fila (no existe, o es de otro usuario), un error para la persona. */
function expectOne(rows: readonly unknown[], message: string): void {
  if (rows.length === 0) throw new UserError(message);
}

// ─── La empresa ─────────────────────────────────────────────────────────────────────────────────────────────

/** Crea o edita una empresa y devuelve su id. */
export async function saveCompany(supabase: Db, input: CompanyInput): Promise<string> {
  const row = {
    name: input.name,
    website: input.website,
    currency: input.currency,
    default_scheme_id: input.defaultSchemeId,
    notes: input.notes,
  };
  if (input.id === undefined) {
    const { data } = await supabase.from("pay_companies").insert(row).select("id").single().throwOnError();
    return data.id;
  }
  const { data } = await supabase.from("pay_companies").update(row).eq("id", input.id).select("id").throwOnError();
  expectOne(data, COMPANY_NOT_FOUND);
  return input.id;
}

/** Activa o desactiva una empresa. Una inactiva no se ofrece al registrar, pero sus cobros siguen contando. */
export async function setCompanyActive(supabase: Db, id: string, active: boolean): Promise<void> {
  const { data } = await supabase.from("pay_companies").update({ active }).eq("id", id).select("id").throwOnError();
  expectOne(data, COMPANY_NOT_FOUND);
}

/** La empresa con ese id, si es del usuario de la sesión: su dueño y su logo. */
async function companyOf(supabase: Db, userId: string, id: string): Promise<{ logoPath: string | null }> {
  const { data } = await supabase
    .from("pay_companies")
    .select("user_id, logo_path")
    .eq("id", id)
    .maybeSingle()
    .throwOnError();
  if (data === null) throw new UserError(COMPANY_NOT_FOUND);
  if (data.user_id !== userId) throw new Error("companyOf: el usuario indicado no es el dueño de la empresa");
  return { logoPath: data.logo_path };
}

/**
 * Borra una empresa que no tiene cobros, con sus canales y sus cuentas de pasarela (en cascada). Antes borra los
 * archivos de su carpeta de logo: después de borrar la fila nadie los vería. Si tiene cobros, aunque estén en la
 * papelera, no se borra nada: se desactiva en su lugar.
 */
export async function deleteCompany(supabase: Db, userId: string, id: string): Promise<void> {
  await companyOf(supabase, userId, id);
  // Se mira antes de tocar Storage: una empresa con cobros conserva su logo.
  const { data: used } = await supabase
    .from("pay_transactions")
    .select("id")
    .eq("company_id", id)
    .limit(1)
    .throwOnError();
  if (used.length > 0) throw new UserError(IN_USE);
  await emptyFolder(supabase, `${userId}/${id}`, LOGO_FILES_FAILED);
  const { data } = await translating(
    () => supabase.from("pay_companies").delete().eq("id", id).select("id").throwOnError(),
    isReferenced,
    IN_USE,
  );
  expectOne(data, COMPANY_NOT_FOUND);
}

// ─── El logo ────────────────────────────────────────────────────────────────────────────────────────────────

/** Borra un archivo y comprueba que se fue: Storage no da error cuando no borra, dice qué borró. */
async function removeFile(supabase: Db, path: string, message: string): Promise<void> {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path]);
  if (error) throw error;
  // Si no borró nada y el archivo sigue ahí, no se pudo. Si ya no estaba, no hay nada que borrar.
  if (data.length === 0 && (await storedFile(supabase, path)) !== null) throw new UserError(message);
}

/**
 * Pone (`path`) o quita (`null`) el logo de una empresa. La ruta tiene que ser un archivo de la carpeta de esa
 * empresa del usuario de la sesión (`{userId}/{companyId}/…`) que de verdad esté en Storage y sea una imagen JPG,
 * PNG o WebP según Storage (no según lo que declare el navegador); si no es una imagen, se borra y se rechaza.
 *
 * El archivo anterior se borra ANTES de cambiar la fila (como un comprobante): al revés, un fallo dejaría un
 * archivo que ya nadie ve. Si no se puede borrar, no cambia nada.
 */
export async function setCompanyLogo(
  supabase: Db,
  userId: string,
  a: { companyId: string; path: string | null },
): Promise<void> {
  const { logoPath } = await companyOf(supabase, userId, a.companyId);
  if (a.path !== null) {
    const folder = `${userId}/${a.companyId}/`;
    const name = a.path.startsWith(folder) ? a.path.slice(folder.length) : "";
    if (name === "" || name.includes("/")) throw new UserError("El logo no corresponde a esa empresa.");
    const stored = await storedFile(supabase, a.path);
    if (stored === null) throw new UserError("El archivo no llegó a subirse. Vuelve a intentarlo.");
    if (!LOGO_MIMES.has(stored.mime) || stored.sizeBytes <= 0) {
      // Lo que no se admite no se queda en Storage. Si no se puede borrar, se rechaza igual.
      await supabase.storage.from(RECEIPTS_BUCKET).remove([a.path]);
      throw new UserError("El logo tiene que ser una imagen JPG, PNG o WebP.");
    }
  }
  if (logoPath !== null && logoPath !== a.path) {
    await removeFile(supabase, logoPath, "No se pudo borrar el logo anterior. Inténtalo de nuevo.");
  }
  const { data } = await supabase
    .from("pay_companies")
    .update({ logo_path: a.path })
    .eq("id", a.companyId)
    .select("id")
    .throwOnError();
  expectOne(data, COMPANY_NOT_FOUND);
}

// ─── Los canales ────────────────────────────────────────────────────────────────────────────────────────────

/** Crea o edita un canal de una empresa y devuelve su id. Editar no lo cambia de empresa. */
export async function saveChannel(supabase: Db, input: ChannelInput): Promise<string> {
  const row = {
    name: input.name,
    url: input.url,
    platform_fee_pct: input.platformFeePct,
    platform_fee_fixed: input.platformFeeFixed,
    active: input.active,
  };
  if (input.id === undefined) {
    const { data } = await supabase
      .from("pay_channels")
      .insert({ ...row, company_id: input.companyId })
      .select("id")
      .single()
      .throwOnError();
    return data.id;
  }
  const { data } = await supabase
    .from("pay_channels")
    .update(row)
    .eq("id", input.id)
    .eq("company_id", input.companyId)
    .select("id")
    .throwOnError();
  expectOne(data, CHANNEL_NOT_FOUND);
  return input.id;
}

/** Borra un canal sin cobros. Uno con cobros no se borra: se desactiva en su lugar. */
export async function deleteChannel(supabase: Db, id: string): Promise<void> {
  const { data } = await translating(
    () => supabase.from("pay_channels").delete().eq("id", id).select("id").throwOnError(),
    isReferenced,
    IN_USE,
  );
  expectOne(data, CHANNEL_NOT_FOUND);
}

// ─── Las cuentas de pasarela de la empresa ──────────────────────────────────────────────────────────────────

/** Comprueba que cada opción elegida es de esa pasarela (la base no lo puede comprobar dentro de una lista). */
async function checkExtras(supabase: Db, gatewayId: string, extraIds: string[] | null): Promise<void> {
  const wanted = [...new Set(extraIds ?? [])];
  if (wanted.length === 0) return;
  const { data } = await supabase
    .from("pay_gateway_extras")
    .select("id")
    .eq("gateway_id", gatewayId)
    .in("id", wanted)
    .throwOnError();
  if (data.length !== wanted.length) throw new UserError("Alguna de las opciones elegidas no es de esa pasarela.");
}

/**
 * Agrega o edita la cuenta de una pasarela en una empresa (sus links, su cuenta destino, sus días y sus opciones
 * por defecto) y devuelve su id. Una pasarela va una sola vez por empresa.
 */
export async function saveCompanyGateway(supabase: Db, input: CompanyGatewayInput): Promise<string> {
  await checkExtras(supabase, input.gatewayId, input.defaultExtraIds);
  const row = {
    gateway_id: input.gatewayId,
    dashboard_url: input.dashboardUrl,
    checkout_url: input.checkoutUrl,
    bank_account_id: input.bankAccountId,
    payout_days_override: input.payoutDaysOverride,
    default_extra_ids: input.defaultExtraIds === null ? null : [...new Set(input.defaultExtraIds)],
  };
  if (input.id === undefined) {
    const { data } = await translating(
      () =>
        supabase
          .from("pay_company_gateways")
          .insert({ ...row, company_id: input.companyId })
          .select("id")
          .single()
          .throwOnError(),
      isRepeatedGateway,
      REPEATED_GATEWAY,
    );
    return data.id;
  }
  const id = input.id;
  const { data } = await translating(
    () =>
      supabase
        .from("pay_company_gateways")
        .update(row)
        .eq("id", id)
        .eq("company_id", input.companyId)
        .select("id")
        .throwOnError(),
    isRepeatedGateway,
    REPEATED_GATEWAY,
  );
  expectOne(data, GATEWAY_NOT_FOUND);
  return id;
}

/** Quita una pasarela de una empresa. Los cobros no apuntan a esta cuenta: los ya registrados no cambian. */
export async function deleteCompanyGateway(supabase: Db, id: string): Promise<void> {
  const { data } = await supabase.from("pay_company_gateways").delete().eq("id", id).select("id").throwOnError();
  expectOne(data, GATEWAY_NOT_FOUND);
}
