import { AppShell, MfaBanner } from "@/components/shell";
import { getSession } from "@/lib/auth/session";

/**
 * El marco de las pantallas de la app. Lee la sesión solo para pintar el aviso del segundo factor.
 * Un layout no protege nada por sí solo: cada pantalla y cada acción llaman a `requireSession()`.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  return (
    <AppShell>
      {session && !session.hasFactor ? <MfaBanner /> : null}
      {children}
    </AppShell>
  );
}
