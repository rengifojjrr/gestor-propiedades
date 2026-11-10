"use client";

import { ChevronDown } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, type ReactNode } from "react";
import { Skeleton, cn } from "@/components/ui";
import type { BarsChartProps } from "./BarsChart";

/** El dibujo (Recharts) se pide aparte, solo en el navegador y sin frenar la página. */
const BarsChart = dynamic(() => import("./BarsChart"), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

/** El alto del dibujo: fijo para las columnas por mes; las barras horizontales crecen con las filas (~40 px c/u). */
function heightOf({ layout, rows }: BarsChartProps): string {
  if (layout === "columns") return "h-60";
  if (rows.length <= 2) return "h-24";
  if (rows.length <= 4) return "h-40";
  if (rows.length <= 7) return "h-64";
  return "h-96";
}

export type ChartFrameProps = {
  /** El título del gráfico: también su nombre accesible. */
  title: string;
  /** Lo que el gráfico dice, en una o dos frases: se lee sin ver el dibujo. */
  summary: ReactNode;
  /** Los mismos datos en una tabla, para quien no ve el gráfico o quiere las cifras exactas. */
  table: ReactNode;
  chart: BarsChartProps;
  className?: string;
};

/**
 * Un gráfico del Resumen: título, resumen en texto, el dibujo (decorativo para el lector de pantalla) y la tabla
 * con los mismos datos, plegada bajo «Ver los datos en una tabla». Nada se sale del ancho: el dibujo se ajusta y
 * la tabla se desplaza dentro de su zona.
 */
export function ChartFrame({ title, summary, table, chart, className }: ChartFrameProps) {
  const titleId = useId();
  const summaryId = useId();
  return (
    <figure
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      className={cn("flex min-w-0 flex-col gap-3 rounded-card border border-rule bg-surface p-4", className)}
    >
      <figcaption className="flex flex-col gap-1">
        <h3 id={titleId} className="titulo text-lg leading-snug">
          {title}
        </h3>
        <p id={summaryId} className="text-ink-soft">
          {summary}
        </p>
      </figcaption>
      <div aria-hidden className={cn("w-full min-w-0", heightOf(chart))}>
        <BarsChart {...chart} />
      </div>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-brand [&::-webkit-details-marker]:hidden">
          <ChevronDown aria-hidden className="size-5 transition-transform group-open:rotate-180" />
          Ver los datos en una tabla
        </summary>
        <div className="pt-2">{table}</div>
      </details>
    </figure>
  );
}
