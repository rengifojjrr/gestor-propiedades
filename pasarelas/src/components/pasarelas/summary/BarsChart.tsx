"use client";

import { Bar, BarChart, CartesianGrid, LabelList, Tooltip, XAxis, YAxis } from "recharts";
import { dec, toMoney } from "@/lib/pasarelas/decimal";
import { formatMoney, formatPct } from "@/lib/pasarelas/money";
import type { Currency } from "@/lib/pasarelas/types";

/**
 * El dibujo de un gráfico de barras del Resumen (Recharts). Solo se carga en el navegador y después de la página
 * (`ChartFrame` lo pide con `next/dynamic`). Es una ilustración: va dentro de una zona `aria-hidden`; lo que lee
 * un lector de pantalla son el título, el resumen y la tabla de `ChartFrame`.
 *
 * Los valores llegan como texto (montos y porcentajes canónicos). Solo el LARGO de cada barra pasa por `number`;
 * todo lo que se lee (etiquetas, ejes, tooltip) sale del texto original con los formateadores del motor.
 * Los colores son tokens del kit (variables de CSS), que ya cambian solos con el modo oscuro.
 */

/** Los colores de serie que se pueden usar: tokens del kit, validados para que se distingan entre sí. */
const COLORS = { brand: "var(--color-brand)", info: "var(--color-info)" } as const;

export type BarsChartProps = {
  /** `columns`: barras verticales sobre un eje de tiempo (meses). `bars`: barras horizontales, una por fila. */
  layout: "columns" | "bars";
  /** Una fila por categoría; `values`, uno por serie, en el orden de `series`. */
  rows: { label: string; values: string[] }[];
  series: { name: string; color: keyof typeof COLORS }[];
  /** Cómo se escriben los valores: montos de una moneda o porcentajes. */
  format: { kind: "money"; currency: Currency } | { kind: "pct" };
};

type Datum = { label: string; raw: string[] } & Record<string, number | string | string[]>;

const key = (index: number): string => `s${index}`;

/** Los ejes y las líneas de la cuadrícula: discretos, en la tinta suave y la raya del kit. */
const AXIS = { fill: "var(--color-ink-soft)", fontSize: 12 };
const GRID = "var(--color-rule)";
/** El largo máximo de una etiqueta del eje de categorías (Recharts la parte en líneas); el nombre entero está en la tabla. */
const MAX_LABEL = 30;

function formatter(format: BarsChartProps["format"]): (value: string) => string {
  return format.kind === "money" ? (value) => formatMoney(value, format.currency) : (value) => formatPct(value);
}

/**
 * Una marca del eje de valores: sin los centavos ,00 ni el código de una moneda sin símbolo (el eje solo orienta;
 * la moneda la dice el resumen y la cifra exacta está en la tabla).
 */
function tickText(format: BarsChartProps["format"], tick: number): string {
  if (format.kind === "pct") return formatPct(String(tick));
  return formatMoney(toMoney(dec(String(tick))), format.currency)
    .replace(/,00(?= |$)/, "")
    .replace(/ [A-Z]{3}$/, "");
}

/** Un número de una prop de Recharts, que puede llegar como texto o faltar. */
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));

const shortLabel = (label: string): string => (label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label);

export default function BarsChart({ layout, rows, series, format }: BarsChartProps) {
  const write = formatter(format);
  const data: Datum[] = rows.map((row) => ({
    label: row.label,
    raw: row.values,
    ...Object.fromEntries(series.map((_, index) => [key(index), Number(row.values[index] ?? "0")])),
  }));
  const horizontal = layout === "bars";
  // Lugar a la derecha para la cifra más larga (unos 7 px por carácter a 12 px).
  const labelRoom = 12 + 7 * Math.max(0, ...rows.flatMap((row) => row.values.map((value) => write(value).length)));

  return (
    <div className="flex h-full flex-col gap-2">
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
          {series.map((item) => (
            <li key={item.name} className="flex items-center gap-1.5">
              <span className="size-3 rounded-stamp" style={{ backgroundColor: COLORS[item.color] }} />
              {item.name}
            </li>
          ))}
        </ul>
      ) : null}
      <BarChart
        responsive
        accessibilityLayer={false}
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={horizontal ? { top: 0, right: labelRoom, bottom: 0, left: 0 } : { top: 8, right: 8, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap={horizontal ? 8 : "24%"}
        style={{ width: "100%", flex: 1, minHeight: 0 }}
      >
        <CartesianGrid stroke={GRID} horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={124}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={shortLabel}
            />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
            <YAxis
              width={72}
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              tickFormatter={(tick: number) => tickText(format, tick)}
            />
          </>
        )}
        <Tooltip
          cursor={{ fill: "var(--color-sunken)" }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const datum = payload?.[0]?.payload as Datum | undefined;
            if (!active || !datum) return null;
            return (
              <div className="rounded-control border border-rule bg-surface px-3 py-2 text-sm text-ink shadow-raised">
                <p className="font-semibold">{datum.label}</p>
                {series.map((item, index) => (
                  <p key={item.name} className="cifra">
                    {series.length > 1 ? `${item.name}: ` : null}
                    {write(datum.raw[index] ?? "0")}
                  </p>
                ))}
              </div>
            );
          }}
        />
        {series.map((item, index) => (
          <Bar
            key={item.name}
            dataKey={key(index)}
            name={item.name}
            fill={COLORS[item.color]}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
            maxBarSize={horizontal ? 28 : 40}
            isAnimationActive={false}
          >
            {horizontal ? (
              <LabelList
                dataKey="raw"
                // Una sola línea, al final de la barra: Recharts partiría «2.300,00 MXN» en dos.
                content={({ x, y, width, height, value }) => (
                  <text
                    x={num(x) + Math.max(0, num(width)) + 6}
                    y={num(y) + num(height) / 2}
                    dominantBaseline="central"
                    fill="var(--color-ink)"
                    fontSize={12}
                  >
                    {Array.isArray(value) ? write(String(value[index] ?? "0")) : ""}
                  </text>
                )}
              />
            ) : null}
          </Bar>
        ))}
      </BarChart>
    </div>
  );
}
