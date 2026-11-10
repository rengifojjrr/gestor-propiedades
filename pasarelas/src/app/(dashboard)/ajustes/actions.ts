"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { TotpCode, WRONG_CODE } from "@/lib/auth/totp-code";
import { createClient } from "@/lib/supabase/server";

/*
 * Las acciones de Ajustes → Seguridad. Cada una es un POST público: exige la sesión y valida lo que recibe.
 * Con un segundo factor verificado, Supabase solo deja cambiar la contraseña, quitar un factor o agregar otro a una
 * sesión que escribió el código (aal2); si no lo es, responde `insufficient_aal` y aquí se dice con claridad.
 */

const NEEDS_CODE =
  "Para esto tienes que haber entrado con el código del segundo factor. Cierra sesión, vuelve a entrar con tu código e inténtalo de nuevo.";

/** El nombre con el que se guarda cada dispositivo. Supabase no admite dos factores con el mismo nombre. */
const FACTOR_NAME = "Autenticador";

/** La misma longitud mínima que exige Auth (`minimum_password_length` en supabase/config.toml). */
const MIN_PASSWORD_LENGTH = 10;
/** El tope de Auth: más allá, bcrypt ya no distingue una contraseña de otra. */
const MAX_PASSWORD_LENGTH = 72;

export type EnrollmentStart =
  | { ok: true; factorId: string; /** `data:image/svg+xml…`, para un `<img>`. */ qrCode: string; secret: string }
  | { ok: false; error: string };

/** Empieza a activar un dispositivo: devuelve el QR y la clave. El factor no cuenta hasta verificar un código. */
export async function startEnrollment(): Promise<EnrollmentStart> {
  await requireSession();
  const supabase = await createClient();
  const failed: EnrollmentStart = { ok: false, error: "No se pudo empezar la activación. Inténtalo de nuevo." };

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return failed;

  // Un intento que quedó sin verificar ocupa su nombre y haría fallar el siguiente: se quita antes de empezar.
  for (const factor of factors.all) {
    if (factor.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const taken = new Set(factors.totp.map((factor) => factor.friendly_name));
  let friendlyName = FACTOR_NAME;
  for (let n = 2; taken.has(friendlyName); n += 1) friendlyName = `${FACTOR_NAME} ${n}`;

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName, issuer: "Pasarelas" });
  if (error) return error.code === "insufficient_aal" ? { ok: false, error: NEEDS_CODE } : failed;
  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

const Confirmation = z.object({ factorId: z.uuid(), code: TotpCode });

/** Verifica el primer código del dispositivo nuevo: desde ahí el factor cuenta y la sesión queda en aal2. */
export async function confirmEnrollment(formData: FormData): Promise<ActionResult> {
  await requireSession();
  const input = Confirmation.safeParse({ factorId: formData.get("factorId"), code: formData.get("code") });
  if (!input.success) return { ok: false, error: WRONG_CODE };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify(input.data);
  if (error) {
    if (error.code === "mfa_verification_failed") return { ok: false, error: WRONG_CODE };
    if (error.code === "insufficient_aal") return { ok: false, error: NEEDS_CODE };
    return { ok: false, error: "No se pudo activar. Cancela y empieza de nuevo." };
  }
  // El aviso del marco está en todas las pantallas.
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Quita un dispositivo. Si era el último, la cuenta vuelve a abrirse solo con la contraseña. */
export async function removeFactor(factorId: string): Promise<ActionResult> {
  await requireSession();
  const id = z.uuid().safeParse(factorId);
  if (!id.success) return { ok: false, error: "Ese dispositivo ya no existe." };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: id.data });
  if (error) {
    return { ok: false, error: error.code === "insufficient_aal" ? NEEDS_CODE : "No se pudo quitar. Inténtalo de nuevo." };
  }
  // El token sigue diciendo aal2 hasta renovarlo. Renovado dice la verdad: aal1 si no queda ningún factor, y también
  // si el que se quitó era el de esta sesión aunque queden otros (entonces la siguiente pantalla pide su código).
  await supabase.auth.refreshSession();
  revalidatePath("/", "layout");
  return { ok: true };
}

const NewPassword = z
  .object({
    current: z.string().min(1, { error: "Escribe tu contraseña actual." }),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, { error: `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.` })
      .max(MAX_PASSWORD_LENGTH, { error: `Usa como mucho ${MAX_PASSWORD_LENGTH} caracteres.` }),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    error: "Las dos contraseñas nuevas no coinciden.",
  });

type PasswordField = "current" | "password" | "confirm";

export type PasswordResult =
  | { ok: true }
  | { ok: false; error?: string; fieldErrors?: Partial<Record<PasswordField, string>> };

/** Cambia la contraseña. Auth exige la actual (`require_current_password`) y cierra las demás sesiones. */
export async function changePassword(formData: FormData): Promise<PasswordResult> {
  await requireSession();
  const input = NewPassword.safeParse({
    current: formData.get("current"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!input.success) {
    const errors = z.flattenError(input.error).fieldErrors;
    return {
      ok: false,
      fieldErrors: { current: errors.current?.[0], password: errors.password?.[0], confirm: errors.confirm?.[0] },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: input.data.password,
    current_password: input.data.current,
  });
  if (!error) return { ok: true };

  switch (error.code) {
    case "current_password_invalid":
    case "current_password_required":
      return { ok: false, fieldErrors: { current: "La contraseña actual no es correcta." } };
    case "same_password":
      return { ok: false, fieldErrors: { password: "La contraseña nueva tiene que ser distinta de la actual." } };
    case "weak_password":
      return { ok: false, fieldErrors: { password: `Esa contraseña es muy débil. Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.` } };
    case "insufficient_aal":
      return { ok: false, error: NEEDS_CODE };
    default:
      return { ok: false, error: "No se pudo cambiar la contraseña. Inténtalo de nuevo." };
  }
}
