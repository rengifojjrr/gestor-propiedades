/** Tarjetas de «Limpieza y mantenimiento» (estilo Stitch: urgentes, carga, pendientes y hechas). */
import { Ban, CalendarClock, CircleCheck, Clock, DoorOpen, HardHat, TriangleAlert, UserRound, Wrench } from 'lucide-react';
import { Link } from 'react-router';
import { CLEANING_TYPE_LABEL, ORDER_STATUS_LABEL } from '@/domain/labels';
import { todayIn } from '@/lib/clock';
import type { CleaningTaskView, OrderView } from '@/services';
import { Badge, Button, cn, LinkButton, Money, PriorityBadge, ProgressBar, PropertyImage } from '@/ui';
import { approvalAmount, type Threshold } from './Approval';
import { ago, CATEGORY_ICON, CategoryTile, dayLabel, InfoLine, whenLabel } from './shared';

/** Tareas por persona en campo por semana (para la barra de capacidad). */
export const WEEKLY_CAPACITY_PER_PERSON = 6;

export function UrgentOrderCard({ order, onAssign, wide }: { order: OrderView; onAssign?: () => void; wide?: boolean }) {
  const Icon = CATEGORY_ICON[order.category];
  const today = todayIn(order.timezone);
  const who = order.assigneeName ?? order.vendorName;
  return (
    <article className={cn('group flex flex-col overflow-hidden rounded-lg border border-l-4 border-outline-variant/40 border-l-error bg-surface-lowest shadow-card', wide && 'sm:col-span-2')} data-testid={`urgente-${order.id}`}>
      <div className={cn('relative overflow-hidden', wide ? 'h-48' : 'h-40')}>
        <PropertyImage src={order.heroSrc} alt={order.propertyName} className="h-full w-full transition-transform duration-500 group-hover:scale-105" />
        <span className="absolute top-3 right-3 rounded-full bg-error px-3 py-1 text-label-sm uppercase text-on-error">Urgente</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4 md:p-5">
        <div>
          <h3 className="text-headline-md text-primary">{order.propertyName}</h3>
          <p className="mt-1 flex items-start gap-1.5 text-body-md text-error">
            <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
            <span>{order.title}</span>
          </p>
        </div>
        <div className="space-y-1.5">
          <InfoLine icon={Wrench}>
            {order.code} · {ORDER_STATUS_LABEL[order.status]} · {ago(order.createdAt)}
          </InfoLine>
          <InfoLine icon={UserRound} className={cn(!who && 'text-error')}>
            {who ?? 'Sin asignar'}
          </InfoLine>
          {order.scheduledDate && (
            <InfoLine icon={CalendarClock} className={cn(order.overdue && 'text-error')}>
              {order.overdue ? 'Atrasada: era ' : 'Programada: '}
              {dayLabel(order.scheduledDate, today).toLowerCase()}
            </InfoLine>
          )}
        </div>
        <div className="mt-auto flex gap-2 pt-1">
          {onAssign && (
            <Button className="flex-1" onClick={onAssign} data-testid={`asignar-${order.id}`}>
              Asignar técnico
            </Button>
          )}
          <LinkButton variant="secondary" className="flex-1" to={`/operacion/mantenimiento/${order.id}`}>
            Detalles
          </LinkButton>
        </div>
      </div>
    </article>
  );
}

export function LoadCard({ cleanings, orders, people }: { cleanings: number; orders: number; people: number }) {
  const count = cleanings + orders;
  const capacity = Math.max(1, people * WEEKLY_CAPACITY_PER_PERSON);
  const pct = Math.round((count / capacity) * 100);
  return (
    <section aria-label="Carga pendiente" className="relative overflow-hidden rounded-lg bg-primary-container p-5 text-on-primary-container shadow-pop md:p-6">
      <div className="relative z-10">
        <h2 className="text-label-md text-on-primary-container-muted">Carga pendiente</h2>
        <p className="tabular mt-1 text-headline-xl">
          {count} {count === 1 ? 'tarea' : 'tareas'}
        </p>
        <p className="text-body-sm text-on-primary-container-muted">
          {cleanings} {cleanings === 1 ? 'limpieza' : 'limpiezas'} · {orders} {orders === 1 ? 'orden' : 'órdenes'} · próximos 7 días
        </p>
        <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-on-primary-container/15" role="progressbar" aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Capacidad usada esta semana">
          <div className={cn('h-full rounded-full', pct > 100 ? 'bg-error' : pct > 85 ? 'bg-warning' : 'bg-secondary-container')} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <p className="mt-2 text-body-sm text-on-primary-container-muted">
          {pct} % de la capacidad de la semana · {people} {people === 1 ? 'persona' : 'personas'} en campo
        </p>
      </div>
      <HardHat size={120} strokeWidth={1.5} className="absolute -right-4 -bottom-4 opacity-10" aria-hidden />
    </section>
  );
}

