/** Pestaña «Lista»: reservas con filtros (propiedad, estado y búsqueda) y acciones rápidas, como en Stitch. */
import { CalendarX2, Download, Eye, LogOut } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { downloadFile, useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { BOOKING_STATUS_LABEL, CHANNEL_LABEL } from '@/domain/labels';
import type { BookingStatus } from '@/domain/types';
import { formatRange } from '@/lib/dates';
import { svc, type BookingView } from '@/services';
import { Avatar, Banner, BookingStatusBadge, Button, Card, cn, EmptyState, LinkButton, Loading, Money, SearchInput, Select } from '@/ui';
import { CancelBookingModal } from './CancelBookingModal';
import { ChannelBadge } from './shared';

type StatusFilter = 'active' | BookingStatus | 'all';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Activas (confirmadas y en curso)' },
  { value: 'confirmed', label: 'Confirmadas' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed', label: 'Terminadas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'all', label: 'Todas' },
];

const PAGE = 25;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function BookingList({ manage, money }: { manage: boolean; money: boolean }) {
  const actor = useActor();
  const run = useAction();
  const bookings = useLive(() => svc.bookings.listBookings(actor), [actor]);
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const [propertyId, setPropertyId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [cancelling, setCancelling] = useState<BookingView | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [done, setDone] = useState<{ guest: string; property: string; cleaningId: string } | null>(null);

  const rows = useMemo(() => {
    if (!bookings) return [];
    const needle = normalize(q.trim());
    const list = bookings.filter(
      (b) =>
        (!propertyId || b.propertyId === propertyId) &&
        (status === 'all' || (status === 'active' ? b.status === 'confirmed' || b.status === 'in_progress' : b.status === status)) &&
        (!needle || normalize(`${b.guestName} ${b.code} ${b.propertyName} ${b.propertyCity} ${CHANNEL_LABEL[b.channel]}`).includes(needle)),
    );
    // Activas: la más próxima primero (en curso arriba). Historial: la más reciente primero.
    if (status === 'active' || status === 'confirmed' || status === 'in_progress')
      return list.sort((a, b) => (a.status === 'in_progress' ? 0 : 1) - (b.status === 'in_progress' ? 0 : 1) || a.checkIn.localeCompare(b.checkIn));
    return list.sort((a, b) => b.checkIn.localeCompare(a.checkIn));
  }, [bookings, propertyId, status, q]);

  const propertyOptions = useMemo(() => {
    const withBookings = new Set(bookings?.map((b) => b.propertyId));
    return (properties ?? []).filter((p) => p.rentalMode !== 'monthly' || withBookings.has(p.id)).map((p) => ({ value: p.id, label: p.name }));
  }, [properties, bookings]);

  const checkOut = async (b: BookingView) => {
    setCheckingOut(b.id);
    const res = await run(() => svc.bookings.checkOutBooking(actor, b.id), { success: 'Salida registrada: se creó la limpieza de salida' });
    setCheckingOut(null);
    if (res) setDone({ guest: b.guestName, property: b.propertyName, cleaningId: res.cleaningTask.id });
  };

  const exportCsv = () => {
    const head = ['Código', 'Huésped', 'Propiedad', 'Entrada', 'Salida', 'Noches', 'Personas', 'Canal', 'Estado', ...(money ? ['Pago neto', 'Moneda'] : [])];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = rows.map((b) =>
      [b.code, b.guestName, b.propertyName, b.checkIn, b.checkOut, b.nights, b.guests, CHANNEL_LABEL[b.channel], BOOKING_STATUS_LABEL[b.status], ...(money ? [b.netPayout, b.currency] : [])].map(esc).join(','),
    );
    downloadFile([head.map(esc).join(','), ...lines].join('\n'), 'reservas.csv', 'text/csv;charset=utf-8');
  };

  const actions = (b: BookingView, compact: boolean) => (
    <div className={cn('flex items-center gap-2', compact ? '' : 'justify-end')}>
      <LinkButton to={`/reservas/${b.id}`} variant="secondary" size="sm" icon={compact ? undefined : Eye} aria-label={`Ver la reserva de ${b.guestName}`}>
        Ver
      </LinkButton>
      {manage && b.status === 'in_progress' && (
        <Button variant="success" size="sm" icon={LogOut} loading={checkingOut === b.id} onClick={() => checkOut(b)}>
          Registrar salida
        </Button>
      )}
      {manage && b.status === 'confirmed' && (
        <button
          type="button"
          onClick={() => setCancelling(b)}
          className="inline-flex h-9 items-center rounded-md px-3 text-label-md font-semibold whitespace-nowrap text-error transition-colors hover:bg-error-container"
          aria-label={`Cancelar la reserva de ${b.guestName}`}
        >
          Cancelar
        </button>
      )}
    </div>
  );

  const title = STATUS_OPTIONS.find((o) => o.value === status)?.label.replace(/ \(.*\)$/, '') ?? 'Reservas';

  return (
    <div className="space-y-4">
      {done && (
        <Banner
          tone="good"
          action={
            <LinkButton to={`/operacion/limpieza/${done.cleaningId}`} size="sm" variant="secondary">
              Ver la limpieza
            </LinkButton>
          }
        >
          Salida de {done.guest} registrada en {done.property}. Se creó la limpieza de salida.
        </Banner>
      )}

      <Card padding="none" className="overflow-hidden">
        <div className="space-y-3 border-b border-outline-variant px-4 py-4 md:px-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-headline-md text-primary">
              {title === 'Activas' ? 'Reservas activas' : title === 'Todas' ? 'Todas las reservas' : `Reservas ${title.toLowerCase()}`}
            </h2>
            <span className="rounded-full bg-surface-container px-2.5 py-1 text-label-sm text-on-surface-variant">{bookings ? rows.length : '…'}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_220px_240px]">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar huésped, código o propiedad" label="Buscar reservas" />
            <Select aria-label="Propiedad" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} placeholder="Todas las propiedades" options={propertyOptions} />
            <Select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} options={STATUS_OPTIONS} />
          </div>
        </div>

        {!bookings ? (
          <Loading />
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={CalendarX2}
              title="No hay reservas con estos filtros"
              body={q || propertyId ? 'Prueba con otra búsqueda u otra propiedad.' : 'Cuando entren reservas aparecerán aquí.'}
              action={
                (q || propertyId || status !== 'all') && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQ('');
                      setPropertyId('');
                      setStatus('all');
                    }}
                  >
                    Ver todas
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            {/* Teléfono y tableta: tarjetas */}
            <ul className="divide-y divide-outline-variant lg:hidden">
              {rows.slice(0, limit).map((b) => (
                <li key={b.id} className={cn('p-4 md:px-5', b.status === 'in_progress' && 'bg-surface-low')}>
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/reservas/${b.id}`} className="flex min-w-0 items-center gap-3">
                      <Avatar name={b.guestName} />
                      <span className="min-w-0">
                        <span className="block truncate text-label-md text-primary">{b.guestName}</span>
                        <span className="block truncate text-body-sm text-on-surface-variant">
                          {b.propertyCity || b.propertyName} · {formatRange(b.checkIn, b.checkOut)}
                        </span>
                      </span>
                    </Link>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    {money ? (
                      <Money amount={b.netPayout} currency={b.currency} className="text-headline-md font-bold text-primary" />
                    ) : (
                      <span className="text-body-sm text-on-surface-variant">
                        {b.nights} {b.nights === 1 ? 'noche' : 'noches'} · {b.guests} {b.guests === 1 ? 'persona' : 'personas'}
                      </span>
                    )}
                    {actions(b, true)}
                  </div>
                </li>
              ))}
            </ul>

            {/* Computadora: tabla */}
            <div className="hidden lg:block">
              <table className="w-full border-collapse text-left">
                <thead className="bg-surface-low text-on-surface-variant">
                  <tr>
                    <th scope="col" className="px-5 py-3 text-label-md">Huésped</th>
                    <th scope="col" className="px-3 py-3 text-label-md">Propiedad</th>
                    <th scope="col" className="px-3 py-3 text-label-md">Fechas</th>
                    <th scope="col" className="px-3 py-3 text-label-md">Canal</th>
                    {money && <th scope="col" className="px-3 py-3 text-right text-label-md">Pago neto</th>}
                    <th scope="col" className="px-3 py-3 text-label-md">Estado</th>
                    <th scope="col" className="px-5 py-3 text-right text-label-md">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/60">
                  {rows.slice(0, limit).map((b) => (
                    <tr key={b.id} className={cn('transition-colors hover:bg-surface-low', b.status === 'in_progress' && 'bg-surface-low/60')}>
                      <td className="px-5 py-3.5">
                        <Link to={`/reservas/${b.id}`} className="flex items-center gap-3">
                          <Avatar name={b.guestName} />
                          <span className="min-w-0">
                            <span className="block max-w-48 truncate text-label-md text-primary">{b.guestName}</span>
                            <span className="text-label-sm font-normal text-on-surface-variant">{b.code}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="max-w-52 px-3 py-3.5 text-body-sm text-on-surface-variant">
                        <span className="line-clamp-2">{b.propertyName}</span>
                      </td>
                      <td className="px-3 py-3.5 text-body-sm whitespace-nowrap text-on-surface-variant">
                        <span className="block text-on-surface">{formatRange(b.checkIn, b.checkOut)}</span>
                        {b.nights} {b.nights === 1 ? 'noche' : 'noches'} · {b.guests} pers.
                      </td>
                      <td className="px-3 py-3.5">
                        <ChannelBadge channel={b.channel} />
                      </td>
                      {money && (
                        <td className="px-3 py-3.5 text-right">
                          <Money amount={b.netPayout} currency={b.currency} className="text-label-md font-bold text-primary" />
                        </td>
                      )}
                      <td className="px-3 py-3.5">
                        <BookingStatusBadge status={b.status} />
                      </td>
                      <td className="px-5 py-3.5">{actions(b, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {bookings && rows.length > 0 && (
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <p className="text-body-sm text-on-surface-variant italic">
            Mostrando {Math.min(limit, rows.length)} de {rows.length} {rows.length === 1 ? 'reserva' : 'reservas'}.{' '}
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1 text-label-md text-primary not-italic hover:underline">
              <Download size={14} aria-hidden />
              Descargar CSV
            </button>
          </p>
          {limit < rows.length && (
            <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar más
            </Button>
          )}
        </div>
      )}

      {cancelling && <CancelBookingModal booking={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}
