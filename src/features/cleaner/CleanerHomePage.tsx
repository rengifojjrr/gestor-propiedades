/**
 * App de limpieza: «Hola, Rosa». Primero lo de hoy (y lo atrasado) en tarjetas grandes con un solo
 * botón; luego la ruta del día, las próximas salidas (la tarea se crea sola) y lo hecho hoy.
 */
import { Camera, ChevronRight, CircleCheck, Clock, DoorOpen, ExternalLink, LogOut, MapPin, Navigation, Play, Route, SprayCan, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useActor, useSession } from '@/app/session';
import { useLive } from '@/data/live';
import { CLEANING_TYPE_LABEL } from '@/domain/labels';
import { todayIn, todayLocal } from '@/lib/clock';
import { formatDateLong } from '@/lib/dates';
import { svc, type CleaningTaskView, type ProjectedCheckout } from '@/services';
import { Badge, buttonClass, Card, cn, EmptyState, Loading, ProgressBar, PropertyImage } from '@/ui';
import { dayLabel, firstName, isoDateIn, mapsDirUrl, timeLabel, whenLabel } from '@/features/operations/shared';
import { nextArrivalText } from './arrival';

function TaskCard({ task }: { task: CleaningTaskView }) {
  const today = todayIn(task.timezone);
  const total = task.items.length;
  const started = task.status === 'in_progress';
  const late = task.date < today;
  const arrival = nextArrivalText(task, today);
  const sameDay = task.nextCheckIn?.date === task.date;
  return (
    <article className={cn('overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-lowest shadow-card', late && 'border-l-4 border-l-error')}>
      <div className="relative h-36 sm:h-44">
        <PropertyImage src={task.heroSrc} alt={task.propertyName} className="h-full w-full" />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {late && (
            <Badge tone="bad" icon={TriangleAlert}>
              Atrasada
            </Badge>
          )}
          {task.priority === 'high' && <Badge tone="bad">Prioridad alta</Badge>}
          {started && <Badge tone="info">En curso</Badge>}
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <p className="flex items-center gap-1.5 text-label-md text-on-surface-variant">
            <Clock size={16} aria-hidden />
            {whenLabel(task.date, task.time, today)} · {CLEANING_TYPE_LABEL[task.type]}
          </p>
          <h3 className="mt-1 text-headline-md text-primary">{task.propertyName}</h3>
          <p className="flex items-start gap-1.5 text-body-sm text-on-surface-variant">
            <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
            {task.propertyAddress}
          </p>
        </div>
        {(task.guestName || arrival) && (
          <div className="space-y-1.5 rounded-md bg-surface-low p-3">
            {task.guestName && (
              <p className="flex items-center gap-2 text-body-sm text-on-surface">
                <LogOut size={16} className="shrink-0 text-on-surface-variant" aria-hidden />
                Sale {firstName(task.guestName)}
                {task.type === 'checkout' ? ` a las ${timeLabel(task.time)}` : ''}
              </p>
            )}
            {arrival && (
              <p className={cn('flex items-center gap-2 text-body-sm', sameDay ? 'font-semibold text-on-warning-container' : 'text-on-surface')}>
                <DoorOpen size={16} className="shrink-0" aria-hidden />
                {arrival}
              </p>
            )}
          </div>
        )}
        {total > 0 && (
          <div>
            <ProgressBar value={task.doneCount / total} label="Avance de la checklist" />
            <p className="mt-1.5 flex items-center gap-1.5 text-label-sm font-normal text-on-surface-variant">
              {task.doneCount} de {total} · <Camera size={14} aria-hidden /> {task.beforeCount} antes · {task.afterCount} después
            </p>
          </div>
        )}
        <Link to={`/limpieza/tarea/${task.id}`} className={buttonClass(started ? 'primary' : 'success', 'lg', true)} data-testid={`tarea-${task.id}`}>
          <Play size={22} aria-hidden />
          {started ? 'Seguir' : 'Empezar'}
        </Link>
      </div>
    </article>
  );
}

