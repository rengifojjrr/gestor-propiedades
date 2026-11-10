import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui";
import { MoreMenu } from "./MoreMenu";
import { NAV, type NavItem } from "./nav";
import { NavLink } from "./NavLink";
import { RegisterFab } from "./RegisterFab";

/** Un ítem de la barra inferior: ícono sobre texto, y una raya arriba cuando es la sección actual. */
const BAR_ITEM =
  "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 border-t-[3px] border-transparent text-[0.8125rem] leading-tight text-ink-soft -outline-offset-2 aria-[current=page]:border-brand aria-[current=page]:font-semibold aria-[current=page]:text-ink data-active:border-brand data-active:font-semibold data-active:text-ink";

/** Un ítem de la barra lateral: ícono y texto en fila. */
const SIDE_ITEM =
  "flex min-h-11 items-center gap-3 rounded-control px-3 text-ink-soft hover:bg-sunken hover:text-ink aria-[current=page]:bg-brand-soft aria-[current=page]:font-semibold aria-[current=page]:text-ink";

function BarLink({ href, label, icon: Icon }: NavItem) {
  return (
    <NavLink href={href} className={BAR_ITEM}>
      <Icon aria-hidden className="size-6" />
      {label}
    </NavLink>
  );
}

/** En la barra inferior el «＋» va en el medio: delante de él, la primera mitad de las secciones principales. */
const BAR_ITEMS_BEFORE_FAB = Math.ceil(NAV.main.length / 2);

function SideLinks({ items }: { items: readonly NavItem[] }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <NavLink href={href} className={SIDE_ITEM}>
            <Icon aria-hidden className="size-5" />
            {label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * El marco de la app. En el celular: barra inferior fija con Resumen · Cobros · ＋ · Repartos · Más.
 * Desde 768 px: barra lateral con todas las secciones. El contenido de cada pantalla va en `<main>`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh md:pl-60">
      <a
        href="#contenido"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-30 focus-visible:flex focus-visible:min-h-11 focus-visible:items-center focus-visible:rounded-control focus-visible:bg-surface focus-visible:px-4 focus-visible:font-semibold focus-visible:text-brand focus-visible:shadow-raised"
      >
        Saltar al contenido
      </a>

      <nav
        aria-label="Principal"
        className="fixed inset-y-0 left-0 z-10 hidden w-60 flex-col gap-6 overflow-y-auto border-r border-rule bg-surface p-4 md:flex"
      >
        <p className="titulo px-3 pt-1 text-xl">Pasarelas</p>
        <ButtonLink href={NAV.register.href} variant="primary">
          <NAV.register.icon aria-hidden className="size-5" />
          {NAV.register.label}
        </ButtonLink>
        <SideLinks items={NAV.main} />
        <div className="flex flex-col gap-1">
          <p className="px-3 text-sm text-ink-soft">
            Más
          </p>
          <SideLinks items={NAV.more} />
        </div>
      </nav>

      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 pt-5 pb-28 outline-none md:px-8 md:pt-8 md:pb-12">
        {children}
      </main>

      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-surface pb-[env(safe-area-inset-bottom)] shadow-raised md:hidden"
      >
        <ul className="-mt-px grid auto-cols-fr grid-flow-col items-end">
          {NAV.main.slice(0, BAR_ITEMS_BEFORE_FAB).map((item) => (
            <li key={item.href}>
              <BarLink {...item} />
            </li>
          ))}
          <li className="flex justify-center">
            <RegisterFab />
          </li>
          {NAV.main.slice(BAR_ITEMS_BEFORE_FAB).map((item) => (
            <li key={item.href}>
              <BarLink {...item} />
            </li>
          ))}
          <li>
            <MoreMenu className={BAR_ITEM} />
          </li>
        </ul>
      </nav>
    </div>
  );
}
