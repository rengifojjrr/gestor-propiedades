/** Bloques de la pantalla de Finanzas (estilo «Financial Overview» de Stitch). */
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronRight, MinusCircle, PlusCircle, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';
import { Link } from 'react-router';
import { RENTAL_MODE_LABEL } from '@/domain/labels';
import type { Photo } from '@/domain/types';
import { addMonthsToKey, monthLabel } from '@/lib/dates';
import { formatMoney, formatMoneyCompact, formatPercent } from '@/lib/money';
import type { MonthSummary, PortfolioKpis, PropertyKpis, RoiResult, TransactionView } from '@/services';

type CategoryAmount = MonthSummary['expensesByCategory'][number];
import { Badge, Button, Card, CardHeader, cn, EmptyState, Eyebrow, LinkButton, ProgressBar, PropertyImage, type Tone } from '@/ui';
import { MarginRing } from './CashflowChart';
import { relativeChange, TxRow } from './shared';

export type PerformanceRow = PropertyKpis & { roi: RoiResult | null; photo?: Photo };

/** Agrega ?mes= a una ruta de finanzas (si no es el mes en curso). */
export function withMonth(path: string, month: string, current: string): string {
  return month === current ? path : `${path}?mes=${month}`;
}

function Delta({ value, previousLabel, goodWhenUp = true, dark }: { value: number | null; previousLabel: string; goodWhenUp?: boolean; dark?: boolean }) {
  if (value == null)
    return <span className={cn('text-label-sm font-normal', dark ? 'text-on-primary-container-muted' : 'text-on-surface-variant')}>Sin datos de {previousLabel}</span>;
  const up = value >= 0;
  const good = up === goodWhenUp;
  const text = `${up ? '+' : ''}${formatPercent(value, Math.abs(value) < 0.1 ? 1 : 0)}`;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn('rounded-sm px-2 py-0.5 text-label-sm', good ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container')}>{text}</span>
      <span className={cn('text-label-sm font-normal', dark ? 'text-on-primary-container-muted' : 'text-on-surface-variant')}>vs. {previousLabel.toLowerCase()}</span>
    </span>
  );
}

/** Ganancia neta (tarjeta marina), ingresos y gastos. */
export function HeroCards({ summary, isCurrent }: { summary: MonthSummary; isCurrent: boolean }) {
  const base = summary.baseCurrency;
  const prevLabel = monthLabel(addMonthsToKey(summary.month, -1)).split(' ')[0];
  const incomeDiff = summary.income - summary.previous.income;
  const budgetUse = summary.budget ? summary.expenses / summary.budget : null;
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card tone="dark" padding="lg" className="relative flex min-h-44 flex-col justify-between overflow-hidden md:col-span-2">
        <div className="relative z-10">
          <p className="text-label-sm tracking-widest text-on-primary-container-muted uppercase">Ganancia neta · {summary.label}</p>
          <p data-testid="ganancia-neta-finanzas" className="mt-2 text-[40px] leading-tight font-extrabold tracking-tight md:text-[48px]">
            {formatMoney(summary.net, base, { whole: true })}
          </p>
        </div>
        <div className="relative z-10 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Delta value={relativeChange(summary.net, summary.previous.net)} previousLabel={prevLabel} dark />
          {isCurrent && <span className="text-label-sm font-normal text-on-primary-container-muted">Mes en curso: lo registrado hasta hoy.</span>}
        </div>
        <Wallet className="pointer-events-none absolute -right-5 -bottom-6 h-36 w-36 opacity-10" aria-hidden />
      </Card>

      <Card padding="lg">
        <div className="mb-4 flex items-center justify-between">
          <Eyebrow>Ingresos</Eyebrow>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/10 text-secondary">
            <TrendingUp size={20} aria-hidden />
          </span>
        </div>
        <p className="text-headline-lg text-primary">{formatMoney(summary.income, base, { whole: true })}</p>
        <p className={cn('mt-2 flex items-center gap-1 text-label-sm', incomeDiff >= 0 ? 'text-secondary' : 'text-error')}>
          {incomeDiff >= 0 ? <ArrowUp size={14} aria-hidden /> : <ArrowDown size={14} aria-hidden />}
          {formatMoneyCompact(Math.abs(incomeDiff), base)} {incomeDiff >= 0 ? 'más' : 'menos'} que {prevLabel.toLowerCase()}
        </p>
      </Card>

      <Card padding="lg">
        <div className="mb-4 flex items-center justify-between">
          <Eyebrow>Gastos</Eyebrow>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-error/10 text-error">
            <TrendingDown size={20} aria-hidden />
          </span>
        </div>
        <p className="text-headline-lg text-primary">{formatMoney(summary.expenses, base, { whole: true })}</p>
        {summary.overBudget ? (
          <p className="mt-2 flex items-center gap-1 text-label-sm text-error" data-testid="sobre-presupuesto">
            <AlertTriangle size={14} aria-hidden /> Sobre el presupuesto ({formatMoney(summary.budget ?? 0, base, { whole: true })})
          </p>
        ) : budgetUse != null ? (
          <div className="mt-2">
            <ProgressBar value={budgetUse} tone={budgetUse > 0.85 ? 'warn' : 'info'} label="Presupuesto usado" />
            <p className="mt-1.5 text-label-sm font-normal text-on-surface-variant">
              {formatPercent(budgetUse)} del presupuesto ({formatMoney(summary.budget ?? 0, base, { whole: true })})
            </p>
          </div>
        ) : (
          <p className="mt-2 text-label-sm font-normal text-on-surface-variant">Sin presupuesto para este mes.</p>
        )}
        {summary.pendingApproval > 0 && (
          <p className="mt-2 text-label-sm text-on-warning-container">+ {formatMoney(summary.pendingApproval, base)} por aprobar (no suma todavía)</p>
        )}
      </Card>
    </div>
  );
}

