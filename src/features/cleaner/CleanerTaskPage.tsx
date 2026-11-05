/**
 * Tarea de limpieza (en el teléfono): la cámara primero (fotos de antes y de después), la checklist
 * por cuarto con casillas grandes, «¿Falta algo?», «Reportar daño», notas y «Terminar limpieza»
 * (se habilita con todo marcado y al menos una foto de antes y una de después).
 */
import { ArrowLeft, Check, CheckCheck, CircleCheck, Clock, DoorOpen, LogOut, MapPin, PackageX, Plus, Save, Siren, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAction, useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLiveResult } from '@/data/live';
import { CLEANING_TYPE_LABEL } from '@/domain/labels';
import { todayIn } from '@/lib/clock';
import { formatDateTime } from '@/lib/dates';
import { svc, type CleaningTaskView } from '@/services';
import { Badge, Banner, Button, Card, cn, ErrorState, LinkButton, Loading, PhotoInput, ProgressBar, PropertyImage, TextArea, TextInput } from '@/ui';
import { ago, firstName, PhotoGrid, Requirements, timeLabel, whenLabel } from '@/features/operations/shared';
import { nextArrivalText } from './arrival';
import { DamageModal } from './DamageModal';

const QUICK_SUPPLIES = ['Papel higiénico', 'Jabón de manos', 'Café', 'Bolsas de basura', 'Detergente', 'Toallas'];

type Phase = 'before' | 'after';

function BackLink() {
  return (
    <Link to="/limpieza" className="-ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-label-md text-on-surface-variant hover:bg-surface-low">
      <ArrowLeft size={18} aria-hidden /> Mis tareas
    </Link>
  );
}

function TaskHeader({ task }: { task: CleaningTaskView }) {
  const today = todayIn(task.timezone);
  const arrival = nextArrivalText(task, today);
  return (
    <header className="space-y-3">
      <BackLink />
      <div className="relative overflow-hidden rounded-lg">
        <PropertyImage src={task.heroSrc} alt={task.propertyName} className="h-32 w-full sm:h-40" />
        <div className="absolute inset-0 bg-image-scrim" aria-hidden />
        <div className="absolute inset-x-0 bottom-0 p-4 text-on-image">
          <p className="flex items-center gap-1.5 text-label-md">
            <Clock size={16} aria-hidden /> {whenLabel(task.date, task.time, today)} · {CLEANING_TYPE_LABEL[task.type]}
          </p>
          <h1 className="text-headline-lg">{task.propertyName}</h1>
        </div>
        <div className="absolute top-3 left-3 flex gap-1.5">
          {task.priority === 'high' && <Badge tone="bad">Prioridad alta</Badge>}
          {task.overdue && <Badge tone="bad">Atrasada</Badge>}
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-body-sm text-on-surface-variant">
        <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden /> {task.propertyAddress}
      </p>
      {(task.guestName || arrival) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 rounded-md bg-surface-low px-4 py-3">
          {task.guestName && (
            <p className="flex items-center gap-2 text-body-md text-on-surface">
              <LogOut size={18} className="text-on-surface-variant" aria-hidden />
              Sale {firstName(task.guestName)}
              {task.type === 'checkout' ? ` a las ${timeLabel(task.time)}` : ''}
            </p>
          )}
          {arrival && (
            <p className={cn('flex items-center gap-2 text-body-md', task.nextCheckIn?.date === task.date ? 'font-semibold text-on-warning-container' : 'text-on-surface')}>
              <DoorOpen size={18} aria-hidden /> {arrival}
            </p>
          )}
        </div>
      )}
    </header>
  );
}