/** Tarea de otro día: fila compacta (lo de hoy va en tarjeta grande). */
function UpcomingRow({ task }: { task: CleaningTaskView }) {
  const today = todayIn(task.timezone);
  return (
    <Link
      to={`/limpieza/tarea/${task.id}`}
      data-testid={`tarea-${task.id}`}
      className="flex items-center gap-3 rounded-lg border border-outline-variant/40 bg-surface-lowest p-3 shadow-card transition-colors hover:bg-surface-low"
    >
      <PropertyImage src={task.heroSrc} alt="" className="h-16 w-16 shrink-0 rounded-md" />
      <span className="min-w-0 flex-1">
        <span className="block text-label-md text-on-surface-variant">{whenLabel(task.date, task.time, today)}</span>
        <span className="mt-0.5 block truncate text-body-md font-semibold text-primary">{task.propertyName}</span>
        <span className="block text-body-sm text-on-surface-variant">
          {CLEANING_TYPE_LABEL[task.type]}
          {task.priority === 'high' ? ' · prioridad alta' : ''}
        </span>
      </span>
      <ChevronRight size={20} className="shrink-0 text-on-surface-variant" aria-hidden />
    </Link>
  );
}

function RouteCard({ stops }: { stops: CleaningTaskView[] }) {
  return (
    <Card padding="lg">
      <ol className="space-y-3">
        {stops.map((t, i) => (
          <li key={t.id} className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-label-md text-on-primary">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-label-md text-primary">
                {timeLabel(t.time)} · {t.propertyName}
              </p>
              <p className="truncate text-body-sm text-on-surface-variant">{t.propertyAddress}</p>
            </div>
          </li>
        ))}
      </ol>
      <a href={mapsDirUrl(stops.map((t) => ({ lat: t.propertyLat, lng: t.propertyLng })))} target="_blank" rel="noreferrer" className={cn(buttonClass('secondary', 'lg', true), 'mt-4')} data-testid="abrir-ruta">
        <Navigation size={20} aria-hidden />
        Abrir ruta en Google Maps
        <ExternalLink size={16} aria-hidden />
      </a>
    </Card>
  );
}

function CheckoutRow({ c }: { c: ProjectedCheckout }) {
  const today = todayLocal();
  const sameDay = c.nextCheckIn?.date === c.date;
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex w-20 shrink-0 flex-col items-center gap-0.5 rounded-md bg-surface-low px-1 py-1.5 text-center">
        <span className="text-label-sm text-on-surface-variant">{dayLabel(c.date, today)}</span>
        <span className="tabular text-label-sm whitespace-nowrap text-primary">{timeLabel(c.time)}</span>
      </span>
      <div className="min-w-0">
        <p className="text-label-md text-primary">{c.propertyName}</p>
        <p className="text-body-sm text-on-surface-variant">Sale {c.guestName}</p>
        {c.nextCheckIn && (
          <p className={cn('text-body-sm', sameDay ? 'font-semibold text-on-warning-container' : 'text-on-surface-variant')}>
            {sameDay ? `Llega otro huésped a las ${timeLabel(c.nextCheckIn.time)}` : `Próxima llegada: ${whenLabel(c.nextCheckIn.date, c.nextCheckIn.time, today).toLowerCase()}`}
          </p>
        )}
      </div>
    </li>
  );
}

