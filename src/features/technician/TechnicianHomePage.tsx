/**
 * App del técnico: «Mis órdenes», urgentes primero. Tarjetas grandes que abren la orden.
 */
import { CalendarClock, CircleCheck, ClipboardList, MapPin, Siren, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useActor, useSession } from '@/app/session';
import { useLive } from '@/data/live';
import { MAINTENANCE_CATEGORY_LABEL } from '@/domain/labels';
import { todayIn } from '@/lib/clock';
import { svc, type OrderView } from '@/services';
import { Badge, cn, EmptyState, Loading, OrderStatusBadge, PriorityBadge, PropertyImage, Tabs } from '@/ui';
import { dayLabel, firstName, isoDateIn } from '@/features/operations/shared';

type Tab = 'open' | 'resolved';

/** «hoy», «mañana» o «el jue 12 nov». */
function forDay(date: string, today: string): string {
  const label = dayLabel(date, today);
  return ['Hoy', 'Mañana', 'Ayer'].includes(label) ? label.toLowerCase() : `el ${label}`;
}

function OrderCard({ order: o }: { order: OrderView }) {
  const today = todayIn(o.timezone);
  const urgent = o.priority === 'urgent';
  return (
    <Link
      to={`/tecnico/orden/${o.id}`}
      data-testid={`orden-${o.id}`}
      className={cn(
        'flex overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-lowest shadow-card transition-shadow hover:shadow-lift',
        urgent && o.status !== 'resolved' && 'border-l-4 border-l-error',
      )}
    >
      <div className="relative w-28 shrink-0 sm:w-40">
        <PropertyImage src={o.heroSrc} alt="" className="absolute inset-0 h-full w-full" />
      </div>
      <div className="min-w-0 flex-1 space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={o.priority} />
          <OrderStatusBadge status={o.status} />
          {o.overdue && <Badge tone="bad">Atrasada</Badge>}
        </div>
        <h3 className={cn('text-headline-md', urgent && o.status !== 'resolved' ? 'text-error' : 'text-primary')}>{o.title}</h3>
        <p className="text-label-md text-on-surface">{o.propertyName}</p>
        <p className="flex items-start gap-1.5 text-body-sm text-on-surface-variant">
          <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span className="line-clamp-2">{o.propertyAddress}</span>
        </p>
        <p className={cn('flex items-center gap-1.5 text-body-sm', o.overdue ? 'text-error' : 'text-on-surface-variant')}>
          <CalendarClock size={16} className="shrink-0" aria-hidden />
          {o.status === 'resolved'
            ? `Resuelta${o.resolvedAt ? ` ${dayLabel(isoDateIn(o.resolvedAt, o.timezone), today).toLowerCase()}` : ''} · ${MAINTENANCE_CATEGORY_LABEL[o.category]}`
            : o.scheduledDate
              ? `${o.overdue ? 'Era para' : 'Para'} ${forDay(o.scheduledDate, today)}`
              : 'Sin fecha: cuanto antes'}
        </p>
      </div>
    </Link>
  );
}

export default function TechnicianHomePage() {
  const actor = useActor();
  const { user } = useSession();
  const orders = useLive(() => svc.operations.listOrders(actor), [actor]);
  const [tab, setTab] = useState<Tab>('open');
  if (!orders) return <Loading />;
  const open = orders.filter((o) => o.status === 'open' || o.status === 'scheduled' || o.status === 'in_progress');
  const resolved = orders.filter((o) => o.status === 'resolved').sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
  const urgent = open.filter((o) => o.priority === 'urgent').length;
  const forToday = open.filter((o) => o.scheduledDate && o.scheduledDate <= todayIn(o.timezone)).length;
  const list = tab === 'open' ? open : resolved;
  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="app-tecnico">
      <header>
        <p className="text-label-md text-on-surface-variant">Mis órdenes</p>
        <h1 className="text-headline-xl text-primary">Hola, {firstName(user?.name)}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {urgent > 0 && (
            <Badge tone="bad" icon={Siren}>
              {urgent} {urgent === 1 ? 'urgente' : 'urgentes'}
            </Badge>
          )}
          {forToday > 0 && (
            <Badge tone="warn" icon={TriangleAlert}>
              {forToday} para hoy
            </Badge>
          )}
          <Badge tone="info" icon={ClipboardList}>
            {open.length} {open.length === 1 ? 'abierta' : 'abiertas'}
          </Badge>
        </div>
      </header>
      <Tabs
        ariaLabel="Órdenes"
        value={tab}
        onChange={setTab}
        className="w-full"
        tabs={[
          { id: 'open', label: 'Abiertas', count: open.length },
          { id: 'resolved', label: 'Resueltas', count: resolved.length },
        ]}
      />
      {list.length ? (
        <div className="space-y-3">
          {list.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      ) : (
        <EmptyState icon={CircleCheck} title={tab === 'open' ? 'Nada pendiente' : 'Todavía no hay resueltas'} body={tab === 'open' ? 'Cuando te asignen una orden, aparece aquí.' : undefined} />
      )}
    </div>
  );
}
