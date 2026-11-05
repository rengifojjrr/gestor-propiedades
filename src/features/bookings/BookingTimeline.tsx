/**
 * Pestaña «Línea de tiempo»: todas las propiedades (filas) × unas 5 semanas (columnas, desde hace 5 días),
 * con reservas, bloqueos y contratos. Se desliza de lado; la columna de propiedades queda fija.
 * Las barras van de la mitad del día de entrada a la mitad del día de salida (el día del cambio se comparte).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { BOOKING_STATUS_LABEL } from '@/domain/labels';
import { todayLocal } from '@/lib/clock';
import { addDays, diffDays, eachDay, formatDate, formatRange, monthKeyOf, monthLabel, parseDate } from '@/lib/dates';
import { svc } from '@/services';
import { Button, Card, cn, EmptyState, IconButton, Loading, PropertyImage } from '@/ui';
import { isWeekend, WEEKDAY_INITIALS, weekdayIndex } from '../calendar/monthGrid';
import { BLOCK_BAR_CLASS, BLOCK_REASON_LABEL, bookingBarClass, firstName, LEASE_BAR_CLASS, OccupancyLegend } from './shared';

const DAY_W = 40;
const SPAN = 35;
const BACK = 5;

interface BarPos {
  left: number;
  width: number;
  clipL: boolean;
  clipR: boolean;
}

export function BookingTimeline({ canOpenLeases }: { canOpenLeases: boolean }) {
  const actor = useActor();
  const today = todayLocal();
  const home = addDays(today, -BACK);
  const [from, setFrom] = useState(home);
  const to = addDays(from, SPAN);
  const data = useLive(() => svc.bookings.calendarData(actor, from, to), [actor, from, to]);
  const days = useMemo(() => eachDay(from, to), [from, to]);
  const total = SPAN * DAY_W;
  const scroller = useRef<HTMLDivElement>(null);
  const loaded = data !== undefined;

  // En el teléfono caben pocos días: se arranca con «ayer» en el borde izquierdo.
  useEffect(() => {
    const el = scroller.current;
    if (!loaded || !el) return;
    el.scrollLeft = el.clientWidth < 700 && from === home ? (BACK - 1) * DAY_W : 0;
  }, [loaded, from, home]);

  const months = useMemo(() => {
    const out: { key: string; days: number }[] = [];
    for (const d of days) {
      const key = monthKeyOf(d);
      const last = out[out.length - 1];
      if (last?.key === key) last.days += 1;
      else out.push({ key, days: 1 });
    }
    return out;
  }, [days]);

  /** Posición de una barra para el rango de noches [start, endExclusive). */
  const pos = (start: string, endExclusive: string): BarPos | null => {
    const l = diffDays(from, start) * DAY_W + DAY_W / 2;
    const r = diffDays(from, endExclusive) * DAY_W + DAY_W / 2;
    const left = Math.max(0, l);
    const right = Math.min(total, r);
    if (right - left < 8) return null;
    return { left: left + 1, width: right - left - 2, clipL: l < 0, clipR: r > total };
  };
  const todayX = diffDays(from, today) * DAY_W + DAY_W / 2;
  const showToday = today >= from && today < to;

  const barShape = (p: BarPos) => cn('absolute top-2.5 flex h-9 items-center overflow-hidden px-2 text-label-sm', p.clipL ? 'rounded-l-none' : 'rounded-l-md', p.clipR ? 'rounded-r-none' : 'rounded-r-md');

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant px-4 py-3 md:px-5">
        <div>
          <h2 className="text-headline-md text-primary">Ocupación de todas las propiedades</h2>
          <p className="text-body-sm text-on-surface-variant">
            {formatDate(from, { year: parseDate(from).year !== parseDate(today).year })} – {formatDate(addDays(to, -1), { year: true })} · toca una reserva para abrirla
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <IconButton icon={ChevronLeft} label="Dos semanas antes" variant="secondary" size="sm" onClick={() => setFrom(addDays(from, -14))} />
          <Button size="sm" variant="secondary" onClick={() => setFrom(home)} disabled={from === home}>
            Hoy
          </Button>
          <IconButton icon={ChevronRight} label="Dos semanas después" variant="secondary" size="sm" onClick={() => setFrom(addDays(from, 14))} />
        </div>
      </div>

      {!data ? (
        <Loading />
      ) : data.properties.length === 0 ? (
        <div className="p-4">
          <EmptyState title="No hay propiedades para mostrar" />
        </div>
      ) : (
        <div ref={scroller} className="overflow-x-auto overscroll-x-contain" role="region" aria-label="Línea de tiempo de reservas" tabIndex={0}>
          {/* Encabezado: meses y días */}
          <div className="flex min-w-max border-b border-outline-variant">
            <div className="sticky left-0 z-20 flex w-28 shrink-0 items-end border-r border-outline-variant bg-surface-lowest px-3 pb-2 md:w-56">
              <span className="text-label-sm uppercase text-on-surface-variant">Propiedad</span>
            </div>
            <div className="shrink-0" style={{ width: total }}>
              <div className="flex h-7 items-center">
                {months.map((m) => (
                  <div key={m.key} style={{ width: m.days * DAY_W }} className="truncate border-l border-outline-variant/60 px-2 text-label-sm text-primary first:border-l-0">
                    {m.days >= 3 ? monthLabel(m.key) : ''}
                  </div>
                ))}
              </div>
              <div className="flex">
                {days.map((d) => (
                  <div
                    key={d}
                    style={{ width: DAY_W }}
                    className={cn('flex flex-col items-center gap-0.5 pt-0.5 pb-1.5', isWeekend(d) && 'bg-surface-low')}
                    aria-label={d === today ? `Hoy, ${formatDate(d)}` : undefined}
                  >
                    <span className="text-[11px] leading-none font-semibold text-on-surface-variant">{WEEKDAY_INITIALS[weekdayIndex(d)]}</span>
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-label-sm tabular',
                        d === today ? 'bg-error text-on-error' : 'text-on-surface',
                      )}
                    >
                      {parseDate(d).day}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Filas: una por propiedad */}
          {data.properties.map((p) => {
            const bookings = data.bookings.filter((b) => b.propertyId === p.id && b.status !== 'cancelled');
            const blocks = data.blocks.filter((b) => b.propertyId === p.id);
            const leases = data.leases.filter((l) => l.propertyId === p.id);
            return (
              <div key={p.id} className="flex min-w-max border-b border-outline-variant/60 last:border-b-0">
                <Link
                  to={`/propiedades/${p.id}`}
                  className="sticky left-0 z-20 flex w-28 shrink-0 items-center gap-2.5 border-r border-outline-variant bg-surface-lowest px-3 hover:bg-surface-low md:w-56"
                  title={p.name}
                >
                  <PropertyImage photo={p.photos[0]} alt="" className="hidden h-9 w-9 shrink-0 rounded-md md:block" />
                  <span className="min-w-0">
                    <span className="block truncate text-label-md text-primary md:hidden">{p.city}</span>
                    <span className="hidden truncate text-label-md text-primary md:block">{p.name}</span>
                    <span className="hidden truncate text-label-sm font-normal text-on-surface-variant md:block">{p.city}</span>
                    <span className="sr-only md:hidden">{p.name}</span>
                  </span>
                </Link>
                <div className="relative h-14 shrink-0" style={{ width: total }}>
                  <div className="absolute inset-0 flex" aria-hidden>
                    {days.map((d) => (
                      <div key={d} style={{ width: DAY_W }} className={cn('h-full border-l border-outline-variant/30 first:border-l-0', isWeekend(d) && 'bg-surface-low')} />
                    ))}
                  </div>
                  {showToday && <div className="absolute inset-y-0 w-0.5 bg-error/70" style={{ left: todayX - 1 }} aria-hidden />}

                  {leases.map((l) => {
                    const ps = pos(l.start, addDays(l.end, 1));
                    if (!ps) return null;
                    const label = `Contrato · ${l.tenantName}`;
                    const cls = cn(barShape(ps), LEASE_BAR_CLASS);
                    return canOpenLeases ? (
                      <Link key={l.id} to={`/contratos/${l.id}`} className={cls} style={{ left: ps.left, width: ps.width }} title={`${label} (${formatRange(l.start, l.end)})`}>
                        <span className="truncate">{label}</span>
                      </Link>
                    ) : (
                      <div key={l.id} className={cls} style={{ left: ps.left, width: ps.width }} title={`${label} (${formatRange(l.start, l.end)})`}>
                        <span className="truncate">{label}</span>
                      </div>
                    );
                  })}

                  {blocks.map((bl) => {
                    const ps = pos(bl.start, bl.end);
                    if (!ps) return null;
                    const label = bl.note && bl.note.length <= 28 ? bl.note : BLOCK_REASON_LABEL[bl.reason];
                    return (
                      <div
                        key={bl.id}
                        className={cn(barShape(ps), BLOCK_BAR_CLASS)}
                        style={{ left: ps.left, width: ps.width }}
                        title={`${BLOCK_REASON_LABEL[bl.reason]}${bl.note ? ` · ${bl.note}` : ''} (${formatDate(bl.start)} → ${formatDate(bl.end)})`}
                      >
                        <span className="truncate">{label}</span>
                      </div>
                    );
                  })}

                  {bookings.map((b) => {
                    const ps = pos(b.checkIn, b.checkOut);
                    if (!ps) return null;
                    const label = b.needsDetails ? 'Por completar' : firstName(b.guestName);
                    return (
                      <Link
                        key={b.id}
                        to={`/reservas/${b.id}`}
                        className={cn(barShape(ps), bookingBarClass(b), 'shadow-card transition-shadow hover:shadow-lift')}
                        style={{ left: ps.left, width: ps.width }}
                        aria-label={`${b.guestName}, ${formatRange(b.checkIn, b.checkOut)}, ${BOOKING_STATUS_LABEL[b.status]}`}
                        title={`${b.guestName} · ${formatRange(b.checkIn, b.checkOut)} · ${BOOKING_STATUS_LABEL[b.status]}`}
                      >
                        <span className="truncate font-semibold">{label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-outline-variant px-4 py-3 md:px-5">
        <OccupancyLegend />
      </div>
    </Card>
  );
}
