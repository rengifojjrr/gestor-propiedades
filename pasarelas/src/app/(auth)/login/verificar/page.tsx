import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui";
import { NEXT_PARAM, loginPath, safeNextPath } from "@/lib/auth/next-path";
import { getSession, getVerifiedFactors } from "@/lib/auth/session";
import { signOut } from "../actions";
import { VerifyForm } from "./VerifyForm";

export const metadata: Metadata = { title: "Código de verificación" };

/**
 * El segundo paso de la entrada: el código del segundo factor. Solo tiene sentido con sesión, con un factor
 * verificado y sin haber escrito el código todavía (aal1); en cualquier otro caso manda a donde toca.
 */
export default async function VerifyPage({ searchParams }: PageProps<"/login/verificar">) {
  const next = safeNextPath((await searchParams)[NEXT_PARAM]);
  const session = await getSession();
  if (!session) redirect(loginPath(next));

  const factors = await getVerifiedFactors();
  if (factors === null) {
    // El token todavía no caducó, pero Auth ya no reconoce la sesión: solo queda cerrarla aquí y volver a entrar.
    return (
      <>
        <h1 className="titulo text-2xl leading-tight">Tu sesión se cerró</h1>
        <p className="text-ink-soft">
          Se cerró desde otro dispositivo o cambió la contraseña. Vuelve a entrar para seguir.
        </p>
        <form action={signOut}>
          <Button type="submit" variant="primary" className="w-full">
            Volver a entrar
          </Button>
        </form>
      </>
    );
  }
  if (session.aal === "aal2" || factors.length === 0) redirect(next);

  return (
    <>
      <h1 className="titulo text-2xl leading-tight">Código de verificación</h1>
      <p className="text-ink-soft">Tu cuenta tiene segundo factor. Escribe el código para terminar de entrar.</p>
      <VerifyForm next={next} />
      <form action={signOut} className="flex flex-col gap-2 border-t border-rule pt-4">
        <p className="text-sm text-ink-soft">¿No tienes tu teléfono a mano o quieres entrar con otra cuenta?</p>
        <Button type="submit" className="self-start">
          Cerrar sesión
        </Button>
      </form>
    </>
  );
}
