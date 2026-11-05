/** Contratos (`/contratos`): alquileres por meses con su renta, día de pago, atrasos y renovaciones. */
import { AlertTriangle, CalendarClock, ChevronRight, FileSignature, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { useActor, useSession } from '@/app/session';
import { useLive } from '@/data/live';
import { formatDate } from '@/lib/dates';
import { svc, type LeaseView } from '@/services';
import { Badge, EmptyState, LinkButton, Loading, Money, PageHeader, PropertyImage, StatCard } from '@/ui';
import { MoneyTotals, sumByCurrency } from '../bookings/shared';
import { canManageLeases, dueDayText, LEASE_STATUS_LABEL, LEASE_STATUS_TONE, overdueText, renewalText } from './shared';

function LeaseCard({ l }: { l: LeaseView }) {
  return (
    <Link
      to={`/contratos/${l.id}`}
      className="group flex gap-4 rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 shadow-card transition-shadow hover:shadow-pop"
      data-testid={`contrato-${l.id}`}
    >
      <PropertyImage src={l.heroSrc} alt={l.propertyName} className="h-20 w-20 shrink-0 rounded-md md:h-24 md:w-24" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-label-md text-primary">{l.tenantName}</p>
            <p className="truncate text-body-sm text-on-surface-variant">
              {l.propertyName} · {l.propertyCity}
            </p>
          </div>
          <ChevronRight size={18} className="mt-0.5 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5" aria-hidden />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-headline-md font-bold text-primary">
            <Money amount={l.rent} currency={l.currency} />
            <span className="text-body-sm font-normal text-on-surface-variant">/mes</span>
          </span>
          <span className="text-body-sm text-on-surface-variant">{dueDayText(l.dueDay)}</span>
        </div>
        <p className="mt-0.5 text-body-sm text-on-surface-variant">
          {formatDate(l.start, { year: true })} – {formatDate(l.end, { year: true })} · {l.code}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={LEASE_STATUS_TONE[l.status]}>{LEASE_STATUS_LABEL[l.status]}</Badge>
          {l.status === 'active' && l.overdue.count > 0 && (
            <span title={`Atrasado: ${overdueText(l)}`} className="max-w-full">
              <Badge tone="bad" icon={AlertTriangle}>
                Atrasado: {overdueText(l, true)}
              </Badge>
            </span>
          )}
          {l.renewalDue && (
            <Badge tone="warn" icon={CalendarClock}>
              {renewalText(l.daysToEnd)}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function LeasesPage() {
  const actor = useActor();
  const { user } = useSession();
  const manage = canManageLeases(user?.role);
  const leases = useLive(() => svc.leases.listLeases(actor), [actor]);

  const stats = useMemo(() => {
    const active = (leases ?? []).filter((l) => l.status === 'active');
    const late = active.filter((l) => l.overdue.count > 0);
    return {
      active: active.length,
      rent: sumByCurrency(active.map((l) => ({ amount: l.rent, currency: l.currency }))),
      overdue: sumByCurrency(late.map((l) => ({ amount: l.overdue.amount + l.overdue.lateFees, currency: l.currency }))),
      lateCount: late.length,
      renewals: active.filter((l) => l.renewalDue).length,
    };
  }, [leases]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contratos"
        subtitle="Alquileres por meses: renta, pagos registrados, atrasos y renovaciones."
        actions={
          manage && (
            <LinkButton to="/contratos/nuevo" icon={Plus} className="flex-1 md:flex-none" data-testid="nuevo-contrato">
              Nuevo contrato
            </LinkButton>
          )
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Contratos activos" value={leases ? stats.active : '—'} hint={leases && leases.length > stats.active ? `${leases.length - stats.active} terminados` : 'Por meses'} />
        <StatCard label="Renta mensual" value={leases ? <MoneyTotals totals={stats.rent} /> : '—'} hint="Suma de los activos" hintTone="good" />
        <StatCard
          label="Atrasado"
          value={leases ? <MoneyTotals totals={stats.overdue} /> : '—'}
          accent={stats.lateCount ? 'bad' : undefined}
          hint={stats.lateCount ? `${stats.lateCount} ${stats.lateCount === 1 ? 'contrato' : 'contratos'} con recargo` : 'Todo al día'}
          hintTone={stats.lateCount ? 'bad' : 'good'}
        />
        <StatCard
          label="Por renovar"
          value={leases ? stats.renewals : '—'}
          accent={stats.renewals ? 'warn' : undefined}
          hint={stats.renewals ? 'Terminan en menos de 60 días' : 'Ninguno por ahora'}
          hintTone={stats.renewals ? 'warn' : 'neutral'}
        />
      </div>

      {!leases ? (
        <Loading />
      ) : leases.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="Todavía no hay contratos"
          body="Los alquileres por meses se registran aquí: renta, día de pago, depósito y recargo por atraso."
          action={manage && <LinkButton to="/contratos/nuevo" icon={Plus}>Nuevo contrato</LinkButton>}
        />
      ) : (
        <section aria-label="Lista de contratos" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {leases.map((l) => (
            <LeaseCard key={l.id} l={l} />
          ))}
        </section>
      )}
      {leases && leases.length > 0 && (
        <p className="text-center text-body-sm text-on-surface-variant italic">La app solo registra los pagos: no cobra ni mueve dinero.</p>
      )}
    </div>
  );
}
