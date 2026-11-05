/** Historial reciente: las últimas reservas de la propiedad (para quien puede ver reservas). */
import { CalendarDays } from 'lucide-react';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { CHANNEL_LABEL } from '@/domain/labels';
import { formatRange } from '@/lib/dates';
import { svc } from '@/services';
import { BookingStatusBadge, Card, CardHeader } from '@/ui';
import { InfoRow } from '../shared';

export function HistoryCard({ propertyId, monthly }: { propertyId: string; monthly: boolean }) {
  const actor = useActor();
  const bookings = useLive(
    () =>
      svc.bookings
        .listBookings(actor, { propertyId })
        .then((rows) => [...rows].sort((a, b) => b.checkIn.localeCompare(a.checkIn)).slice(0, 5))
        .catch(() => null),
    [actor, propertyId],
  );
  if (!bookings || (monthly && bookings.length === 0)) return null;
  return (
    <Card padding="lg">
      <CardHeader title="Historial reciente" subtitle="Las últimas reservas de esta propiedad." />
      {bookings.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Todavía no hay reservas.</p>
      ) : (
        <ul className="space-y-2">
          {bookings.map((b) => (
            <li key={b.id}>
              <InfoRow
                to={`/reservas/${b.id}`}
                icon={CalendarDays}
                title={b.guestName}
                titleEnd={<span className="text-label-sm font-normal text-on-surface-variant">{b.code}</span>}
                badge={<BookingStatusBadge status={b.status} />}
                meta={`${formatRange(b.checkIn, b.checkOut)} · ${b.nights} ${b.nights === 1 ? 'noche' : 'noches'} · ${CHANNEL_LABEL[b.channel]}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
