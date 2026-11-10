import { AppShell } from "@/components/shell";

/**
 * El marco de las pantallas de la app. Todavía no comprueba la sesión: eso llega con la entrada y el
 * segundo factor. Un layout no protege nada por sí solo; cada pantalla y cada acción verifican la suya.
 */
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
