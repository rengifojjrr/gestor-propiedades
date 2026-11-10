"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { ButtonLink } from "./Button";
import { cn } from "./cn";
import { PAGE_PARAM, hrefWith } from "./url";

export type PaginationProps = {
  /** La página que se está viendo (empieza en 1). */
  page: number;
  /** Filas por página. */
  pageSize: number;
  /** Filas en total, con el filtro aplicado. */
  total: number;
  /** Nombre del parámetro de la URL. */
  param?: string;
  className?: string;
};

/**
 * Paginación en la URL: «Anterior» y «Siguiente» son enlaces que conservan los filtros. Si todo cabe en
 * una página no se muestra. Usa `useSearchParams()`: va dentro de `<Suspense>`.
 */
export function Pagination({ page, pageSize, total, param = PAGE_PARAM, className }: PaginationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages === 1) return null;

  const hrefOf = (target: number) =>
    hrefWith(pathname, searchParams, { [param]: target === 1 ? null : String(target) }, param);

  return (
    <nav aria-label="Paginación" className={cn("flex items-center justify-between gap-3", className)}>
      <span className="flex flex-1 justify-start">
        {page > 1 ? (
          <ButtonLink href={hrefOf(page - 1)} rel="prev">
            <ChevronLeft aria-hidden className="size-5" />
            Anterior
          </ButtonLink>
        ) : null}
      </span>
      <p className="cifra whitespace-nowrap text-ink-soft">
        {/* En el celular no cabe la palabra entre los dos botones: queda solo para el lector de pantalla. */}
        <span className="sr-only sm:not-sr-only">Página </span>
        {page} de {pages}
      </p>
      <span className="flex flex-1 justify-end">
        {page < pages ? (
          <ButtonLink href={hrefOf(page + 1)} rel="next">
            Siguiente
            <ChevronRight aria-hidden className="size-5" />
          </ButtonLink>
        ) : null}
      </span>
    </nav>
  );
}
