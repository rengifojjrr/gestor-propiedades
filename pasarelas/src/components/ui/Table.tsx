import type { ComponentProps } from "react";
import { cn } from "./cn";

export type TableProps = ComponentProps<"table"> & {
  /** De qué es la tabla: nombra la zona, que se desplaza hacia los lados si la tabla no cabe. */
  label: string;
};

/** Tabla con rayas de libro. Si no cabe a lo ancho se desplaza ella, no la página. */
export function Table({ label, className, ...props }: TableProps) {
  return (
    // La zona se puede enfocar para poder desplazarla con el teclado.
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-card border border-rule bg-surface"
    >
      <table className={cn("w-full border-collapse text-left", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("bg-sunken text-sm text-ink-soft", className)} {...props} />;
}

export function TBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-rule", className)} {...props} />;
}

export type TrProps = ComponentProps<"tr"> & {
  /** Fila de total: raya de suma arriba y doble raya bajo cada cifra, como en un libro contable. */
  total?: boolean;
};

export function Tr({ total, className, ...props }: TrProps) {
  return (
    <tr
      data-total={total || undefined}
      className={cn("group/row", total && "border-t-2 border-ink font-semibold", className)}
      {...props}
    />
  );
}

type CellProps = {
  /** Columna de cifras: a la derecha y con números tabulares. */
  numeric?: boolean;
};

export type ThProps = ComponentProps<"th"> & CellProps;

/** Encabezado de columna (`scope="col"`, el valor por defecto) o de fila (`scope="row"`). */
export function Th({ numeric, scope = "col", className, ...props }: ThProps) {
  return (
    <th
      scope={scope}
      className={cn(
        "px-3 py-2.5",
        scope === "col" ? "font-semibold whitespace-nowrap" : "[font-weight:inherit]",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export type TdProps = ComponentProps<"td"> & CellProps;

export function Td({ numeric, className, children, ...props }: TdProps) {
  return (
    <td
      className={cn("px-3 py-3 align-top", numeric && "cifra text-right whitespace-nowrap", className)}
      {...props}
    >
      {numeric ? <span className="group-data-total/row:doble-raya">{children}</span> : children}
    </td>
  );
}
