/**
 * Panel del propietario (y de administración): cifras del portafolio en tarjetas «bento»,
 * ganancia neta del mes, alertas, estado de cada propiedad, entradas, tareas de hoy y mapa.
 */
import { AlarmClock, BadgeDollarSign, Building2, ChevronRight, Plus, Siren, TrendingDown, TrendingUp, TriangleAlert, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { RENTAL_MODE_LABEL } from '@/domain/labels';
import type { RentalMode } from '@/domain/types';
import { todayLocal } from '@/lib/clock';
import { addMonthsToKey, formatDateLong, monthLabel } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import type { OwnerDashboard as OwnerDashboardData } from '@/services';
import { Card, cn, Eyebrow, LinkButton, Money, PageHeader, StatCard } from '@/ui';
import { when } from '@/features/properties/shared';
import { AlertsSection, MovementsSection, PortfolioMapSection, PropertyStatusSection, TodayTasksSection } from './widgets';

function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Tarjeta que lleva a otra pantalla (la tarjeta entera es el enlace). */
function CardLink({ to, label, className, children }: { to: string; label: string; className?: string; children: ReactNode }) {
  return (
    <Link to={to} aria-label={label} className={cn('block rounded-lg transition-transform hover:-translate-y-0.5', className)}>
      {children}
    </Link>
  );
}

function AttentionChip({ to, icon: Icon, children, tone }: { to: string; icon: typeof Siren; children: ReactNode; tone: 'bad' | 'warn' }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-label-md transition-shadow hover:shadow-card',
        tone === 'bad' ? 'bg-error-container text-on-error-container' : 'bg-warning-container text-on-warning-container',
      )}
    >
      <Icon size={16} aria-hidden />
      {children}
      <ChevronRight size={14} aria-hidden />
    </Link>
  );
}

function modeSummary(modes: RentalMode[]): string {
  const counts = modes.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m]: (acc[m] ?? 0) + 1 }), {});
  return (['nightly', 'monthly', 'mixed'] as RentalMode[])
    .filter((m) => counts[m])
    .map((m) => `${counts[m]} ${RENTAL_MODE_LABEL[m].toLowerCase()}`)
    .join(' · ');
}

