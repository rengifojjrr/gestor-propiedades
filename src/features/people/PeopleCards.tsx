/**
 * Tarjetas del registro de huéspedes (como en Stitch: iniciales, ciudad, fechas y etapa, último
 * mensaje, sin leer, «No volver a alquilar») y de inquilinos.
 */
import { Ban, CalendarDays, FileSignature, MessageSquare, Send, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { todayLocal } from '@/lib/clock';
import { formatDate, formatRange, relativeDay } from '@/lib/dates';
import type { GuestRegistryRow, LeaseView, PersonView, ThreadView } from '@/services';
import { Avatar, Badge, Button, cn, LinkButton } from '@/ui';
import { useOpenThread } from './hooks';
import { SPEAKS, STAGE_LABEL, type Stage } from './text';

function CityChip({ city }: { city: string }) {
  if (!city) return null;
  return <span className="rounded-full bg-surface-container px-2 py-0.5 text-label-sm tracking-wider text-primary uppercase">{city}</span>;
}

function UnreadPill({ n }: { n: number }) {
  if (!n) return null;
  return <span className="rounded-full bg-error px-2 py-0.5 text-label-sm text-on-error">{n === 1 ? '1 sin leer' : `${n} sin leer`}</span>;
}

function StageText({ row }: { row: GuestRegistryRow }) {
  const today = todayLocal();
  if (row.stage === 'active') return <span className="rounded-md bg-secondary px-2 py-0.5 text-label-sm text-on-secondary">{STAGE_LABEL.active}</span>;
  if (row.stage === 'upcoming')
    return (
      <span className="font-bold text-secondary">
        {STAGE_LABEL.upcoming} · {relativeDay(row.checkIn, today).toLowerCase()}
      </span>
    );
  return (
    <span>
      {STAGE_LABEL.past} · {relativeDay(row.checkOut, today).toLowerCase()}
    </span>
  );
}

/** «Enviar mensaje»: abre la conversación (o la crea si la reserva o el contrato aún no tiene). */
export function MessageButton({ threadId, bookingId, leaseId, canSend, variant = 'primary', className }: { threadId?: string; bookingId?: string; leaseId?: string; canSend: boolean; variant?: 'primary' | 'tonal'; className?: string }) {
  const [open, busy] = useOpenThread();
  if (threadId)
    return (
      <LinkButton to={`/mensajes/${threadId}`} variant={variant} icon={Send} className={className}>
        Enviar mensaje
      </LinkButton>
    );
  if (!canSend || (!bookingId && !leaseId)) return null;
  return (
    <Button variant={variant} icon={Send} loading={busy} onClick={() => void open({ bookingId, leaseId })} className={className}>
      Enviar mensaje
    </Button>
  );
}

/**
 * Rejilla de la tarjeta: en el teléfono, iniciales + datos y abajo los botones; en la computadora,
 * los botones suben a la fila del nombre y los datos usan todo el ancho.
 */
const CARD_GRID = 'grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 rounded-lg border p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:p-5';
const CARD_ACTIONS = 'col-span-2 col-start-1 row-start-3 mt-3 flex items-center gap-2 md:col-span-1 md:col-start-3 md:row-start-1 md:mt-0 md:self-center';
const CARD_BODY = 'col-start-2 row-start-2 min-w-0 md:col-span-2 md:col-start-2';
const CARD_AVATAR = 'col-start-1 row-span-2 row-start-1 self-start border-2';

export function GuestCard({ row, canSend }: { row: GuestRegistryRow; canSend: boolean }) {
  const stage: Stage = row.stage;
  return (
    <article
      aria-label={row.name}
      className={cn(
        CARD_GRID,
        'transition-shadow',
        stage === 'active' && 'border-outline-variant/60 border-l-4 border-l-secondary bg-surface-lowest shadow-card',
        stage === 'upcoming' && 'border-outline-variant/60 bg-surface-lowest hover:shadow-card',
        stage === 'past' && 'border-outline-variant/40 bg-surface-low',
      )}
      data-testid={`huesped-${row.bookingId}`}
    >
      <Avatar name={row.name} size="lg" className={cn(CARD_AVATAR, stage === 'active' ? 'border-secondary' : 'border-surface-high', stage === 'past' && 'opacity-75')} />
      <h3 className="col-start-2 row-start-1 self-center text-headline-md text-primary">{row.name}</h3>
      <div className={CARD_BODY}>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body-sm text-on-surface-variant">
          <CityChip city={row.propertyCity} />
          <CalendarDays size={14} className="ml-0.5" aria-hidden />
          <span>{formatRange(row.checkIn, row.checkOut)}</span>
          <span aria-hidden>·</span>
          <StageText row={row} />
          <UnreadPill n={row.unreadTeam} />
          {row.doNotRent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-error-container px-2 py-0.5 text-label-sm text-on-error-container">
              <Ban size={12} aria-hidden />
              No volver a alquilar
            </span>
          )}
        </p>
        <p className="mt-1 truncate text-body-sm text-on-surface-variant">
          {row.propertyName} · {row.bookingCode} · {SPEAKS[row.language].toLowerCase()}
        </p>
        {row.lastMessage && (
          <p
            className={cn(
              'mt-2 flex items-start gap-2 rounded-md px-2.5 py-2 text-body-sm',
              stage === 'active' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container text-on-surface-variant italic',
            )}
          >
            <MessageSquare size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">«{row.lastMessage}»</span>
          </p>
        )}
      </div>
      <div className={CARD_ACTIONS}>
        <LinkButton to={`/personas/${row.personId}`} variant="secondary" className="flex-1 md:flex-none">
          Ver ficha
        </LinkButton>
        <MessageButton threadId={row.threadId} bookingId={row.bookingId} canSend={canSend} variant={stage === 'past' ? 'tonal' : 'primary'} className="flex-1 md:flex-none" />
        <Link
          to={`/reservas/${row.bookingId}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-outline-variant bg-surface-lowest text-primary transition-colors hover:bg-surface-low"
          aria-label={`Ver la reserva ${row.bookingCode}`}
          title={`Reserva ${row.bookingCode}`}
        >
          <CalendarDays size={18} aria-hidden />
        </Link>
      </div>
    </article>
  );
}

export function TenantCard({ person, thread, lease, canSend }: { person: PersonView; thread?: ThreadView; lease?: LeaseView; canSend: boolean }) {
  const overdue = !!lease && lease.overdue.count > 0;
  return (
    <article aria-label={person.name} className={cn(CARD_GRID, 'border-outline-variant/60 bg-surface-lowest')} data-testid={`inquilino-${person.id}`}>
      <Avatar name={person.name} size="lg" className={cn(CARD_AVATAR, 'border-surface-high')} />
      <h3 className="col-start-2 row-start-1 self-center text-headline-md text-primary">{person.name}</h3>
      <div className={CARD_BODY}>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body-sm text-on-surface-variant">
          <CityChip city={thread?.propertyCity ?? lease?.propertyCity ?? ''} />
          <FileSignature size={14} className="ml-0.5" aria-hidden />
          {person.lease ? (
            <span>
              {person.lease.propertyName} · hasta el {formatDate(person.lease.end, { year: true })}
            </span>
          ) : (
            <span>Sin contrato vigente</span>
          )}
          <UnreadPill n={thread?.unreadTeam ?? 0} />
        </p>
        {(overdue || lease?.renewalDue || person.doNotRent) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {overdue && (
              <Badge tone="bad" icon={TriangleAlert}>
                Renta atrasada
              </Badge>
            )}
            {lease?.renewalDue && <Badge tone="warn">Renovación en {lease.daysToEnd} días</Badge>}
            {person.doNotRent && (
              <Badge tone="bad" icon={Ban}>
                No volver a alquilar
              </Badge>
            )}
          </div>
        )}
        {thread?.lastMessagePreview && (
          <p className="mt-2 flex items-start gap-2 rounded-md bg-surface-container px-2.5 py-2 text-body-sm text-on-surface-variant italic">
            <MessageSquare size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">«{thread.lastMessagePreview}»</span>
          </p>
        )}
      </div>
      <div className={CARD_ACTIONS}>
        <LinkButton to={`/personas/${person.id}`} variant="secondary" className="flex-1 md:flex-none">
          Ver ficha
        </LinkButton>
        <MessageButton threadId={thread?.id} leaseId={person.lease?.id} canSend={canSend} className="flex-1 md:flex-none" />
      </div>
    </article>
  );
}
