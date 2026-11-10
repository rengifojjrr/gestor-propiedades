import { NAV } from "./nav";
import { NavLink } from "./NavLink";

/**
 * El «＋» de la barra inferior: el botón fijo «Registrar cobro», a mano desde cualquier pantalla.
 * Sobresale de la barra para que sea lo primero que encuentra el pulgar.
 */
export function RegisterFab() {
  const { href, label, icon: Icon } = NAV.register;
  return (
    <NavLink
      href={href}
      aria-label={label}
      className="flex size-14 -translate-y-3 items-center justify-center rounded-full bg-brand text-on-brand shadow-raised outline-offset-4 hover:bg-brand-strong active:bg-brand-strong"
    >
      <Icon aria-hidden className="size-7" strokeWidth={2.5} />
    </NavLink>
  );
}