/** Anillo de margen con los botones de registrar (propietario y administración). */
export function MarginCard({ summary, canWrite, onRecord }: { summary: MonthSummary; canWrite: boolean; onRecord: (t: 'income' | 'expense') => void }) {
  const m = summary.margin;
  const text =
    summary.income === 0
      ? 'Todavía no hay ingresos registrados este mes.'
      : m >= 0.35
        ? 'Margen alto: el portafolio rinde muy bien este mes.'
        : m >= 0.1
          ? 'Margen estable este mes.'
          : m >= 0
            ? 'Margen bajo: revisa los gastos del mes.'
            : 'Este mes los gastos superan a los ingresos.';
  return (
    <Card padding="lg" className="flex flex-col items-center justify-center text-center">
      <MarginRing margin={m} className="mb-5" />
      <p className="mb-5 max-w-xs text-body-sm text-on-surface-variant">{text}</p>
      {canWrite ? (
        <div className="flex w-full flex-col gap-3">
          <Button icon={PlusCircle} fullWidth onClick={() => onRecord('income')} data-testid="registrar-ingreso">
            Registrar ingreso
          </Button>
          <Button variant="secondary" icon={MinusCircle} fullWidth onClick={() => onRecord('expense')} data-testid="registrar-gasto">
            Registrar gasto
          </Button>
        </div>
      ) : (
        <p className="text-label-sm font-normal text-on-surface-variant">Solo lectura: registran el propietario y Administración.</p>
      )}
    </Card>
  );
}

/** Gastos que esperan la aprobación del propietario. */
export function PendingApprovalsCard({ items, base, onApprove, onReject, busyId }: { items: TransactionView[]; base: string; onApprove: (t: TransactionView) => void; onReject: (t: TransactionView) => void; busyId?: string | null }) {
  const total = items.reduce((s, t) => s + t.amountBase, 0);
  return (
    <Card padding="lg" accent="warn" as="section" aria-label="Gastos por aprobar" data-testid="gastos-por-aprobar">
      <CardHeader title="Gastos por aprobar" subtitle={`${items.length} ${items.length === 1 ? 'gasto espera' : 'gastos esperan'} tu visto bueno · ${formatMoney(total, base)}. No suman hasta que los apruebes.`} />
      <ul className="divide-y divide-outline-variant/50">
        {items.map((t) => (
          <TxRow
            key={t.id}
            tx={t}
            base={base}
            actions={
              <>
                <Button size="sm" variant="success" icon={Check} loading={busyId === t.id} onClick={() => onApprove(t)} data-testid={`aprobar-${t.id}`}>
                  Aprobar
                </Button>
                <Button size="sm" variant="ghost" icon={X} disabled={busyId === t.id} onClick={() => onReject(t)}>
                  Rechazar
                </Button>
              </>
            }
          />
        ))}
      </ul>
    </Card>
  );
}

const YIELD_TONE: Record<PropertyKpis['yieldLabel'], Tone> = { 'Alto rendimiento': 'good', Estable: 'info', 'Bajo rendimiento': 'bad' };

function YieldBadge({ label }: { label: PropertyKpis['yieldLabel'] }) {
  return (
    <Badge tone={YIELD_TONE[label]} upper className="text-[10px] tracking-wider">
      {label}
    </Badge>
  );
}

