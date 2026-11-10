"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button, cn } from "@/components/ui";

export type FiltersFoldProps = {
  /** Lo elegido, en una línea: «Este mes · USD · 1 filtro más» (`filterSummary`). */
  summary: string;
  /** Los filtros. */
  children: ReactNode;
};

/**
 * En el celular, los filtros van plegados tras un botón «Filtros» que resume lo elegido, para que las cifras se
 * vean sin desplazar. Desde 768 px el botón no está y los filtros se ven siempre. Lo plegado o abierto es solo de
 * esta pantalla: los filtros siguen en la URL, y al cambiar uno el panel sigue abierto.
 */
export function FiltersFold({ summary, children }: FiltersFoldProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Button
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="w-full md:hidden"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <SlidersHorizontal aria-hidden className="size-5 shrink-0" />
          <span className="shrink-0">Filtros</span>{" "}
          <span className="truncate font-normal text-ink-soft">{summary}</span>
        </span>
        <ChevronDown aria-hidden className={cn("size-5 shrink-0 transition-transform", open && "rotate-180")} />
      </Button>
      <div id={panelId} className={cn(open ? "block" : "hidden", "md:block")}>
        {children}
      </div>
    </div>
  );
}
