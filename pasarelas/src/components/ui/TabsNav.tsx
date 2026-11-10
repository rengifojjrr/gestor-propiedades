import Link from "next/link";
import { cn } from "./cn";

export type TabsNavProps = {
  /** Qué agrupan las pestañas («Secciones de Repartos»): nombra la navegación. */
  label: string;
  items: readonly { href: string; label: string }[];
  /** El `href` de la pestaña que se está viendo (lo decide la página). */
  current: string;
  className?: string;
};

/** Pestañas que son enlaces: cada una es una URL (una ruta o un `?vista=`), así se puede compartir y volver. */
export function TabsNav({ label, items, current, className }: TabsNavProps) {
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex gap-1 overflow-x-auto border-b border-rule">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 min-w-11 items-center justify-center border-b-[3px] px-3 whitespace-nowrap",
                  active
                    ? "border-brand font-semibold text-ink"
                    : "border-transparent text-ink-soft hover:border-rule-strong hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
