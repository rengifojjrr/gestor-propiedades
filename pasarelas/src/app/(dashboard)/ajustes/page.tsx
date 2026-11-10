import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { verifyPath } from "@/lib/auth/next-path";
import { getVerifiedFactors, requireSession } from "@/lib/auth/session";
import { SecurityCard } from "./SecurityCard";

export const metadata: Metadata = { title: "Ajustes" };

const HERE = "/ajustes";

/** Ajustes: la seguridad de la cuenta (segundo factor, contraseña y sesión). */
export default async function AjustesPage() {
  const session = await requireSession();
  const factors = await getVerifiedFactors();
  // Auth ya no reconoce la sesión (se cerró desde otro dispositivo): la pantalla del código lo explica.
  if (factors === null) redirect(verifyPath(HERE));

  return (
    <>
      <PageHeader title="Ajustes" />
      <SecurityCard email={session.email} factors={factors} />
    </>
  );
}
