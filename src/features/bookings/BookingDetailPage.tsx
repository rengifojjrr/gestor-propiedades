/**
 * Detalle de una reserva (`/reservas/:id`): huésped, propiedad, fechas, desglose del pago (no para
 * atención al cliente), historial de estados, notas y acciones (entrada, salida, editar, cancelar).
 * Al registrar la salida se crea sola la limpieza de salida y aparece el enlace para verla.
 */
import { AlertTriangle, ArrowRight, BedDouble, CalendarCheck, CalendarX, Clock, FileWarning, LogIn, LogOut, MessageSquare, Pencil, SprayCan, StickyNote, UserRound, Users, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useBusyAction } from '@/app/hooks';
import { useActor, useSession } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { BOOKING_STATUS_LABEL } from '@/domain/labels';
import type { BookingStatus } from '@/domain/types';
import { formatDate, formatDateLong, formatDateTime, formatRange, formatTime, parseDate, relativeDay } from '@/lib/dates';
import { svc } from '@/services';
import {
  Avatar,
  Badge,
  Banner,
  BookingStatusBadge,
  Button,
  Card,
  CardHeader,
  CleaningStatusBadge,
  cn,
  ErrorState,
  LinkButton,
  Loading,
  PageHeader,
  PropertyImage,
  TextArea,
} from '@/ui';
import { BookingEditModal } from './BookingEditModal';
import { CancelBookingModal } from './CancelBookingModal';
import { canManageBookings, ChannelBadge, DANGER_OUTLINE, MoneyBreakdown, seesBookingMoney } from './shared';

const STATUS_ICON: Record<BookingStatus, typeof LogIn> = {
  confirmed: CalendarCheck,
  in_progress: LogIn,
  completed: LogOut,
  cancelled: XCircle,
};

/** Evita que «4:00 p. m.» se parta en dos renglones. */
const nbsp = (text: string) => text.replace(/\s/g, '\u00a0');

function Tile({ icon: Icon, label, value, sub }: { icon: typeof LogIn; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-low p-3">
      <p className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
        <Icon size={14} aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-label-md text-primary">{value}</p>
      {sub && <p className="text-body-sm text-on-surface-variant">{sub}</p>}
    </div>
  );
}