const pct = (v: number) => formatPercent(v);
const money = (v: number | null, currency: string) => (v == null ? '—' : formatMoney(v, currency, { whole: true }));

/** Desempeño por propiedad: tabla en computadora, tarjetas en el teléfono. */
export function PerformanceSection({ rows, base, showRoi }: { rows: PerformanceRow[]; base: string; showRoi: boolean }) {
  return (
    <Card padding="none" as="section" aria-label="Desempeño por propiedad" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant/40 px-5 py-4 md:px-6">
        <div>
          <h2 className="text-headline-md text-primary">Desempeño por propiedad</h2>
          <p className="text-body-sm text-on-surface-variant">Ingresos, gastos y neto en {base}; ADR y RevPAR en la moneda de cada propiedad.</p>
        </div>
        <Link to="/propiedades" className="inline-flex items-center gap-1 text-label-md text-secondary hover:underline">
          Ver propiedades <ChevronRight size={16} aria-hidden />
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="p-5">
          <EmptyState title="Sin propiedades para mostrar" />
        </div>
      ) : (
        <>
          {/* Teléfono y tableta */}
          <ul className="divide-y divide-outline-variant/40 lg:hidden">
            {rows.map((r) => (
              <li key={r.propertyId} className="px-5 py-4">
                <Link to={`/propiedades/${r.propertyId}`} className="flex items-center gap-3">
                  <PropertyImage photo={r.photo} src={r.heroSrc} alt="" className="h-12 w-12 shrink-0 rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label-md text-primary">{r.propertyName}</span>
                    <span className="block truncate text-body-sm text-on-surface-variant">
                      {r.city} · {RENTAL_MODE_LABEL[r.rentalMode]}
                    </span>
                  </span>
                  <YieldBadge label={r.yieldLabel} />
                </Link>
                <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-body-sm">
                  <Metric label="Ocupación" value={pct(r.occupancy)} />
                  <Metric label="ADR" value={money(r.adr, r.currency)} />
                  <Metric label="RevPAR" value={money(r.revpar, r.currency)} />
                  <Metric label="Ingresos" value={money(r.income, base)} />
                  <Metric label="Gastos" value={money(r.expenses, base)} />
                  <Metric label="Neto" value={money(r.net, base)} strong />
                  {showRoi && <Metric label="ROI (12 meses)" value={r.roi ? formatPercent(r.roi.roi, 1) : '—'} />}
                </dl>
              </li>
            ))}
          </ul>
          {/* Computadora */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left text-body-sm">
              <thead className="bg-surface-low text-[12px] font-bold tracking-wider text-on-surface-variant uppercase">
                <tr>
                  <th scope="col" className="px-5 py-3">
                    Propiedad
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Rendimiento
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Ocupación
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    ADR
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    RevPAR
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Ingresos
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    Gastos
                  </th>
                  <th scope="col" className={cn('py-3 pl-3 text-right', showRoi ? 'pr-3' : 'pr-5')}>
                    Neto
                  </th>
                  {showRoi && (
                    <th scope="col" className="py-3 pr-5 pl-3 text-right" title="Ganancia neta anualizada de los últimos 12 meses sobre el precio de compra">
                      ROI
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {rows.map((r) => (
                  <tr key={r.propertyId} className="transition-colors hover:bg-surface-low/60">
                    <td className="px-5 py-3">
                      <Link to={`/propiedades/${r.propertyId}`} className="flex items-center gap-3">
                        <PropertyImage photo={r.photo} src={r.heroSrc} alt="" className="h-11 w-11 shrink-0 rounded-md" />
                        <span className="min-w-0">
                          <span className="block max-w-52 truncate text-label-md text-primary">{r.propertyName}</span>
                          <span className="block text-label-sm font-normal text-on-surface-variant">
                            {r.city} · {RENTAL_MODE_LABEL[r.rentalMode]}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <YieldBadge label={r.yieldLabel} />
                    </td>
                    <td className="tabular px-3 py-3 text-right text-on-surface">{pct(r.occupancy)}</td>
                    <td className="tabular px-3 py-3 text-right text-on-surface">{money(r.adr, r.currency)}</td>
                    <td className="tabular px-3 py-3 text-right text-on-surface">{money(r.revpar, r.currency)}</td>
                    <td className="tabular px-3 py-3 text-right text-on-surface">{money(r.income, base)}</td>
                    <td className="tabular px-3 py-3 text-right text-on-surface">{money(r.expenses, base)}</td>
                    <td className={cn('tabular py-3 pl-3 text-right font-bold text-primary', showRoi ? 'pr-3' : 'pr-5')}>{money(r.net, base)}</td>
                    {showRoi && <td className="tabular py-3 pr-5 pl-3 text-right text-on-surface">{r.roi ? formatPercent(r.roi.roi, 1) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showRoi && (
            <p className="border-t border-outline-variant/40 px-5 py-3 text-label-sm font-normal text-on-surface-variant md:px-6">
              ROI: ganancia neta anualizada de los últimos 12 meses sobre el precio de compra (dato privado del propietario).
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-sm font-normal text-on-surface-variant">{label}</dt>
      <dd className={cn('tabular truncate', strong ? 'font-bold text-primary' : 'text-on-surface')}>{value}</dd>
    </div>
  );
}

/** Ocupación, ADR y RevPAR del portafolio. */
export function PortfolioKpisCard({ kpis, base }: { kpis: PortfolioKpis; base: string }) {
  return (
    <Card padding="lg" as="section" aria-label="Indicadores del portafolio">
      <CardHeader title="Indicadores del portafolio" subtitle="Ocupación «en libros»: incluye las reservas confirmadas que faltan en el mes." />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 rounded-md bg-surface-low p-4">
          <div className="flex items-baseline justify-between gap-3">
            <Eyebrow>Ocupación promedio</Eyebrow>
            <span className="text-headline-lg text-primary">{formatPercent(kpis.occupancy)}</span>
          </div>
          <ProgressBar value={kpis.occupancy} tone="good" className="mt-3" label="Ocupación promedio" />
        </div>
        <div className="rounded-md bg-surface-low p-4">
          <Eyebrow>ADR</Eyebrow>
          <p className="mt-1 text-headline-md text-primary">{formatMoney(kpis.adr, base, { whole: true })}</p>
          <p className="text-label-sm font-normal text-on-surface-variant">Tarifa promedio por noche vendida</p>
        </div>
        <div className="rounded-md bg-surface-low p-4">
          <Eyebrow>RevPAR</Eyebrow>
          <p className="mt-1 text-headline-md text-primary">{formatMoney(kpis.revpar, base, { whole: true })}</p>
          <p className="text-label-sm font-normal text-on-surface-variant">Ingreso por noche disponible</p>
        </div>
        <div className="col-span-2 rounded-md bg-surface-low p-4">
          <Eyebrow>Noches vendidas</Eyebrow>
          <p className="mt-1 text-headline-md text-primary">
            {kpis.nightsSold} <span className="text-body-md font-normal text-on-surface-variant">de {kpis.availableNights} disponibles</span>
          </p>
          <p className="text-label-sm font-normal text-on-surface-variant">ADR y RevPAR: solo propiedades por noches y mixtas.</p>
        </div>
      </div>
    </Card>
  );
}

/** Gastos por categoría: barras horizontales finas (una sola serie, un color). */
export function CategoryBreakdownCard({ items, base }: { items: CategoryAmount[]; base: string }) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  const max = Math.max(0, ...items.map((i) => i.amount));
  return (
    <Card padding="lg" as="section" aria-label="Gastos por categoría">
      <CardHeader title="Gastos por categoría" subtitle={total ? `${formatMoney(total, base)} registrados en el mes` : undefined} />
      {items.length === 0 ? (
        <EmptyState title="Sin gastos registrados" body="Cuando registres gastos del mes aparecerán aquí por categoría." />
      ) : (
        <ul className="space-y-3.5">
          {items.map((i) => (
            <li key={i.category}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-body-sm">
                <span className="min-w-0 truncate text-on-surface">{i.label}</span>
                <span className="shrink-0 text-label-md text-primary">
                  <span className="tabular">{formatMoney(i.amount, base, { whole: true })}</span>
                  <span className="ml-1.5 font-normal text-on-surface-variant">{formatPercent(total ? i.amount / total : 0)}</span>
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-container" aria-hidden>
                <div className="h-full rounded-full bg-error" style={{ width: `${max ? Math.max(2, (i.amount / max) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Los últimos movimientos del mes. */
export function RecentTransactionsCard({ items, base, allLink }: { items: TransactionView[]; base: string; allLink: string }) {
  return (
    <Card padding="lg" as="section" aria-label="Últimos movimientos">
      <CardHeader
        title="Últimos movimientos"
        subtitle={items.length ? `Los ${items.length} más recientes del mes` : undefined}
        action={
          <LinkButton to={allLink} variant="ghost" size="sm" iconRight={ChevronRight}>
            Ver todos
          </LinkButton>
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Sin movimientos este mes" />
      ) : (
        <ul className="divide-y divide-outline-variant/50">
          {items.map((t) => (
            <TxRow key={t.id} tx={t} base={base} />
          ))}
        </ul>
      )}
    </Card>
  );
}