export default function CleanerHomePage() {
  const actor = useActor();
  const { user } = useSession();
  const tasks = useLive(() => svc.operations.listCleaning(actor, { status: ['pending', 'in_progress'] }), [actor]);
  const done = useLive(() => svc.operations.listCleaning(actor, { status: ['done'] }), [actor]);
  const checkouts = useLive(() => svc.operations.projectedCheckouts(actor), [actor]);

  if (!tasks) return <Loading />;
  const late = tasks.filter((t) => t.date < todayIn(t.timezone));
  const todays = tasks.filter((t) => t.date === todayIn(t.timezone));
  const upcoming = tasks.filter((t) => t.date > todayIn(t.timezone));
  const route = [...late, ...todays].sort((a, b) => a.time.localeCompare(b.time));
  const doneToday = (done ?? []).filter((t) => t.completedAt && isoDateIn(t.completedAt, t.timezone) === todayIn(t.timezone));
  // Las salidas que ya tienen tarea no se repiten.
  const pendingCheckouts = (checkouts ?? []).filter((c) => !tasks.some((t) => t.propertyId === c.propertyId && t.type === 'checkout' && t.date === c.date));
  const longDate = formatDateLong(todayLocal());

  return (
    <div className="mx-auto max-w-2xl space-y-8" data-testid="app-limpieza">
      <header>
        <p className="text-label-md text-on-surface-variant">{longDate.charAt(0).toUpperCase() + longDate.slice(1)}</p>
        <h1 className="text-headline-xl text-primary">Hola, {firstName(user?.name)}</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          {todays.length + late.length === 0
            ? doneToday.length
              ? '¡Terminaste lo de hoy!'
              : 'Hoy no tienes limpiezas.'
            : `Hoy tienes ${todays.length + late.length} ${todays.length + late.length === 1 ? 'limpieza' : 'limpiezas'}${late.length ? ` (${late.length} atrasada${late.length > 1 ? 's' : ''})` : ''}.`}
        </p>
      </header>

      {late.length > 0 && (
        <section aria-label="Atrasadas" className="space-y-3">
          <h2 className="flex items-center gap-2 text-headline-md text-error">
            <TriangleAlert size={20} aria-hidden /> Atrasadas
          </h2>
          {late.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </section>
      )}

      <section aria-label="Hoy" className="space-y-3">
        <h2 className="text-headline-md text-primary">Hoy</h2>
        {todays.length ? todays.map((t) => <TaskCard key={t.id} task={t} />) : <EmptyState icon={SprayCan} title="Nada para hoy" body="Cuando termine una estadía, su limpieza aparece aquí sola." />}
      </section>

      {route.length > 0 && (
        <section aria-label="Mi ruta de hoy" className="space-y-3">
          <h2 className="flex items-center gap-2 text-headline-md text-primary">
            <Route size={20} aria-hidden /> Mi ruta de hoy
          </h2>
          <RouteCard stops={route} />
        </section>
      )}

      {upcoming.length > 0 && (
        <section aria-label="Próximas" className="space-y-3">
          <h2 className="text-headline-md text-primary">Próximas</h2>
          {upcoming.map((t) => (
            <UpcomingRow key={t.id} task={t} />
          ))}
        </section>
      )}

      <section aria-label="Próximas salidas" className="space-y-3">
        <div>
          <h2 className="text-headline-md text-primary">Próximas salidas</h2>
          <p className="text-body-sm text-on-surface-variant">La tarea se crea sola cuando termina la estadía.</p>
        </div>
        {pendingCheckouts.length ? (
          <Card padding="lg">
            <ul className="divide-y divide-outline-variant/50">
              {pendingCheckouts.map((c) => (
                <CheckoutRow key={c.bookingCode} c={c} />
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-body-sm text-on-surface-variant">No hay salidas en los próximos 7 días.</p>
        )}
      </section>

      <section aria-label="Hechas hoy" className="space-y-3">
        <h2 className="text-headline-md text-primary">Hechas hoy</h2>
        {doneToday.length ? (
          <Card padding="sm">
            <ul className="space-y-1">
              {doneToday.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-md px-2 py-2">
                  <CircleCheck size={22} className="shrink-0 text-secondary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-label-md text-primary">{t.propertyName}</span>
                    <span className="block text-body-sm text-on-surface-variant">
                      {CLEANING_TYPE_LABEL[t.type]} · {t.beforeCount + t.afterCount} fotos
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-body-sm text-on-surface-variant">Todavía ninguna.</p>
        )}
      </section>
    </div>
  );
}
