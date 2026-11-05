/**
 * «Operación» de la ficha: reserva en curso, próxima reserva, contrato activo, limpiezas y órdenes
 * abiertas, más los atajos para crear una limpieza o reportar mantenimiento (según el rol).
 */
import { BedDouble, CalendarClock, FileSignature, Plus, Siren, SprayCan, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { CLEANING_TYPE_LABEL, ORDER_STATUS_LABEL } from '@/domain/labels';
import { formatDate, formatRange, formatTime, relativeDay } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { svc, type PropertyOperations, type PropertyView } from '@/services';
import { Badge, Card, CardHeader, CleaningStatusBadge, PriorityBadge, Skeleton } from '@/ui';
import { InfoRow, when, type Perms } from '../shared';

export function OperationsCard({ property: p, ops, perms }: { property: PropertyView; ops: PropertyOperations | null | undefined; perms: Perms }) {
  const actor = useActor();
  const canTeam = perms.allowed('team.read');
  const team = useLive(() => (canTeam ? svc.system.listTeam(actor).catch(() => []) : Promise.resolve([])), [actor, canTeam]);
  const nameOf = (userId?: string) => (userId ? team?.find((u) => u.id === userId)?.name : undefined);
  const res = { propertyId: p.id };
  const canCreateCleaning = perms.allowed('cleaning.write', res);
  const canCreateOrder = perms.allowed('maintenance.write', res);
  const canIncidents = perms.allowed('incident.read', res);
  const today = p.today;

  const items: ReactNode[] = [];
  if (ops) {
    const cur = ops.currentBooking;
    if (cur) {
      const endsToday = cur.checkOut === today;
      items.push(
        <InfoRow
          key="current"
          testId="reserva-en-curso"
          to={`/reservas/${cur.id}`}
          icon={BedDouble}
          title="Reserva en curso"
          titleEnd={endsToday ? <Badge tone="warn">Termina hoy</Badge> : <Badge tone="good">En curso</Badge>}
          meta={`${cur.guestName} · ${endsToday ? `salida ${formatTime(p.checkOutTime)}` : `sale ${when(cur.checkOut, today).toLowerCase()}`}`}
        />,
      );
    }
    const next = ops.nextBooking;
    if (next)
      items.push(
        <InfoRow
          key="next"
          testId="proxima-reserva"
          to={`/reservas/${next.id}`}
          icon={CalendarClock}
          title="Próxima reserva"
          titleEnd={<Badge tone="info">{relativeDay(next.checkIn, today)}</Badge>}
          meta={`${next.guestName} · ${formatRange(next.checkIn, next.checkOut)}`}
        />,
      );
    const lease = ops.activeLease;
    if (lease)
      items.push(
        <InfoRow
          key="lease"
          to={`/contratos/${lease.id}`}
          icon={FileSignature}
          title="Contrato activo"
          titleEnd={<Badge tone="good">{lease.code}</Badge>}
          meta={`${lease.tenantName} · ${formatMoney(lease.rent, lease.currency)}/mes · hasta ${formatDate(lease.end, { year: true })}`}
        />,
      );
    for (const c of ops.pendingCleanings) {
      const late = c.status === 'pending' && c.date < today;
      items.push(
        <InfoRow
          key={c.id}
          to={`/operacion/limpieza/${c.id}`}
          icon={SprayCan}
          title={CLEANING_TYPE_LABEL[c.type]}
          titleEnd={late ? <Badge tone="bad">Atrasada</Badge> : <CleaningStatusBadge status={c.status} />}
          meta={`${when(c.date, today, c.time)} · ${nameOf(c.assigneeId) ?? (c.assigneeId ? 'Asignada' : 'Sin asignar')}`}
        />,
      );
    }
    for (const o of ops.openOrders)
      items.push(
        <InfoRow
          key={o.id}
          to={`/operacion/mantenimiento/${o.id}`}
          icon={Wrench}
          title={o.title}
          badge={<PriorityBadge priority={o.priority} />}
          meta={`${o.code} · ${ORDER_STATUS_LABEL[o.status]}${o.scheduledDate ? ` · ${formatDate(o.scheduledDate)}` : ''}`}
        />,
      );
    if (ops.openIncidents > 0 && canIncidents)
      items.push(
        <InfoRow
          key="incidents"
          to="/operacion/incidencias"
          icon={Siren}
          title="Incidencias abiertas"
          titleEnd={<Badge tone="warn">{ops.openIncidents}</Badge>}
          meta="Revisa y conviértelas en orden de trabajo"
        />,
      );
    if (canCreateCleaning) {
      const last = ops.lastCleaning?.completedAt?.slice(0, 10);
      items.push(
        <InfoRow
          key="new-cleaning"
          to={`/operacion/limpieza/nueva?propertyId=${p.id}`}
          icon={Plus}
          title="Crear limpieza"
          meta={last ? `Última limpieza: ${relativeDay(last, today).toLowerCase()}` : 'Sin limpiezas terminadas todavía'}
        />,
      );
    }
    if (canCreateOrder)
      items.push(
        <InfoRow
          key="new-order"
          to={`/operacion/mantenimiento/nueva?propertyId=${p.id}`}
          icon={Wrench}
          title="Reportar mantenimiento"
          meta={ops.openOrders.length ? `${ops.openOrders.length} ${ops.openOrders.length === 1 ? 'orden abierta' : 'órdenes abiertas'}` : 'Sin órdenes abiertas'}
        />,
      );
  }

  // Contabilidad no ve reservas, limpiezas ni órdenes: si tampoco hay contrato, el bloque sobra.
  const seesOperations = perms.allowed('booking.read', res) || perms.allowed('cleaning.read', res) || perms.allowed('maintenance.read', res);
  if (ops !== undefined && items.length === 0 && !seesOperations) return null;

  return (
    <Card padding="lg">
      <CardHeader title="Operación" subtitle="Lo que pasa hoy en esta propiedad." />
      {ops === undefined ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2" aria-hidden>
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Sin reservas, contratos ni tareas abiertas que puedas ver.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
          {items.map((item, i) => (
            <li key={i} className="min-w-0">
              {item}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
