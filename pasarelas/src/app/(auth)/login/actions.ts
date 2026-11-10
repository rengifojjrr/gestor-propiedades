"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { NEXT_PARAM, loginPath, safeNextPath, verifyPath } from "@/lib/auth/next-path";
import { getSession, getVerifiedFactors } from "@/lib/auth/session";
import { TotpCode, WRONG_CODE } from "@/lib/auth/totp-code";
import { createClient } from "@/lib/supabase/server";

/*
 * Las acciones de la entrada: entrar, escribir el código del segundo factor y cerrar sesión.
 * Cada una es un POST público: valida lo que recibe y no confía en lo que la pantalla ya comprobó.
 */

/** El mismo mensaje si falla el correo o la contraseña: no se dice cuál, ni si la cuenta existe. */
const BAD_CREDENTIALS = "Correo o contraseña incorrectos.";
const SIGN_IN_FAILED = "No se pudo entrar. Inténtalo de nuevo en un momento.";
const VERIFY_FAILED = "No se pudo comprobar el código. Inténtalo de nuevo en un momento.";

const Credentials = z.object({
  email: z.string().trim().max(320).pipe(z.email()),
  password: z.string().min(1).max(1024),
});

export type SignInState = {
  error?: string;
  /** El correo que se escribió, para no tener que escribirlo otra vez. La contraseña nunca vuelve. */
  email?: string;
};

/** Entra con correo y contraseña. Si la cuenta tiene segundo factor, sigue en la pantalla del código. */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const typed = formData.get("email");
  const email = typeof typed === "string" ? typed.trim() : "";
  const next = safeNextPath(formData.get(NEXT_PARAM));
  const credentials = Credentials.safeParse({ email, password: formData.get("password") });
  if (!credentials.success) return { error: BAD_CREDENTIALS, email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(credentials.data);
  if (error) return { error: error.code === "invalid_credentials" ? BAD_CREDENTIALS : SIGN_IN_FAILED, email };

  // Los factores vienen en la respuesta de Auth a esta misma entrada, no de la cookie.
  const hasFactor = data.user.factors?.some((factor) => factor.factor_type === "totp" && factor.status === "verified");
  revalidatePath("/", "layout");
  redirect(hasFactor ? verifyPath(next) : next);
}

export type VerifyState = { error?: string };

/** Comprueba el código del segundo factor y sube la sesión a aal2. */
export async function verifyCode(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const next = safeNextPath(formData.get(NEXT_PARAM));
  const session = await getSession();
  if (!session) redirect(loginPath(next));
  const factors = await getVerifiedFactors();
  // Sin nada que comprobar (ya se escribió el código, la sesión se cerró o la cuenta no tiene segundo factor),
  // la pantalla decide a dónde se va.
  if (session.aal === "aal2" || !factors || factors.length === 0) redirect(verifyPath(next));

  const code = TotpCode.safeParse(formData.get("code"));
  if (!code.success) return { error: WRONG_CODE };

  // El código no dice de qué dispositivo salió: se prueba con cada uno de los registrados.
  const supabase = await createClient();
  let failure = WRONG_CODE;
  for (const factor of factors) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.data });
    if (!error) {
      revalidatePath("/", "layout");
      redirect(next);
    }
    if (error.code !== "mfa_verification_failed") failure = VERIFY_FAILED;
  }
  return { error: failure };
}

/**
 * Cierra la sesión: la de este dispositivo o, con `scope=global`, la de todos.
 * No exige sesión: sin ella no hay nada que cerrar, y solo toca la cookie de quien llama.
 */
export async function signOut(formData: FormData): Promise<void> {
  const scope = formData.get("scope") === "global" ? "global" : "local";
  const supabase = await createClient();
  // Si Auth ya no conoce la sesión (se cerró desde otro dispositivo), la cookie se borra igual.
  await supabase.auth.signOut({ scope });
  revalidatePath("/", "layout");
  redirect(loginPath());
}