export function PendingOrderRow({ order }: { order: OrderView }) {
  const today = todayIn(order.timezone);
  return (
    <li className="flex items-start gap-3 border-b border-outline-variant/60 pb-4 last:border-b-0 last:pb-0">
      <CategoryTile category={order.category} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-label-md text-primary">{order.propertyName}</p>
          <PriorityBadge priority={order.priority} />
        </div>
        <p className="text-body-sm text-on-surface-variant">{order.title}</p>
        <p className={cn('mt-0.5 text-label-sm font-normal text-on-surface-variant', order.overdue && 'text-error')}>
          {order.scheduledDate ? `${order.overdue ? 'Atrasada · era ' : ''}${dayLabel(order.scheduledDate, today)}` : 'Sin fecha'} · {order.assigneeName ?? order.vendorName ?? 'Sin asignar'}
        </p>
        <Link to={`/operacion/mantenimiento/${order.id}`} className="mt-2 inline-block text-label-sm text-secondary hover:underline">
          {order.scheduledDate ? 'Ver orden' : 'Programar arreglo'}
        </Link>
      </div>
    </li>
  );
}

export function CleaningCard({ task, onAssign }: { task: CleaningTaskView; onAssign?: () => void }) {
  const today = todayIn(task.timezone);
  const total = task.items.length;
  return (
    <article className="flex flex-col rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 shadow-card transition-colors hover:border-secondary md:p-5" data-testid={`limpieza-${task.id}`}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {task.priority === 'high' ? <Badge tone="bad">Prioridad alta</Badge> : <Badge>Normal</Badge>}
        {task.overdue && (
          <Badge tone="bad" icon={TriangleAlert}>
            Atrasada
          </Badge>
        )}
        {task.status === 'in_progress' && <Badge tone="info">En curso</Badge>}
      </div>
      <h3 className="text-headline-md text-primary">{task.propertyName}</h3>
      <p className="text-body-sm text-on-surface-variant">{CLEANING_TYPE_LABEL[task.type]}</p>
      <div className="mt-4 space-y-2">
        <InfoLine icon={UserRound} className={cn(!task.assigneeName && 'text-error')}>
          {task.assigneeName ?? 'Sin asignar'}
        </InfoLine>
        <InfoLine icon={Clock}>{whenLabel(task.date, task.time, today)}</InfoLine>
        {task.nextCheckIn && <InfoLine icon={DoorOpen}>Próxima entrada: {whenLabel(task.nextCheckIn.date, task.nextCheckIn.time, today).toLowerCase()}</InfoLine>}
      </div>
      {task.status === 'in_progress' && total > 0 && (
        <div className="mt-4">
          <ProgressBar value={task.doneCount / total} label="Avance de la checklist" />
          <p className="mt-1.5 text-label-sm font-normal text-on-surface-variant">
            {task.doneCount} de {total} · {task.beforeCount} {task.beforeCount === 1 ? 'foto' : 'fotos'} antes · {task.afterCount} después
          </p>
        </div>
      )}
      <div className="mt-auto flex gap-2 pt-5">
        <LinkButton variant="tonal" size="sm" className="flex-1" to={`/operacion/limpieza/${task.id}`}>
          Ver checklist
        </LinkButton>
        {onAssign && (
          <Button size="sm" className="flex-1" onClick={onAssign}>
            Asignar
          </Button>
        )}
      </div>
    </article>
  );
}

export interface DoneItem {
  key: string;
  kind: 'cleaning' | 'order';
  at: string;
  propertyName: string;
  detail: string;
  to: string;
}

export function DoneCard({ item }: { item: DoneItem }) {
  return (
    <article className="flex flex-col rounded-lg border border-outline-variant/40 bg-surface-low p-4 md:p-5">
      <div>
        <Badge tone="good" icon={CircleCheck}>
          {item.kind === 'cleaning' ? 'Limpieza hecha' : 'Orden resuelta'}
        </Badge>
      </div>
      <h3 className="mt-3 text-headline-md text-primary">{item.propertyName}</h3>
      <p className="mt-1 text-body-sm text-on-surface-variant">{item.detail}</p>
      <div className="mt-auto pt-4">
        <LinkButton variant="secondary" size="sm" fullWidth to={item.to}>
          Ver reporte
        </LinkButton>
      </div>
    </article>
  );
}

export function ApprovalRow({ order, threshold, onDecide }: { order: OrderView; threshold?: Threshold; onDecide: (mode: 'approve' | 'reject') => void }) {
  const amount = approvalAmount(order);
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid={`por-aprobar-${order.id}`}>
      <PropertyImage src={order.heroSrc} alt="" className="hidden h-14 w-14 shrink-0 rounded-md sm:block" />
      <div className="min-w-0 flex-1">
        <p className="text-label-sm uppercase text-on-surface-variant">
          {order.code} · {order.propertyName}
        </p>
        <Link to={`/operacion/mantenimiento/${order.id}`} className="mt-0.5 block text-label-md text-primary hover:underline">
          {order.title}
        </Link>
        <p className="mt-0.5 text-body-sm text-on-surface-variant">
          {order.status === 'resolved' ? 'Gasto real' : 'Presupuesto'}:{' '}
          {amount != null ? <Money amount={amount} currency={order.currency} className="font-semibold text-on-surface" /> : '—'}
          {threshold && (
            <>
              {' · límite '}
              <Money amount={threshold.amount} currency={threshold.currency} />
            </>
          )}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="success" size="sm" icon={CircleCheck} className="flex-1 sm:flex-none" onClick={() => onDecide('approve')}>
          Aprobar
        </Button>
        <Button variant="secondary" size="sm" icon={Ban} className="flex-1 sm:flex-none" onClick={() => onDecide('reject')}>
          Rechazar
        </Button>
      </div>
    </li>
  );
}
