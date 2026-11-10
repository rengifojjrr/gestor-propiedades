"use client";

import { Ellipsis } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@/components/ui";
import { NAV, isActive } from "./nav";
import { NavLink } from "./NavLink";

/**
 * «Más», en la barra inferior del celular: abre una hoja con las secciones que no caben en la barra.
 * Queda marcado cuando la pantalla actual es una de ellas.
 */
export function MoreMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const inside = NAV.more.some((item) => isActive(pathname, item.href));

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        data-active={inside || undefined}
        className={className}
      >
        <Ellipsis aria-hidden className="size-6" />
        Más
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Más" placement="bottom">
        <ul className="-mx-2 flex flex-col">
          {NAV.more.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <NavLink
                href={href}
                onClick={() => setOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-control px-2 text-ink hover:bg-sunken aria-[current=page]:bg-brand-soft aria-[current=page]:font-semibold"
              >
                <Icon aria-hidden className="size-5 text-ink-soft" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
