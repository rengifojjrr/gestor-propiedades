/**
 * Calendario general (`/calendario`): entradas, salidas, limpiezas, mantenimiento, vencimientos,
 * pagos de renta y fin de contratos. En el teléfono arranca con la agenda de los próximos 14 días;
 * en la computadora, con el mes y la agenda del día elegido.
 */
import { CalendarDays, ChevronLeft, ChevronRight, ChevronRight as Go, ListChecks } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useActor, useSession } from '@/app/session';
import { useLive } from '@/data/live';
import type { Role } from '@/domain/types';
import { todayLocal } from '@/lib/clock';
import { addDays, addMonthsToKey, formatDateLong, formatTime, monthKeyOf, monthLabel, parseDate, relativeDay } from '@/lib/dates';
import { svc, type CalendarEvent, type CalendarEventKind } from '@/services';
import { Badge, Button, Card, CardHeader, cn, EmptyState, IconButton, Loading, PageHeader, Tabs } from '@/ui';
import { KIND_META, KIND_ORDER } from './eventKinds';
import { gridRange, isWideScreen, monthWeeks, WEEKDAY_INITIALS, WEEKDAY_SHORT } from './monthGrid';

type View = 'agenda' | 'mes';

/** Lo que cada rol puede llegar a ver (los servicios ya filtran; esto solo ordena los filtros). */
const KINDS_FOR: Partial<Record<Role, CalendarEventKind[]>> = {
  support: ['checkin', 'checkout', 'cleaning', 'maintenance', 'expiry'],
  accountant: ['expiry', 'rent', 'lease_end'],
};

function urgentLabel(e: CalendarEvent): string | null {
  if (e.tone !== 'urgent') return null;
  if (e.kind === 'rent') return 'Atrasada';
  if (e.kind === 'expiry') return 'Vencido';
  if (e.kind === 'cleaning') return 'Atrasada';
  return 'Urgente';
}

