import type { ComponentProps } from "react";
import { cn } from "./cn";

/** Una hoja sobre el papel: agrupa lo que va junto. Sin sombra; la separa su raya. */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-rule bg-surface", className)} {...props} />;
}

/** Cabecera de la tarjeta: el título a la izquierda y, si hace falta, una acción a la derecha. */
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-rule px-4 py-3", className)}
      {...props}
    />
  );
}

export type CardTitleProps = ComponentProps<"h2"> & {
  /** Nivel del encabezado según dónde caiga la tarjeta en la página. */
  as?: "h2" | "h3";
};

export function CardTitle({ as: Heading = "h2", className, ...props }: CardTitleProps) {
  return <Heading className={cn("titulo text-lg leading-snug", className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...props} />;
}
