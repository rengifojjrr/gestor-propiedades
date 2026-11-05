/**
 * «Ingresos vs. gastos»: barras agrupadas por mes (verde = ingresos, rojo = gastos), con leyenda,
 * tooltip por mes y una tabla para lectores de pantalla. Colores de los tokens (useTokenColors).
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps, type XAxisTickContentProps } from 'recharts';
import { formatMoney, formatMoneyCompact } from '@/lib/money';
import type { SeriesPoint } from '@/services';
import { cn, useTokenColors } from '@/ui';

/**
 * En modo oscuro los dos tokens son pasteles claros y se confunden con daltonismo (deuteranopía):
 * las barras de ingresos bajan su opacidad para separarse por luminosidad (validado con el
 * verificador de paletas: ΔE 18 en CVD, contraste ≥ 3:1).
 */
const DARK_INCOME_OPACITY = 0.58;

function ChartTooltip({ active, payload, currency }: Partial<TooltipContentProps<number, string>> & { currency: string }) {
  const point = payload?.[0]?.payload as SeriesPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-outline-variant bg-surface-lowest px-3 py-2 text-body-sm shadow-pop">
      <p className="mb-1 text-label-sm text-on-surface-variant uppercase">{point.label}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-3 rounded-full bg-secondary" aria-hidden />
        <span className="tabular font-semibold text-on-surface">{formatMoney(point.income, currency)}</span>
        <span className="text-on-surface-variant">ingresos</span>
      </p>
      <p className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-3 rounded-full bg-error" aria-hidden />
        <span className="tabular font-semibold text-on-surface">{formatMoney(point.expenses, currency)}</span>
        <span className="text-on-surface-variant">gastos</span>
      </p>
      <p className="mt-1 border-t border-outline-variant/60 pt-1 text-on-surface-variant">
        Neto <span className="tabular font-semibold text-on-surface">{formatMoney(point.net, currency)}</span>
      </p>
    </div>
  );
}

export function ChartLegend({ dark }: { dark: boolean }) {
  return (
    <div className="flex items-center gap-4 text-label-sm text-on-surface-variant" aria-hidden>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-secondary" style={{ opacity: dark ? DARK_INCOME_OPACITY : 1 }} />
        Ingresos
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm bg-error" />
        Gastos
      </span>
    </div>
  );
}

export function useIsDark(): boolean {
  // useTokenColors vuelve a pintar al cambiar la clase .dark, así que leerla aquí está al día.
  useTokenColors();
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

export function CashflowChart({ data, currency, selected, className }: { data: SeriesPoint[]; currency: string; selected?: string; className?: string }) {
  const c = useTokenColors();
  const dark = useIsDark();
  const first = data[0]?.label;
  const last = data[data.length - 1]?.label;
  return (
    <div className={className}>
      <div className="h-64 w-full" role="img" aria-label={`Ingresos y gastos por mes, de ${first} a ${last}. Detalle en la tabla.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="24%" margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke={c['outline-variant']} strokeOpacity={0.7} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: c['outline-variant'] }}
              tick={({ x, y, payload }: XAxisTickContentProps) => {
                const isSelected = data[payload.index]?.month === selected;
                return (
                  <text x={x} y={Number(y) + 14} textAnchor="middle" fontSize={12} fontWeight={isSelected ? 800 : 600} fill={isSelected ? c.primary : c['on-surface-variant']}>
                    {String(payload.value).replace('.', '').toUpperCase()}
                  </text>
                );
              }}
            />
            <YAxis
              width={52}
              tickLine={false}
              axisLine={false}
              tick={{ fill: c['on-surface-variant'], fontSize: 12 }}
              tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
            />
            <Tooltip cursor={{ fill: c['surface-container'], opacity: 0.7 }} content={(props) => <ChartTooltip {...(props as TooltipContentProps<number, string>)} currency={currency} />} />
            <Bar dataKey="income" name="Ingresos" fill={c.secondary} fillOpacity={dark ? DARK_INCOME_OPACITY : 1} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Bar dataKey="expenses" name="Gastos" fill={c.error} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Ingresos y gastos por mes ({currency})</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Ingresos</th>
            <th scope="col">Gastos</th>
            <th scope="col">Neto</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.month}>
              <th scope="row">{p.label}</th>
              <td>{formatMoney(p.income, currency)}</td>
              <td>{formatMoney(p.expenses, currency)}</td>
              <td>{formatMoney(p.net, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Anillo de margen de ganancia (como el de Stitch). */
export function MarginRing({ margin, className }: { margin: number; className?: string }) {
  const r = 68;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, margin));
  return (
    <div className={cn('relative h-40 w-40', className)}>
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="80" cy="80" r={r} fill="none" stroke="currentColor" strokeWidth="12" className="text-surface-container" />
        {pct > 0 && (
          <circle
            cx="80"
            cy="80"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - pct)}
            className="text-secondary transition-[stroke-dashoffset] duration-700"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-headline-xl text-primary">{Math.round(margin * 100)}%</span>
        <span className="text-label-sm text-on-surface-variant uppercase">Margen</span>
      </div>
    </div>
  );
}