function PhotoSection({ task, phase, step }: { task: CleaningTaskView; phase: Phase; step: number }) {
  const actor = useActor();
  const run = useAction();
  const ids = task.photos.filter((p) => p.phase === phase).map((p) => p.fileId);
  const before = phase === 'before';
  const title = before ? 'Fotos de antes' : 'Fotos de después';
  return (
    <Card padding="lg" as="section" aria-label={title} data-testid={before ? 'seccion-antes' : 'seccion-despues'} className="flex flex-col">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-headline-md text-primary">
          <span className="text-on-surface-variant">{step}.</span> {title}
        </h2>
        {ids.length > 0 ? (
          <Badge tone="good" icon={Check}>
            {ids.length}
          </Badge>
        ) : (
          <Badge tone="warn">Falta</Badge>
        )}
      </div>
      <p className="mb-4 text-body-sm text-on-surface-variant">{before ? 'Cómo encontraste cada cuarto, antes de tocar nada.' : 'Cómo queda todo al terminar.'}</p>
      <PhotoGrid fileIds={ids} alt={before ? 'Foto de antes' : 'Foto de después'} onRemove={(fileId) => run(() => svc.operations.removeCleaningPhoto(actor, task.id, fileId))} className="mb-4" />
      <div className="mt-auto [&_button:first-of-type]:w-full">
        <PhotoInput
          onPhoto={async (blob) => {
            await run(() => svc.operations.addCleaningPhoto(actor, task.id, phase, blob));
          }}
          label={ids.length ? 'Otra foto' : before ? 'Tomar foto de antes' : 'Tomar foto de después'}
          variant={ids.length ? 'secondary' : 'primary'}
          sample={{ phase, caption: task.propertyName }}
          testId={before ? 'foto-antes' : 'foto-despues'}
        />
      </div>
    </Card>
  );
}

