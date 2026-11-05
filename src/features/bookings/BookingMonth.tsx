/**
 * Pestaña «Mes»: el calendario de una propiedad con sus reservas, bloqueos y contratos (por noches:
 * el día de salida queda libre). Propietario y administración bloquean y desbloquean fechas.
 */
import { CalendarSync, ChevronLeft, ChevronRight, FileSignature, Lock, Plus, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { nightsInPeriod } from '@/domain/rules';
import type { Block } from '@/domain/types';
import { todayLocal } from '@/lib/clock';
import { addDays, addMonthsToKey, daysInMonth, diffDays, formatDate, formatDateLong, formatRange, monthEndExclusive, monthKeyOf, monthLabel, monthStart, parseDate } from '@/lib/dates';
import { svc, type BookingView, type CalendarData } from '@/services';
import { Avatar, Badge, BookingStatusBadge, Button, Card, CardHeader, cn, EmptyState, IconButton, LinkButton, Loading, Select, useConfirm } from '@/ui';
import { gridRange, monthWeeks, WEEKDAY_SHORT } from '../calendar/monthGrid';
import { BlockModal } from './BlockModal';
import { BLOCK_BAR_CLASS, BLOCK_REASON_LABEL, bookingBarClass, firstName, LEASE_BAR_CLASS, OccupancyLegend } from './shared';

interface Item {
  id: string;
  kind: 'booking' | 'block' | 'lease';
  /** Noches [start, end). */
  start: string;
  end: string;
  label: string;
  cls: string;
  booking?: BookingView;
  block?: Block;
  lease?: CalendarData['leases'][number];
}

interface Segment {
  item: Item;
  col: number;
  span: number;
  isStart: boolean;
  isEnd: boolean;
  lane: number;
}

function weekSegments(week: string[], items: Item[]): { segs: Segment[]; lanes: number } {
  const ws = week[0];
  const we = addDays(week[6], 1);
  const segs: Segment[] = [];
  for (const item of items) {
    const s = item.start > ws ? item.start : ws;
    const e = item.end < we ? item.end : we;
    if (s >= e) continue;
    segs.push({ item, col: diffDays(ws, s), span: diffDays(s, e), isStart: s === item.start, isEnd: e === item.end, lane: 0 });
  }
  segs.sort((a, b) => a.col - b.col);
  const laneEnds: number[] = [];
  for (const sg of segs) {
    let lane = laneEnds.findIndex((end) => end <= sg.col);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = sg.col + sg.span;
    sg.lane = lane;
  }
  return { segs, lanes: Math.max(1, laneEnds.length) };
}

export function BookingMonth({ manage, canOpenLeases }: { manage: boolean; canOpenLeases: boolean }) {
  const actor = useActor();
  const run = useAction();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const [month, setMonth] = useState(monthKeyOf(today));
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const { from, to } = gridRange(weeks);
  const data = useLive(() => svc.bookings.calendarData(actor, from, to), [actor, from, to]);
  const [blockAt, setBlockAt] = useState<{ start: string; end?: string } | null>(null);

  const properties = useMemo(() => data?.properties ?? [], [data]);
  const selected = params.get('propiedad') ?? '';
  const property = properties.find((p) => p.id === selected) ?? properties.find((p) => p.rentalMode !== 'monthly') ?? properties[0];

  const items = useMemo<Item[]>(() => {
    if (!data || !property) return [];
    return [
      ...data.bookings
        .filter((b) => b.propertyId === property.id && b.status !== 'cancelled')
        .map((b) => ({ id: b.id, kind: 'booking' as const, start: b.checkIn, end: b.checkOut, label: b.needsDetails ? 'Por completar' : firstName(b.guestName), cls: bookingBarClass(b), booking: b })),
      ...data.blocks
        .filter((b) => b.propertyId === property.id)
        .map((b) => ({ id: b.id, kind: 'block' as const, start: b.start, end: b.end, label: BLOCK_REASON_LABEL[b.reason], cls: BLOCK_BAR_CLASS, block: b })),
      ...data.leases
        .filter((l) => l.propertyId === property.id)
        .map((l) => ({ id: l.id, kind: 'lease' as const, start: l.start, end: addDays(l.end, 1), label: `Contrato · ${firstName(l.tenantName)}`, cls: LEASE_BAR_CLASS, lease: l })),
    ].sort((a, b) => a.start.localeCompare(b.start));
  }, [data, property]);

  const mStart = monthStart(month);
  const mEnd = monthEndExclusive(month);
  const monthItems = items.filter((i) => i.start < mEnd && i.end > mStart);
  const totalNights = daysInMonth(month);
  const bookedNights = monthItems.filter((i) => i.kind !== 'block').reduce((s, i) => s + nightsInPeriod(i.start, i.end, mStart, mEnd), 0);
  const blockedNights = monthItems.filter((i) => i.kind === 'block').reduce((s, i) => s + nightsInPeriod(i.start, i.end, mStart, mEnd), 0);

  const covering = (d: string) => items.find((i) => i.start <= d && d < i.end);
  /** Primer día libre desde hoy (para proponer el inicio del bloqueo). */
  const firstFreeDay = () => {
    for (let d = today, i = 0; i < 180; i++, d = addDays(d, 1)) if (!covering(d)) return d;
    return today;
  };

  const selectProperty = (id: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('propiedad', id);
        return next;
      },
      { replace: true },
    );

  const removeBlock = async (b: Block) => {
    const ok = await confirm({
      title: '¿Quitar el bloqueo?',
      body: `${BLOCK_REASON_LABEL[b.reason]}${b.note ? ` · ${b.note}` : ''}: del ${formatDate(b.start)} al ${formatDate(addDays(b.end, -1))}. Las fechas quedan libres.`,
      confirmLabel: 'Quitar bloqueo',
      danger: true,
    });
    if (ok) await run(() => svc.bookings.removeBlock(actor, b.id), { success: 'Bloqueo quitado: las fechas quedan libres.' });
  };

  if (!data) return <Loading />;
  if (!property) return <EmptyState title="No hay propiedades para mostrar" />;

  const isMonthly = property.rentalMode === 'monthly';

  return (
    <div className="space-y-4">
      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-outline-variant px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5">
          <Select aria-label="Propiedad" value={property.id} onChange={(e) => selectProperty(e.target.value)} options={properties.map((p) => ({ value: p.id, label: p.name }))} className="md:w-80" />
          <div className="flex items-center justify-between gap-2 md:justify-end">
            <div className="flex items-center gap-1">
              <IconButton icon={ChevronLeft} label="Mes anterior" variant="secondary" size="sm" onClick={() => setMonth(addMonthsToKey(month, -1))} />
              <p className="min-w-28 text-center text-label-md text-primary md:min-w-36" aria-live="polite">
                {monthLabel(month)}
              </p>
              <IconButton icon={ChevronRight} label="Mes siguiente" variant="secondary" size="sm" onClick={() => setMonth(addMonthsToKey(month, 1))} />
            </div>
            {manage && !isMonthly && (
              <Button size="sm" icon={Lock} onClick={() => setBlockAt({ start: firstFreeDay() })} data-testid="bloquear-fechas" aria-label="Bloquear fechas">
                <span className="md:hidden">Bloquear</span>
                <span className="hidden md:inline">Bloquear fechas</span>
              </Button>
            )}
          </div>
        </div>

        <div role="group" aria-label={`${monthLabel(month)} · ${property.name}`}>
          <div className="grid grid-cols-7 border-b border-outline-variant bg-surface-low" aria-hidden>
            {WEEKDAY_SHORT.map((w) => (
              <div key={w} className="py-2 text-center text-label-sm uppercase text-on-surface-variant">
                {w}
              </div>
            ))}
          </div>
          {weeks.map((week) => {
            const { segs, lanes } = weekSegments(week, items);
            return (
              <div key={week[0]} className="relative grid min-h-[76px] grid-cols-7 border-b border-outline-variant/60 last:border-b-0 md:min-h-24" style={lanes > 1 ? { minHeight: 44 + lanes * 28 } : undefined}>
                {week.map((d) => {
                  const inMonth = monthKeyOf(d) === month;
                  const cover = covering(d);
                  const canBlock = manage && !isMonthly && !cover && d >= today;
                  const number = (
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full text-label-md tabular',
                        d === today ? 'bg-primary text-on-primary' : inMonth ? 'text-on-surface' : 'text-on-surface-variant/60',
                      )}
                    >
                      {parseDate(d).day}
                    </span>
                  );
                  const cellCls = cn('flex flex-col items-start border-l border-outline-variant/40 p-1 first:border-l-0 md:p-1.5', !inMonth && 'bg-surface-low/60');
                  return canBlock ? (
                    <button key={d} type="button" onClick={() => setBlockAt({ start: d })} className={cn(cellCls, 'group text-left transition-colors hover:bg-surface-low')} aria-label={`${formatDateLong(d)}: libre. Bloquear desde este día`}>
                      {number}
                      <Plus size={14} className="mt-auto ml-1 hidden text-on-surface-variant group-hover:block" aria-hidden />
                    </button>
                  ) : (
                    <div key={d} className={cellCls}>
                      {number}
                    </div>
                  );
                })}

                {segs.map((sg) => {
                  const it = sg.item;
                  const style = {
                    left: `calc(${(sg.col / 7) * 100}% + ${sg.isStart ? 3 : 0}px)`,
                    width: `calc(${(sg.span / 7) * 100}% - ${(sg.isStart ? 3 : 0) + (sg.isEnd ? 3 : 0)}px)`,
                    top: 36 + sg.lane * 28,
                  };
                  const cls = cn(
                    'absolute flex h-6 items-center overflow-hidden px-1.5 text-label-sm md:px-2',
                    it.cls,
                    sg.isStart ? 'rounded-l-md' : 'rounded-l-none',
                    sg.isEnd ? 'rounded-r-md' : 'rounded-r-none',
                  );
                  const text = <span className="truncate">{it.label}</span>;
                  if (it.kind === 'booking' && it.booking)
                    return (
                      <Link key={`${it.id}-${week[0]}`} to={`/reservas/${it.booking.id}`} className={cn(cls, 'font-semibold shadow-card hover:shadow-lift')} style={style} title={`${it.booking.guestName} · ${formatRange(it.start, it.end)}`}>
                        {text}
                      </Link>
                    );
                  if (it.kind === 'block' && it.block && manage) {
                    const block = it.block;
                    return (
                      <button key={`${it.id}-${week[0]}`} type="button" onClick={() => removeBlock(block)} className={cn(cls, 'hover:bg-surface-high')} style={style} title="Quitar bloqueo">
                        {text}
                      </button>
                    );
                  }
                  if (it.kind === 'lease' && it.lease && canOpenLeases)
                    return (
                      <Link key={`${it.id}-${week[0]}`} to={`/contratos/${it.lease.id}`} className={cls} style={style}>
                        {text}
                      </Link>
                    );
                  return (
                    <div key={`${it.id}-${week[0]}`} className={cls} style={style}>
                      {text}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 border-t border-outline-variant px-4 py-3 md:px-5">
          <OccupancyLegend />
          {manage && !isMonthly && <p className="text-label-sm font-normal text-on-surface-variant">Toca un día libre para bloquearlo, o un bloqueo para quitarlo.</p>}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title={`En ${monthLabel(month).toLowerCase()}`}
            subtitle={`${property.name} · ${bookedNights} de ${totalNights} noches ocupadas${blockedNights ? ` · ${blockedNights} bloqueadas` : ''}`}
          />
          {monthItems.length === 0 ? (
            <EmptyState title="Mes libre" body="No hay reservas, bloqueos ni contratos en este mes." />
          ) : (
            <ul className="space-y-2">
              {monthItems.map((it) => (
                <li key={it.id} className="flex items-center gap-3 rounded-md bg-surface-low px-3 py-2.5">
                  {it.kind === 'booking' && it.booking ? (
                    <>
                      <Avatar name={it.booking.guestName} size="sm" />
                      <Link to={`/reservas/${it.booking.id}`} className="min-w-0 flex-1">
                        <span className="block truncate text-label-md text-primary">{it.booking.guestName}</span>
                        <span className="block truncate text-body-sm text-on-surface-variant">
                          {formatRange(it.start, it.end)} · {it.booking.nights} {it.booking.nights === 1 ? 'noche' : 'noches'} · {it.booking.code}
                        </span>
                      </Link>
                      {it.booking.needsDetails ? <Badge tone="warn">Por completar</Badge> : <BookingStatusBadge status={it.booking.status} />}
                    </>
                  ) : it.kind === 'block' && it.block ? (
                    <>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant">
                        <Lock size={16} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label-md text-primary">
                          {BLOCK_REASON_LABEL[it.block.reason]}
                          {it.block.note ? ` · ${it.block.note}` : ''}
                        </span>
                        <span className="block truncate text-body-sm text-on-surface-variant">
                          Del {formatDate(it.block.start)} hasta el {formatDate(it.block.end)} (sin incluir)
                        </span>
                      </span>
                      {manage && (
                        <Button size="sm" variant="secondary" onClick={() => removeBlock(it.block!)}>
                          Quitar
                        </Button>
                      )}
                    </>
                  ) : it.lease ? (
                    <>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-info-container text-on-info-container">
                        <FileSignature size={16} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label-md text-primary">Contrato · {it.lease.tenantName}</span>
                        <span className="block truncate text-body-sm text-on-surface-variant">
                          {formatDate(it.lease.start, { year: true })} – {formatDate(it.lease.end, { year: true })} · {it.lease.code}
                        </span>
                      </span>
                      {canOpenLeases && (
                        <LinkButton to={`/contratos/${it.lease.id}`} size="sm" variant="secondary">
                          Ver
                        </LinkButton>
                      )}
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card tone="muted" className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="rounded-md bg-surface-lowest p-2 text-primary shadow-card">
              <CalendarSync size={20} aria-hidden />
            </span>
            <div>
              <p className="text-label-md text-primary">Sincronización automática con Airbnb/Vrbo: próximamente</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Por ahora, descarga el calendario .ics de cada canal e impórtalo aquí: las reservas entran «por completar» y los días no disponibles, como bloqueos.
              </p>
            </div>
          </div>
          {manage && (
            <LinkButton to="/reservas/importar" variant="secondary" size="sm" icon={Upload}>
              Importar .ics
            </LinkButton>
          )}
        </Card>
      </div>

      {blockAt && <BlockModal properties={properties.filter((p) => p.rentalMode !== 'monthly')} propertyId={property.id} start={blockAt.start} end={blockAt.end} onClose={() => setBlockAt(null)} />}
    </div>
  );
}