export function OwnerDashboard({ data, userName, canCreate, canApprove }: { data: OwnerDashboardData; userName: string; canCreate: boolean; canApprove: boolean }) {
  const { counts, finance, kpis, overdueRent, arrivals } = data;
  const total = counts.total || 1;
  const base = finance?.baseCurrency;
  const prevLabel = monthLabel(addMonthsToKey(data.month, -1));
  const delta = finance && finance.previous.net ? (finance.net - finance.previous.net) / Math.abs(finance.previous.net) : null;
  const nextArrival = arrivals[0];
  const urgent = data.urgentOrders.length;

  return (
    <div data-testid="panel-propietario" className="space-y-8">
      <PageHeader
        eyebrow={<Eyebrow>{capitalize(formatDateLong(todayLocal()))}</Eyebrow>}
        title="Resumen"
        subtitle={`Hola, ${firstName(userName)}. Así está tu portafolio hoy.`}
        actions={
          canCreate && (
            <LinkButton to="/propiedades/nueva" icon={Plus}>
              Agregar propiedad
            </LinkButton>
          )
        }
      />

      {(urgent > 0 || data.openIncidents > 0 || data.pendingApprovals > 0) && (
        <div className="-mt-4 flex flex-wrap gap-2" aria-label="Necesita atención">
          {urgent > 0 && (
            <AttentionChip to={urgent === 1 ? `/operacion/mantenimiento/${data.urgentOrders[0].id}` : '/operacion'} icon={Siren} tone="bad">
              {urgent === 1 ? '1 orden urgente' : `${urgent} órdenes urgentes`}
            </AttentionChip>
          )}
          {data.openIncidents > 0 && (
            <AttentionChip to="/operacion/incidencias" icon={TriangleAlert} tone="warn">
              {data.openIncidents === 1 ? '1 incidencia abierta' : `${data.openIncidents} incidencias abiertas`}
            </AttentionChip>
          )}
          {data.pendingApprovals > 0 && (
            <AttentionChip to="/operacion" icon={BadgeDollarSign} tone="warn">
              {canApprove
                ? data.pendingApprovals === 1
                  ? '1 gasto por aprobar'
                  : `${data.pendingApprovals} gastos por aprobar`
                : data.pendingApprovals === 1
                  ? '1 gasto espera al propietario'
                  : `${data.pendingApprovals} gastos esperan al propietario`}
            </AttentionChip>
          )}
        </div>
      )}

      {/* Cifras («bento») */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Cifras del portafolio">
        <StatCard
          className="col-span-2 lg:col-span-1"
          icon={Building2}
          label="Total de propiedades"
          value={counts.total}
          hint={modeSummary(data.properties.map((p) => p.property.rentalMode))}
        />
        <CardLink to="/propiedades?estado=occupied" label={`Ocupadas: ${counts.occupied}. Ver cuáles`}>
          <StatCard label="Ocupadas" value={counts.occupied} progress={counts.occupied / total} progressTone="good" hint={`de ${counts.total}`} className="h-full" />
        </CardLink>
        <CardLink to="/propiedades?estado=vacant" label={`Libres: ${counts.vacant}. Ver cuáles`}>
          <StatCard label="Libres" value={counts.vacant} progress={counts.vacant / total} progressTone="warn" hint={`de ${counts.total}`} className="h-full" />
        </CardLink>
        <CardLink
          to="/propiedades?estado=maintenance"
          label={`En mantenimiento: ${counts.maintenance}. Ver cuáles`}
          className={cn(!kpis && 'col-span-2 lg:col-span-1')}
        >
          <StatCard
            label="En mantenimiento"
            value={counts.maintenance}
            icon={Wrench}
            accent={counts.maintenance > 0 ? 'bad' : undefined}
            hint={counts.blocked ? `+ ${counts.blocked} ${counts.blocked === 1 ? 'bloqueada' : 'bloqueadas'}` : 'Ninguna bloqueada'}
            className="h-full"
          />
        </CardLink>

        {kpis && (
          <StatCard
            label="Ocupación del mes"
            value={formatPercent(data.occupancy)}
            progress={data.occupancy}
            progressTone="info"
            hint={`En libros · ${finance?.label ?? monthLabel(data.month)}`}
          />
        )}

        {finance && base && (
          <Card tone="dark" padding="lg" className="col-span-2 flex flex-col justify-between">
            <div>
              <p className="text-label-md text-on-primary-container-muted">Ganancia neta del mes</p>
              <p className="mt-1 text-headline-xl" data-testid="ganancia-neta">
                <Money amount={finance.net} currency={base} />
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-label-sm text-on-primary-container-muted">
                {delta != null && (delta >= 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />)}
                {delta != null
                  ? `${delta >= 0 ? '+' : ''}${formatPercent(delta)} frente a ${prevLabel.split(' ')[0].toLowerCase()}`
                  : finance.label}
                {finance.income > 0 && ` · margen ${formatPercent(finance.margin)}`}
              </p>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-on-primary-container/15 pt-4">
              <div>
                <p className="text-label-sm text-on-primary-container-muted">Ingresos</p>
                <p className="text-headline-md text-secondary-container dark:text-on-secondary-container">
                  <Money amount={finance.income} currency={base} />
                </p>
              </div>
              <div>
                <p className="text-label-sm text-on-primary-container-muted">Gastos</p>
                <p className="text-headline-md text-error-container dark:text-on-error-container">
                  <Money amount={finance.expenses} currency={base} />
                </p>
              </div>
            </div>
          </Card>
        )}

        {kpis && base && (
          <Card className="col-span-2 lg:col-span-1">
            <p className="text-label-md text-on-surface-variant">Tarifa media y RevPAR</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div title="Tarifa media por noche vendida">
                <p className="text-label-sm text-on-surface-variant uppercase">ADR</p>
                <p className="text-headline-lg text-primary">
                  <Money amount={kpis.adr} currency={base} whole />
                </p>
              </div>
              <div title="Ingreso por noche disponible">
                <p className="text-label-sm text-on-surface-variant uppercase">RevPAR</p>
                <p className="text-headline-lg text-primary">
                  <Money amount={kpis.revpar} currency={base} whole />
                </p>
              </div>
            </div>
            <p className="mt-2 text-label-sm text-on-surface-variant">
              {kpis.nightsSold} de {kpis.availableNights} noches vendidas (por noches)
            </p>
          </Card>
        )}

        <CardLink to="/contratos" label={`Alquileres atrasados: ${overdueRent.count}. Ver contratos`} className="col-span-2">
          <Card accent={overdueRent.count > 0 ? 'bad' : 'good'} className="flex h-full items-center gap-4">
            <span className={cn('rounded-md p-2.5', overdueRent.count > 0 ? 'bg-error-container text-on-error-container' : 'bg-secondary-container text-on-secondary-container')}>
              <AlarmClock size={22} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-label-md text-on-surface-variant">Alquileres atrasados</p>
              <p className="tabular text-headline-lg text-primary">
                {overdueRent.count}
                {overdueRent.count > 0 && base && (
                  <>
                    <span className="mx-2 text-on-surface-variant">·</span>
                    <Money amount={overdueRent.amount} currency={base} tone="expense" />
                  </>
                )}
              </p>
              <p className="text-body-sm text-on-surface-variant">
                {overdueRent.count > 0 ? 'Rentas sin pagar después del plazo de gracia (con recargo).' : 'Todas las rentas están al día.'}
              </p>
            </div>
            <ChevronRight size={20} className="shrink-0 text-on-surface-variant" aria-hidden />
          </Card>
        </CardLink>

        <Card className="col-span-2 flex items-center gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-secondary" aria-hidden>
            <span className="tabular text-headline-lg text-primary">{arrivals.length}</span>
          </div>
          <div className="min-w-0">
            <h3 className="text-headline-md text-primary">
              <span className="sr-only">{arrivals.length} </span>Próximas entradas (48 h)
            </h3>
            <p className="text-body-sm text-on-surface-variant">
              {nextArrival
                ? `Próxima: ${nextArrival.guestName} · ${nextArrival.propertyName}, ${when(nextArrival.checkIn, nextArrival.today, nextArrival.checkInTime).toLowerCase()}`
                : 'Nadie llega entre hoy y pasado mañana.'}
            </p>
          </div>
        </Card>
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-3">
        <AlertsSection alerts={data.alerts} limit={4} />
        <PropertyStatusSection rows={data.properties} baseCurrency={base} className="xl:col-span-2" />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <MovementsSection arrivals={arrivals} departures={data.departures} />
        <TodayTasksSection cleanings={data.todayCleanings} orders={data.todayOrders} />
      </div>

      <PortfolioMapSection properties={data.properties.map((p) => p.property)} />
    </div>
  );
}
