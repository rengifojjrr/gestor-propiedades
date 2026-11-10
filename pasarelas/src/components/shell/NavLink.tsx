"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { isActive } from "./nav";

export type NavLinkProps = Omit<ComponentProps<typeof Link>, "href" | "aria-current"> & { href: string };

/**
 * Enlace de navegación que sabe si lleva a la sección actual: entonces lleva `aria-current="page"`.
 * El aspecto de «activo» se da con clases `aria-[current=page]:…`.
 */
export function NavLink({ href, ...props }: NavLinkProps) {
  const pathname = usePathname();
  return <Link href={href} aria-current={isActive(pathname, href) ? "page" : undefined} {...props} />;
}
