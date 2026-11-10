import type { Metadata } from "next";
import { NEXT_PARAM, safeNextPath } from "@/lib/auth/next-path";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar" };

/**
 * La entrada: correo y contraseña. No hay registro: la cuenta del dueño se crea desde el panel de Supabase.
 * Quien ya tiene sesión no llega aquí (el proxy lo manda al Resumen).
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNextPath((await searchParams)[NEXT_PARAM]);
  return (
    <>
      <h1 className="titulo text-2xl leading-tight">Entrar</h1>
      <LoginForm next={next} />
      <p className="text-sm text-ink-soft">¿Olvidaste tu contraseña? Se restablece desde el panel de Supabase.</p>
    </>
  );
}