function ChecklistSection({ task }: { task: CleaningTaskView }) {
  const actor = useActor();
  const run = useAction();
  const [markingAll, setMarkingAll] = useState(false);
  const total = task.items.length;
  const rooms = task.items.reduce<{ room: string; items: { label: string; done: boolean; index: number }[] }[]>((acc, it, index) => {
    const last = acc[acc.length - 1];
    const item = { label: it.label, done: it.done, index };
    if (last && last.room === it.room) last.items.push(item);
    else acc.push({ room: it.room, items: [item] });
    return acc;
  }, []);
  const markAll = async () => {
    setMarkingAll(true);
    try {
      for (const [i, it] of task.items.entries()) {
        if (it.done) continue;
        const ok = await run(() => svc.operations.setCleaningItem(actor, task.id, i, true));
        if (!ok) break;
      }
    } finally {
      setMarkingAll(false);
    }
  };
  return (
    <Card padding="lg" as="section" aria-label="Checklist">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-headline-md text-primary">Checklist</h2>
        <p className="tabular text-label-md text-on-surface" data-testid="avance-checklist">
          {task.doneCount} de {total}
        </p>
      </div>
      <ProgressBar value={total ? task.doneCount / total : 0} className="mt-3" label="Avance de la checklist" />
      {task.doneCount < total && (
        <Button variant="tonal" size="sm" icon={CheckCheck} className="mt-4" onClick={markAll} loading={markingAll} data-testid="marcar-todo">
          Marcar todo
        </Button>
      )}
      <div className="mt-5 space-y-6">
        {rooms.map((r) => (
          <div key={r.room}>
            <h3 className="mb-2 text-label-md text-primary">
              {r.room} <span className="font-normal text-on-surface-variant">· {r.items.filter((i) => i.done).length} de {r.items.length}</span>
            </h3>
            <ul className="space-y-2">
              {r.items.map((it) => (
                <li key={it.index}>
                  <label
                    className={cn(
                      'flex min-h-14 cursor-pointer items-center gap-4 rounded-md border px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
                      it.done ? 'border-secondary/40 bg-secondary-container/25' : 'border-outline-variant bg-surface-lowest hover:bg-surface-low',
                    )}
                  >
                    <input type="checkbox" className="sr-only" checked={it.done} onChange={(e) => run(() => svc.operations.setCleaningItem(actor, task.id, it.index, e.target.checked))} data-testid={`punto-${it.index}`} />
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2', it.done ? 'border-secondary bg-secondary text-on-secondary' : 'border-outline bg-surface-lowest')} aria-hidden>
                      {it.done && <Check size={20} strokeWidth={3} />}
                    </span>
                    <span className={cn('text-body-md', it.done ? 'text-on-surface-variant line-through' : 'text-on-surface')}>{it.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SuppliesSection({ task }: { task: CleaningTaskView }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [item, setItem] = useState('');
  const reported = (name: string) => task.supplies.some((s) => s.item.toLowerCase() === name.toLowerCase());
  const add = async (name: string) => {
    const done = await run(() => svc.operations.reportSupply(actor, task.id, name), { success: `Avisaste: ${name}` });
    if (done) setItem('');
  };
  return (
    <Card padding="lg" as="section" aria-label="¿Falta algo?">
      <h2 className="text-headline-md text-primary">¿Falta algo?</h2>
      <p className="mb-4 text-body-sm text-on-surface-variant">Avisa qué hay que reponer. Le llega al equipo.</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK_SUPPLIES.map((s) => {
          const on = reported(s);
          return (
            <button
              key={s}
              type="button"
              disabled={on || busy}
              onClick={() => add(s)}
              className={cn('inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-label-md transition-colors', on ? 'border-secondary/40 bg-secondary-container text-on-secondary-container' : 'border-outline-variant text-primary hover:bg-surface-low disabled:opacity-60')}
            >
              {on ? <Check size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
              {s}
            </button>
          );
        })}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (item.trim().length >= 2) void add(item.trim());
        }}
      >
        <TextInput aria-label="Qué falta" placeholder="Otra cosa (ej. toallas de cocina)" value={item} onChange={(e) => setItem(e.target.value)} />
        <Button type="submit" size="md" className="shrink-0" loading={busy} disabled={item.trim().length < 2}>
          Agregar
        </Button>
      </form>
      {task.supplies.length > 0 && (
        <ul className="mt-4 space-y-2">
          {task.supplies.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-body-sm">
              <PackageX size={18} className="shrink-0 text-on-warning-container" aria-hidden />
              <span className="flex-1 text-on-surface">{s.item}</span>
              <span className="text-on-surface-variant">{ago(s.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NotesSection({ task }: { task: CleaningTaskView }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [notes, setNotes] = useState(task.notes);
  const changed = notes !== task.notes;
  return (
    <Card padding="lg" as="section" aria-label="Notas">
      <h2 className="mb-3 flex items-center gap-2 text-headline-md text-primary">
        <StickyNote size={20} aria-hidden /> Notas
      </h2>
      <TextArea aria-label="Notas de la limpieza" placeholder="Algo que el equipo deba saber" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      {changed && (
        <Button variant="tonal" icon={Save} className="mt-3" loading={busy} onClick={() => run(() => svc.operations.setCleaningNotes(actor, task.id, notes.trim()), { success: 'Nota guardada' })}>
          Guardar nota
        </Button>
      )}
    </Card>
  );
}

function FinishedScreen({ task }: { task: CleaningTaskView }) {
  const today = todayIn(task.timezone);
  const arrival = nextArrivalText(task, today);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-10 text-center" data-testid="limpieza-lista">
      <span className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
        <CircleCheck size={56} aria-hidden />
      </span>
      <h1 className="mt-6 text-headline-xl text-primary">¡Lista!</h1>
      <p className="mt-2 text-body-lg text-on-surface">La propiedad quedó lista para el próximo huésped.</p>
      <p className="mt-1 text-body-md text-on-surface-variant">
        {task.propertyName} · {task.items.length} de {task.items.length} · {task.beforeCount + task.afterCount} fotos
      </p>
      {arrival && <p className="mt-3 rounded-md bg-surface-low px-4 py-2 text-body-md text-on-surface">{arrival}</p>}
      <LinkButton to="/limpieza" size="lg" fullWidth className="mt-8" data-testid="volver-mis-tareas">
        Volver a mis tareas
      </LinkButton>
    </div>
  );
}

function DoneSummary({ task }: { task: CleaningTaskView }) {
  const before = task.photos.filter((p) => p.phase === 'before').map((p) => p.fileId);
  const after = task.photos.filter((p) => p.phase === 'after').map((p) => p.fileId);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <TaskHeader task={task} />
      <Banner tone="good" icon={CircleCheck}>
        Terminaste esta limpieza{task.completedAt ? ` · ${formatDateTime(task.completedAt, task.timezone)}` : ''}.
      </Banner>
      <Card padding="lg">
        <h2 className="mb-3 text-headline-md text-primary">Fotos</h2>
        <p className="mb-2 text-label-md text-on-surface">Antes</p>
        <PhotoGrid fileIds={before} alt="Foto de antes" emptyText="Sin fotos." className="mb-4" />
        <p className="mb-2 text-label-md text-on-surface">Después</p>
        <PhotoGrid fileIds={after} alt="Foto de después" emptyText="Sin fotos." />
      </Card>
      <LinkButton to="/limpieza" variant="secondary" size="lg" fullWidth>
        Volver a mis tareas
      </LinkButton>
    </div>
  );
}

export default function CleanerTaskPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const run = useAction();
  const res = useLiveResult(() => svc.operations.getCleaning(actor, id), [actor, id]);
  const [finishedId, setFinishedId] = useState<string>();
  const [finishing, setFinishing] = useState(false);
  const [reporting, setReporting] = useState(false);

  if (res.loading && !res.data) return <Loading />;
  if (!res.data)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink />
        <ErrorState error={res.error ?? 'No se encontró la tarea.'} />
      </div>
    );

  const t = res.data;
  if (finishedId === t.id) return <FinishedScreen task={t} />;
  if (t.status === 'done') return <DoneSummary task={t} />;
  if (t.status === 'cancelled')
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <TaskHeader task={t} />
        <Banner tone="warn">El equipo canceló esta limpieza. Ya no tienes que hacerla.</Banner>
      </div>
    );

  const total = t.items.length;
  const ready = t.beforeCount > 0 && t.afterCount > 0 && t.doneCount === total;
  const finish = async () => {
    setFinishing(true);
    const done = await run(() => svc.operations.completeCleaning(actor, t.id));
    setFinishing(false);
    if (done) {
      setFinishedId(t.id);
      window.scrollTo({ top: 0 });
    }
  };

  return (
    <div key={t.id} className="mx-auto max-w-2xl space-y-5" data-testid="tarea-limpieza">
      <TaskHeader task={t} />
      {t.notes && (
        <Banner icon={StickyNote} tone="warn">
          {t.notes}
        </Banner>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <PhotoSection task={t} phase="before" step={1} />
        <PhotoSection task={t} phase="after" step={2} />
      </div>

      <ChecklistSection task={t} />

      <SuppliesSection task={t} />

      <Card padding="lg" as="section" aria-label="Reportar daño" accent="bad">
        <h2 className="text-headline-md text-primary">¿Algo roto?</h2>
        <p className="mb-4 text-body-sm text-on-surface-variant">Un daño o algo de la casa que falta: con foto, le llega al equipo y, si es urgente, al técnico.</p>
        <button
          type="button"
          onClick={() => setReporting(true)}
          className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-md border-2 border-error bg-error-container px-6 text-body-md font-semibold text-on-error-container transition-transform active:scale-[0.98]"
          data-testid="reportar-dano"
        >
          <Siren size={22} aria-hidden /> Reportar daño
        </button>
        {t.incidentIds.length > 0 && (
          <p className="mt-3 text-body-sm text-on-surface-variant">
            Ya reportaste {t.incidentIds.length} {t.incidentIds.length === 1 ? 'cosa' : 'cosas'} en esta limpieza.
          </p>
        )}
      </Card>

      <NotesSection key={t.notes} task={t} />

      <Card padding="lg" as="section" aria-label="Terminar">
        <h2 className="mb-3 text-headline-md text-primary">Para terminar</h2>
        <Requirements
          className="mb-5"
          items={[
            { ok: t.beforeCount > 0, label: 'Al menos 1 foto de antes' },
            { ok: t.afterCount > 0, label: 'Al menos 1 foto de después' },
            { ok: t.doneCount === total, label: `Checklist completa (${t.doneCount} de ${total})` },
          ]}
        />
        <Button variant="success" size="lg" fullWidth icon={CircleCheck} disabled={!ready} loading={finishing} onClick={finish} data-testid="terminar-limpieza">
          Terminar limpieza
        </Button>
        {!ready && <p className="mt-2 text-center text-body-sm text-on-surface-variant">Se activa cuando esté todo lo de arriba.</p>}
      </Card>

      {reporting && <DamageModal task={t} onClose={() => setReporting(false)} />}
    </div>
  );
}