function EventRow({ e }: { e: CalendarEvent }) {
  const meta = KIND_META[e.kind];
  const urgent = urgentLabel(e);
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-lowest text-primary shadow-card">
        <meta.icon size={18} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label-md text-primary">{e.title}</span>
        <span className="block truncate text-body-sm text-on-surface-variant">{[e.time ? formatTime(e.time) : null, e.propertyName, e.subtitle].filter(Boolean).join(' · ')}</span>
      </span>
      {urgent && <Badge tone="bad">{urgent}</Badge>}
      {e.link && <Go size={18} className="shrink-0 text-on-surface-variant" aria-hidden />}
    </>
  );
  const cls = cn('flex min-h-14 items-center gap-3 rounded-md border-l-4 bg-surface-low px-3 py-2.5', meta.border);
  return e.link ? (
    <Link to={e.link} className={cn(cls, 'transition-colors hover:bg-surface-container')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function dayTitle(d: string, today: string): string {
  const rel = relativeDay(d, today);
  const long = formatDateLong(d);
  return rel === 'Hoy' || rel === 'Mañana' || rel === 'Ayer' ? `${rel} · ${long}` : long.charAt(0).toUpperCase() + long.slice(1);
}

export default function CalendarPage() {
  const actor = useActor();
  const { user } = useSession();
  const today = todayLocal();
  const [view, setView] = useState<View>(() => (isWideScreen() ? 'mes' : 'agenda'));
  const [month, setMonth] = useState(monthKeyOf(today));
  const [selected, setSelected] = useState(today);
  const [hidden, setHidden] = useState<Set<CalendarEventKind>>(() => new Set());
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const grid = gridRange(weeks);
  const from = view === 'mes' ? grid.from : today;
  const to = view === 'mes' ? grid.to : addDays(today, 14);
  const events = useLive(() => svc.system.calendarEvents(actor, from, to), [actor, from, to]);

  const kinds = (user && KINDS_FOR[user.role]) ?? KIND_ORDER;
  const visible = useMemo(() => (events ?? []).filter((e) => !hidden.has(e.kind)), [events, hidden]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of visible) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [visible]);
  const counts = useMemo(() => {
    const c = new Map<CalendarEventKind, number>();
    for (const e of events ?? []) c.set(e.kind, (c.get(e.kind) ?? 0) + 1);
    return c;
  }, [events]);

  const toggle = (k: CalendarEventKind) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const goToday = () => {
    setMonth(monthKeyOf(today));
    setSelected(today);
  };

  const agendaDays = [...byDay.keys()].sort();
  const selectedEvents = byDay.get(selected) ?? [];

  const filters = (
    <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filtrar por tipo">
      {kinds.map((k) => {
        const on = !hidden.has(k);
        const meta = KIND_META[k];
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(k)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-label-md transition-colors',
              on ? 'border-outline-variant bg-surface-lowest text-on-surface shadow-card' : 'border-transparent bg-surface-container text-on-surface-variant',
            )}
          >
            <span className={cn('h-2.5 w-2.5 rounded-full', meta.dot, !on && 'opacity-40')} aria-hidden />
            <span className={cn(!on && 'line-through')}>{meta.label}</span>
            {events && <span className="rounded-full bg-surface-container px-1.5 text-label-sm text-on-surface-variant">{counts.get(k) ?? 0}</span>}
          </button>
        );
      })}
      {hidden.size > 0 && (
        <button type="button" onClick={() => setHidden(new Set())} className="h-9 shrink-0 rounded-full px-3 text-label-md text-primary hover:bg-surface-low">
          Ver todo
        </button>
      )}
    </div>
  );

  const dayAgenda = (
    <Card className="lg:sticky lg:top-24">
      <CardHeader title={dayTitle(selected, today)} subtitle={selectedEvents.length ? `${selectedEvents.length} ${selectedEvents.length === 1 ? 'evento' : 'eventos'}` : 'Sin eventos'} />
      {selectedEvents.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nada programado para este día{hidden.size ? ' con los filtros elegidos' : ''}.</p>
      ) : (
        <ul className="space-y-2">
          {selectedEvents.map((e) => (
            <li key={e.id}>
              <EventRow e={e} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendario"
        subtitle={
          user?.role === 'accountant'
            ? 'Pagos de renta, fin de contratos y vencimientos de documentos.'
            : user?.role === 'support'
              ? 'Entradas, salidas, limpiezas, mantenimiento y vencimientos de todas las propiedades.'
              : 'Entradas, salidas, limpiezas, mantenimiento, vencimientos y pagos de todas las propiedades.'
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Tabs<View>
          ariaLabel="Vista del calendario"
          value={view}
          onChange={setView}
          tabs={[
            {
              id: 'agenda',
              label: (
                <>
                  <ListChecks size={16} aria-hidden /> Próximos 14 días
                </>
              ),
            },
            {
              id: 'mes',
              label: (
                <>
                  <CalendarDays size={16} aria-hidden /> Mes
                </>
              ),
            },
          ]}
        />
        {view === 'mes' && (
          <div className="flex items-center justify-between gap-1.5 md:justify-end">
            <IconButton icon={ChevronLeft} label="Mes anterior" variant="secondary" size="sm" onClick={() => setMonth(addMonthsToKey(month, -1))} />
            <p className="min-w-36 text-center text-label-md text-primary" aria-live="polite">
              {monthLabel(month)}
            </p>
            <IconButton icon={ChevronRight} label="Mes siguiente" variant="secondary" size="sm" onClick={() => setMonth(addMonthsToKey(month, 1))} />
            <Button size="sm" variant="secondary" onClick={goToday} disabled={month === monthKeyOf(today) && selected === today}>
              Hoy
            </Button>
          </div>
        )}
      </div>

      {filters}

      {!events ? (
        <Loading />
      ) : view === 'agenda' ? (
        agendaDays.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nada en los próximos 14 días" body={hidden.size ? 'Prueba quitando algún filtro.' : 'Cuando haya entradas, limpiezas o pagos aparecerán aquí.'} />
        ) : (
          <div className="space-y-5">
            {agendaDays.map((d) => (
              <section key={d} aria-label={dayTitle(d, today)}>
                <h2 className={cn('mb-2 text-label-md', d === today ? 'text-secondary' : 'text-primary')}>{dayTitle(d, today)}</h2>
                <ul className="space-y-2">
                  {(byDay.get(d) ?? []).map((e) => (
                    <li key={e.id}>
                      <EventRow e={e} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card padding="none" className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-outline-variant bg-surface-low" aria-hidden>
              {WEEKDAY_SHORT.map((w, i) => (
                <div key={w} className="py-2 text-center text-label-sm uppercase text-on-surface-variant">
                  <span className="md:hidden">{WEEKDAY_INITIALS[i]}</span>
                  <span className="hidden md:inline">{w}</span>
                </div>
              ))}
            </div>
            {weeks.map((week) => (
              <div key={week[0]} className="grid grid-cols-7 border-b border-outline-variant/60 last:border-b-0">
                {week.map((d) => {
                  const list = byDay.get(d) ?? [];
                  const inMonth = monthKeyOf(d) === month;
                  const kindsHere = KIND_ORDER.filter((k) => list.some((e) => e.kind === k));
                  const isSel = d === selected;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSelected(d)}
                      aria-pressed={isSel}
                      aria-label={`${formatDateLong(d)}: ${list.length ? `${list.length} ${list.length === 1 ? 'evento' : 'eventos'}` : 'sin eventos'}`}
                      className={cn(
                        'flex min-h-16 flex-col items-stretch gap-1 border-l border-outline-variant/40 p-1 text-left transition-colors first:border-l-0 md:min-h-24 md:p-1.5',
                        !inMonth && 'bg-surface-low/60',
                        isSel ? 'bg-surface-high' : 'hover:bg-surface-low',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-7 w-7 items-center justify-center self-start rounded-full text-label-md tabular',
                          d === today ? 'bg-primary text-on-primary' : inMonth ? 'text-on-surface' : 'text-on-surface-variant/60',
                          isSel && d !== today && 'ring-2 ring-primary',
                        )}
                      >
                        {parseDate(d).day}
                      </span>
                      {/* Teléfono y tableta: un punto por tipo */}
                      {kindsHere.length > 0 && (
                        <span className="flex flex-wrap gap-1 px-1 lg:hidden" aria-hidden>
                          {kindsHere.map((k) => (
                            <span key={k} className={cn('h-2 w-2 rounded-full', KIND_META[k].dot)} />
                          ))}
                        </span>
                      )}
                      {/* Computadora: punto, cuántos y de qué tipo */}
                      <span className="hidden min-w-0 flex-col gap-0.5 lg:flex" aria-hidden>
                        {kindsHere.map((k) => {
                          const n = list.filter((e) => e.kind === k).length;
                          return (
                            <span key={k} className="flex min-w-0 items-center gap-1.5 text-label-sm font-normal text-on-surface">
                              <span className={cn('h-2 w-2 shrink-0 rounded-full', KIND_META[k].dot)} />
                              <span className="truncate">
                                {n} {KIND_META[k].short[n === 1 ? 0 : 1]}
                              </span>
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </Card>
          {dayAgenda}
        </div>
      )}
    </div>
  );
}