export default function BookingDetailPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const { user } = useSession();
  const manage = canManageBookings(user?.role);
  const money = seesBookingMoney(user?.role);
  const res = useLiveResult(() => svc.bookings.getBooking(actor, id), [actor, id]);
  const b = res.data;
  const property = useLive(() => (b ? svc.properties.getProperty(actor, b.propertyId).catch(() => null) : Promise.resolve(null)), [actor, b?.propertyId]);
  const cleaning = useLive(
    () =>
      b
        ? svc.operations
            .listCleaning(actor, { propertyId: b.propertyId })
            .then((list) => list.find((t) => t.bookingId === b.id && t.type === 'checkout') ?? null)
            .catch(() => null)
        : Promise.resolve(null),
    [actor, b?.id, b?.propertyId],
  );
  const team = useLive(() => svc.system.listTeam(actor).catch(() => []), [actor]);
  const [run, busy] = useBusyAction();
  const [busyAction, setBusyAction] = useState<'checkin' | 'checkout' | 'note' | null>(null);
  const [createdCleaningId, setCreatedCleaningId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState('');

  if (!b) {
    if (res.error)
      return (
        <div className="space-y-4" data-testid="detalle-reserva">
          <PageHeader title="Reserva" back="/reservas" />
          <ErrorState error={res.error} />
        </div>
      );
    return <Loading />;
  }

  const who = (by: string) => (by === 'system' ? 'Automático' : (team?.find((u) => u.id === by)?.name ?? (by === actor.realUser.id ? actor.realUser.name : 'Equipo')));
  const endsToday = b.checkOut === b.today && (b.status === 'in_progress' || b.status === 'confirmed');
  const startsToday = b.checkIn === b.today && b.status === 'confirmed';
  const canCheckIn = manage && b.status === 'confirmed' && b.checkIn <= b.today;
  const canCheckOut = manage && b.status === 'in_progress';
  const canEdit = manage && (b.status === 'confirmed' || b.status === 'in_progress');
  const canCancel = manage && b.status === 'confirmed';

  const checkIn = async () => {
    setBusyAction('checkin');
    await run(() => svc.bookings.checkInBooking(actor, b.id), { success: `Entrada de ${b.guestName} registrada` });
    setBusyAction(null);
  };

  const checkOut = async () => {
    setBusyAction('checkout');
    const r = await run(() => svc.bookings.checkOutBooking(actor, b.id), { success: 'Salida registrada: se creó la limpieza de salida' });
    setBusyAction(null);
    if (r) setCreatedCleaningId(r.cleaningTask.id);
  };

  const addNote = async () => {
    setBusyAction('note');
    const r = await run(() => svc.bookings.addBookingNote(actor, b.id, note), { success: 'Nota agregada' });
    setBusyAction(null);
    if (r) setNote('');
  };

  const guestCard = (className: string) => (
    <Card className={className}>
      <CardHeader title="Huésped" />
      <div className="flex items-center gap-3">
        <Avatar name={b.guestName} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-label-md text-primary">{b.guestName}</p>
          <p className="text-body-sm text-on-surface-variant">Idioma: {b.guestLanguage === 'en' ? 'inglés' : 'español'}</p>
          {b.guestDoNotRent && (
            <Badge tone="bad" icon={AlertTriangle} className="mt-1">
              No volver a alquilar
            </Badge>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <LinkButton to={`/personas/${b.guestId}`} variant="secondary" size="sm" icon={UserRound}>
          Ver ficha
        </LinkButton>
        {b.threadId && (
          <LinkButton to={`/mensajes/${b.threadId}`} variant="secondary" size="sm" icon={MessageSquare}>
            Conversación
          </LinkButton>
        )}
      </div>
    </Card>
  );

  const actions = (canCheckIn || canCheckOut || canEdit || canCancel) && (
    <>
      {canCheckIn && (
        <Button variant="success" icon={LogIn} onClick={checkIn} loading={busy && busyAction === 'checkin'} data-testid="registrar-entrada" className="flex-1 md:flex-none">
          Registrar entrada
        </Button>
      )}
      {canCheckOut && (
        <Button variant="success" icon={LogOut} onClick={checkOut} loading={busy && busyAction === 'checkout'} data-testid="registrar-salida" className="flex-1 md:flex-none">
          Registrar salida
        </Button>
      )}
      {canEdit && (
        <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)} data-testid="editar-reserva">
          Editar
        </Button>
      )}
      {canCancel && (
        <button type="button" onClick={() => setCancelling(true)} className={DANGER_OUTLINE} data-testid="cancelar-reserva">
          <XCircle size={18} aria-hidden />
          Cancelar reserva
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-5" data-testid="detalle-reserva">
      <PageHeader
        back="/reservas"
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label-sm uppercase text-on-surface-variant">{b.code}</span>
            <BookingStatusBadge status={b.status} />
            <ChannelBadge channel={b.channel} />
            {endsToday && (
              <Badge tone="warn" icon={CalendarX}>
                Termina hoy
              </Badge>
            )}
            {startsToday && (
              <Badge tone="good" icon={CalendarCheck}>
                Empieza hoy
              </Badge>
            )}
          </div>
        }
        title={b.guestName}
        subtitle={`${b.propertyName} · ${formatRange(b.checkIn, b.checkOut)} ${parseDate(b.checkOut).year} · ${b.nights} ${b.nights === 1 ? 'noche' : 'noches'}`}
        actions={actions || undefined}
      />

      {createdCleaningId && (
        <Banner
          tone="good"
          icon={SprayCan}
          action={
            <LinkButton to={`/operacion/limpieza/${createdCleaningId}`} size="sm" variant="secondary" iconRight={ArrowRight} data-testid="ver-limpieza-creada">
              Ver la limpieza
            </LinkButton>
          }
        >
          <strong>Salida registrada.</strong> Se creó la limpieza de salida{cleaning?.assigneeName ? ` y se asignó a ${cleaning.assigneeName}` : ''}.
        </Banner>
      )}
      {b.needsDetails && b.status !== 'cancelled' && (
        <Banner
          tone="warn"
          icon={FileWarning}
          action={
            canEdit && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Completar
              </Button>
            )
          }
        >
          <strong>Importada del .ics: completa los datos.</strong> El calendario no trae huésped ni montos: los montos son estimados con la tarifa de la propiedad. Edita personas, tarifa y canal; el nombre del huésped se cambia en su ficha.
        </Banner>
      )}
      {b.guestDoNotRent && (
        <Banner tone="bad" icon={AlertTriangle}>
          <strong>{b.guestName} está marcado «No volver a alquilar».</strong> Revisa su ficha antes de aceptar más reservas.
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Estadía" subtitle={b.status === 'in_progress' ? `En curso · sale ${relativeDay(b.checkOut, b.today).toLowerCase()}` : b.status === 'confirmed' ? `Entra ${relativeDay(b.checkIn, b.today).toLowerCase()}` : BOOKING_STATUS_LABEL[b.status]} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile icon={LogIn} label="Entrada" value={formatDate(b.checkIn, { weekday: true })} sub={`desde las ${nbsp(formatTime(b.checkInTime))}`} />
              <Tile icon={LogOut} label="Salida" value={formatDate(b.checkOut, { weekday: true })} sub={`hasta las ${nbsp(formatTime(b.checkOutTime))}`} />
              <Tile icon={BedDouble} label="Noches" value={b.nights} />
              <Tile icon={Users} label="Personas" value={b.guests} sub={property?.capacity ? `máximo ${property.capacity}` : undefined} />
            </div>
            <Link to={`/propiedades/${b.propertyId}`} className="mt-4 flex items-center gap-3 rounded-md border border-outline-variant/60 p-2.5 transition-colors hover:bg-surface-low">
              <PropertyImage photo={property?.photos[0]} alt="" className="h-14 w-20 shrink-0 rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label-md text-primary">{b.propertyName}</span>
                <span className="block truncate text-body-sm text-on-surface-variant">{property ? `${property.neighborhood ? `${property.neighborhood}, ` : ''}${property.city}` : b.propertyCity}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-on-surface-variant" aria-hidden />
            </Link>
          </Card>

          {guestCard('lg:hidden')}

          {money && (
            <Card>
              <CardHeader title="Detalle del pago" subtitle={b.needsDetails ? 'Estimado con la tarifa de la propiedad' : `Moneda: ${b.currency}`} />
              <MoneyBreakdown m={b} taxRate={property?.taxRate} />
            </Card>
          )}

          <Card>
            <CardHeader title="Notas" subtitle="Las ve el equipo; el huésped no." />
            {b.notes.length === 0 ? (
              <p className="mb-3 text-body-sm text-on-surface-variant">Todavía no hay notas.</p>
            ) : (
              <ul className="mb-4 space-y-2">
                {[...b.notes].reverse().map((n) => (
                  <li key={n.id} className="rounded-md bg-surface-low p-3">
                    <p className="text-body-md whitespace-pre-line text-on-surface">{n.text}</p>
                    <p className="mt-1 text-label-sm font-normal text-on-surface-variant">
                      {n.byName} · {formatDateTime(n.at, b.timezone)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <TextArea label="Agregar nota" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ej.: llega tarde, dejar la llave en la caja" />
              <div className="flex justify-end">
                <Button variant="secondary" icon={StickyNote} onClick={addNote} disabled={note.trim().length < 2} loading={busy && busyAction === 'note'} data-testid="agregar-nota">
                  Agregar nota
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          {guestCard('hidden lg:block')}

          {cleaning && (
            <Card>
              <CardHeader title="Limpieza de salida" action={<CleaningStatusBadge status={cleaning.status} />} />
              <p className="text-body-sm text-on-surface-variant">
                {formatDateLong(cleaning.date)} · {formatTime(cleaning.time)}
                <br />
                {cleaning.assigneeName ? `Asignada a ${cleaning.assigneeName}` : 'Sin asignar'}
              </p>
              <LinkButton to={`/operacion/limpieza/${cleaning.id}`} variant="secondary" size="sm" icon={SprayCan} className="mt-3">
                Abrir la limpieza
              </LinkButton>
            </Card>
          )}

          <Card>
            <CardHeader title="Historial" />
            <ol className="relative space-y-4 border-l-2 border-outline-variant/60 pl-5">
              {b.statusHistory.map((h, i) => {
                const Icon = STATUS_ICON[h.status];
                const last = i === b.statusHistory.length - 1;
                return (
                  <li key={`${h.status}-${h.at}`} className="relative">
                    <span
                      className={cn(
                        'absolute top-0 -left-[31px] flex h-6 w-6 items-center justify-center rounded-full',
                        last ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant',
                      )}
                      aria-hidden
                    >
                      <Icon size={13} />
                    </span>
                    <p className="text-label-md text-primary">{BOOKING_STATUS_LABEL[h.status]}</p>
                    <p className="flex items-center gap-1 text-body-sm text-on-surface-variant">
                      <Clock size={12} aria-hidden /> {formatDateTime(h.at, b.timezone)} · {who(h.by)}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>

      {editing && <BookingEditModal booking={b} taxRate={property?.taxRate} capacity={property?.capacity} onClose={() => setEditing(false)} />}
      {cancelling && <CancelBookingModal booking={b} onClose={() => setCancelling(false)} />}
    </div>
  );
}
