import {
  Building2,
  CalendarDays,
  CreditCard,
  FileUp,
  Landmark,
  LayoutDashboard,
  Plus,
  ReceiptText,
  Settings,
  Split,
  Trash2,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/**
 * Todas las secciones de la app (spec §7 y §8). En celular, `main` y `register` van en la barra inferior
 * y `more` detrás de «Más»; en escritorio, la barra lateral las muestra todas.
 */
export const NAV: { main: readonly NavItem[]; register: NavItem; more: readonly NavItem[] } = {
  main: [
    { href: "/pasarelas", label: "Resumen", icon: LayoutDashboard },
    { href: "/pasarelas/cobros", label: "Cobros", icon: ReceiptText },
    { href: "/pasarelas/repartos", label: "Repartos", icon: Split },
  ],
  register: { href: "/pasarelas/registrar", label: "Registrar cobro", icon: Plus },
  more: [
    { href: "/pasarelas/empresas", label: "Empresas", icon: Building2 },
    { href: "/pasarelas/pasarelas", label: "Pasarelas", icon: CreditCard },
    { href: "/pasarelas/cuentas", label: "Cuentas destino", icon: Landmark },
    { href: "/pasarelas/importar", label: "Importar", icon: FileUp },
    { href: "/pasarelas/feriados", label: "Feriados", icon: CalendarDays },
    { href: "/pasarelas/papelera", label: "Papelera", icon: Trash2 },
    { href: "/ajustes", label: "Ajustes", icon: Settings },
  ],
};

/** El Resumen cuelga de la raíz del módulo: solo está activo en su ruta exacta. */
const EXACT_ONLY = "/pasarelas";

/** ¿La sección `href` es la de la ruta actual? (ella misma o una pantalla de adentro) */
export function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return href !== EXACT_ONLY && pathname.startsWith(`${href}/`);
}
