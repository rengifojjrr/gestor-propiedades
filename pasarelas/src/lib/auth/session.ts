import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loginPath, verifyPath } from "./next-path";

/**
 * La sesión verificada de la petición. Es la barrera de cada pantalla y de cada Server Action
 * (`requireSession()`); el proxy solo redirige pronto y un layout no protege nada.
 *
 * Esto existe para no enseñar pantallas vacías: quien de verdad defiende los datos es la RLS de la base, que
 * exige aal2 a quien tiene un segundo factor.
 */
export type Session = {
  userId: string;
  email: string;
  /** `aal2` = entró con contraseña y con el código del segundo factor. */
  aal: "aal1" | "aal2";
  /** Tiene un segundo factor (TOTP) verificado. Con `aal1` y sin poder saberlo, se asume que sí. */
  hasFactor: boolean;
};

/** Un segundo factor (TOTP) ya verificado, como lo lista Ajustes. */
export type VerifiedFactor = { id: string; name: string; createdAt: string };

/**
 * Los factores TOTP verificados del usuario, preguntados al servicio de Auth (una vez por petición).
 * Devuelve `null` si Auth no los da: la sesión ya no existe (se cerró desde otro dispositivo, o cambió la
 * contraseña) aunque su token todavía no haya caducado, o Auth no responde.
 */
export const getVerifiedFactors = cache(async (): Promise<VerifiedFactor[] | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return null;
  return data.totp.map((factor) => ({
    id: factor.id,
    name: factor.friendly_name ?? "Autenticador",
    createdAt: factor.created_at,
  }));
});

/**
 * La sesión de quien hace la petición, o `null` si no hay. Una vez por petición (`cache` de React).
 *
 * Usa `getClaims()`, que verifica la firma del token; `getSession()` de Supabase y
 * `mfa.getAuthenticatorAssuranceLevel()` leen la cookie sin verificarla y no sirven para autorizar.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return null;

  const who = { userId: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
  // Solo se llega a aal2 verificando un factor: no hace falta preguntar.
  if (claims.aal === "aal2") return { ...who, aal: "aal2", hasFactor: true };

  // Si Auth no dice qué factores hay, se pide el código igual: ante la duda, cerrado.
  const factors = await getVerifiedFactors();
  return { ...who, aal: "aal1", hasFactor: factors === null || factors.length > 0 };
});

/**
 * Exige una sesión que pueda ver datos. Sin sesión manda a la entrada; con segundo factor pero sin haber
 * escrito el código (aal1), a `/login/verificar`. Sin factor, la sesión vale (y el marco avisa que lo active).
 *
 * `redirect()` lanza: no llamar dentro de un `try`.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(loginPath());
  if (session.aal !== "aal2" && session.hasFactor) redirect(verifyPath());
  return session;
}
