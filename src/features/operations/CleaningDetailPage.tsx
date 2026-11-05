/**
 * Detalle de una limpieza (equipo): propiedad, tipo, fecha, quién la hace, avance de la checklist,
 * fotos de antes y después, faltantes, incidencias, pago y notas. Propietario y administración
 * pueden reasignarla o cancelarla.
 */
import { Ban, CalendarClock, CircleCheck, Circle, DoorOpen, LogOut, MapPin, PackageX, Siren, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { CLEANING_TYPE_LABEL } from '@/domain/labels';
import { todayIn } from '@/lib/clock';
import { formatDateTime } from '@/lib/dates';
import { svc } from '@/services';
import { Badge, Button, Card, CardHeader, CleaningStatusBadge, ErrorState, KeyValue, Loading, Money, PageHeader, PriorityBadge, ProgressBar, PropertyImage, useConfirm } from '@/ui';
import { AssignCleaningModal } from './AssignModals';
import { ago, firstName, INCIDENT_STATUS_LABEL, PhotoGrid, useOpsAccess, whenLabel } from './shared';

export default function CleaningDetailPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const run = useAction();
  const confirm = useConfirm();
  const { canManage } = useOpsAccess();
  const res = useLiveResult(() => svc.operations.getCleaning(actor, id), [actor, id]);
  const incidents = useLive(() => svc.operations.listIncidents(actor), [actor]);
  const [assigning, setAssigning] = useState(false);

  if (res.loading && !res.data) return <Loading />;
  if (!res.data)
    return (
      <div className="space-y-4">
        <PageHeader title="Limpieza" back="/operacion" />
        <ErrorState error={res.error ?? 'No se encontró la tarea.'} />
      </div>
    );

  const t = res.data;
  const today = todayIn(t.timezone);
  const total = t.items.length;
  const open = t.status === 'pending' || t.status === 'in_progress';
  const linked = (incidents ?? []).filter((i) => i.cleaningTaskId === t.id || t.incidentIds.includes(i.id));
  const before = t.photos.filter((p) => p.phase === 'before').map((p) => p.fileId);
  const after = t.photos.filter((p) => p.phase === 'after').map((p) => p.fileId);
  const rooms = t.items.reduce<{ room: string; items: { label: string; done: boolean }[] }[]>((acc, it) => {
    const last = acc[acc.length - 1];
    if (last && last.room === it.room) last.items.push(it);
    else acc.push({ room: it.room, items: [it] });
    return acc;
  }, []);

  const cancel = async () => {
    if (!(await confirm({ title: '¿Cancelar esta limpieza?', body: 'La persona asignada ya no la verá en sus tareas.', confirmLabel: 'Cancelar tarea', cancelLabel: 'Volver', danger: true }))) return;
    await run(() => svc.operations.cancelCleaning(actor, t.id), { success: 'Limpieza cancelada' });
  };

  return (
    <div className="space-y-6" data-testid="detalle-limpieza">
      <PageHeader
        back="/operacion"
        eyebrow={<p className="text-label-sm uppercase text-on-surface-variant">{CLEANING_TYPE_LABEL[t.type]}</p>}
        title={t.propertyName}
        subtitle={whenLabel(t.date, t.time, today)}
        actions={
          canManage && open ? (
            <Button variant="secondary" icon={Ban} onClick={cancel}>
              Cancelar tarea
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card padding="none" className="overflow-hidden">
            <PropertyImage src={t.heroSrc} alt={t.propertyName} className="h-48 w-full md:h-56" />
            <div className="p-4 md:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <CleaningStatusBadge status={t.status} />
                {t.priority === 'high' ? <Badge tone="bad">Prioridad alta</Badge> : <Badge>Prioridad normal</Badge>}
                {t.overdue && <Badge tone="bad">Atrasada</Badge>}
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-body-sm text-on-surface-variant">
                <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden /> {t.propertyAddress}
                {t.propertyCity ? ` · ${t.propertyCity}` : ''}
              </p>
              <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
                <KeyValue label="Fecha" value={whenLabel(t.date, t.time, today)} />
                <KeyValue
                  label="Hace la limpieza"
                  value={
                    <span className="inline-flex items-center gap-2">
                      <UserRound size={16} aria-hidden className="text-on-surface-variant" />
                      {t.assigneeName ?? <span className="text-error">Sin asignar</span>}
                    </span>
                  }
                />
                {t.guestName && (
                  <KeyValue
                    label="Sale"
                    value={
                      <span className="inline-flex items-center gap-2">
                        <LogOut size={16} aria-hidden className="text-on-surface-variant" />
                        {firstName(t.guestName)}
                      </span>
                    }
                  />
                )}
                {t.nextCheckIn && (
                  <KeyValue
                    label="Próxima entrada"
                    value={
                      <span className="inline-flex items-center gap-2">
                        <DoorOpen size={16} aria-hidden className="text-on-surface-variant" />
                        {whenLabel(t.nextCheckIn.date, t.nextCheckIn.time, today)}
                      </span>
                    }
                  />
                )}
                {t.startedAt && <KeyValue label="Empezó" value={formatDateTime(t.startedAt, t.timezone)} />}
                {t.completedAt && <KeyValue label="Terminó" value={formatDateTime(t.completedAt, t.timezone)} />}
                {canManage && <KeyValue label="Pago de la tarea" value={<Money amount={t.fee} currency={t.currency} />} />}
              </dl>
              {canManage && open && (
                <Button variant="tonal" className="mt-4 w-full sm:w-auto" icon={UserRound} onClick={() => setAssigning(true)} data-testid="reasignar-limpieza">
                  {t.assigneeId ? 'Reasignar' : 'Asignar'}
                </Button>
              )}
            </div>
          </Card>

          <Card padding="lg">
            <CardHeader title="Fotos" subtitle="Obligatorias para cerrar: al menos una de antes y una de después." />
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="mb-2 text-label-md text-on-surface">Antes · {before.length}</p>
                <PhotoGrid fileIds={before} alt="Foto de antes" emptyText="Sin fotos todavía." />
              </div>
              <div>
                <p className="mb-2 text-label-md text-on-surface">Después · {after.length}</p>
                <PhotoGrid fileIds={after} alt="Foto de después" emptyText="Sin fotos todavía." />
              </div>
            </div>
          </Card>

          <Card padding="lg">
            <CardHeader title="Checklist" subtitle={`${t.doneCount} de ${total} puntos hechos`} />
            <ProgressBar value={total ? t.doneCount / total : 0} label="Avance de la checklist" />
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {rooms.map((r) => (
                <div key={r.room}>
                  <p className="mb-2 text-label-md text-primary">
                    {r.room} <span className="font-normal text-on-surface-variant">· {r.items.filter((i) => i.done).length} de {r.items.length}</span>
                  </p>
                  <ul className="space-y-1.5">
                    {r.items.map((it, i) => (
                      <li key={i} className="flex items-start gap-2 text-body-sm">
                        {it.done ? <CircleCheck size={18} className="mt-0.5 shrink-0 text-secondary" aria-hidden /> : <Circle size={18} className="mt-0.5 shrink-0 text-outline" aria-hidden />}
                        <span className={it.done ? 'text-on-surface-variant' : 'text-on-surface'}>
                          <span className="sr-only">{it.done ? 'Hecho: ' : 'Pendiente: '}</span>
                          {it.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card padding="lg">
            <CardHeader title="Faltantes" subtitle="Lo que reportó la limpieza." />
            {t.supplies.length ? (
              <ul className="space-y-2">
                {t.supplies.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-body-sm">
                    <PackageX size={18} className="mt-0.5 shrink-0 text-on-warning-container" aria-hidden />
                    <span className="flex-1 text-on-surface">{s.item}</span>
                    <span className="shrink-0 text-on-surface-variant">{ago(s.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-on-surface-variant">Nada reportado.</p>
            )}
          </Card>

          <Card padding="lg">
            <CardHeader title="Incidencias" subtitle="Daños o faltantes que se volvieron reporte." />
            {linked.length ? (
              <ul className="space-y-2">
                {linked.map((i) => (
                  <li key={i.id}>
                    <Link to={i.maintenanceOrderId ? `/operacion/mantenimiento/${i.maintenanceOrderId}` : '/operacion/incidencias'} className="flex items-start gap-3 rounded-md bg-surface-low p-3 hover:bg-surface-container">
                      <Siren size={18} className="mt-0.5 shrink-0 text-error" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-label-md text-primary">{i.title}</span>
                        <span className="block text-body-sm text-on-surface-variant">
                          {INCIDENT_STATUS_LABEL[i.status]}
                          {i.orderCode ? ` · orden ${i.orderCode}` : ''}
                        </span>
                      </span>
                      <PriorityBadge priority={i.severity} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-on-surface-variant">Ninguna.</p>
            )}
          </Card>

          <Card padding="lg">
            <CardHeader title="Notas" />
            <p className="text-body-sm whitespace-pre-line text-on-surface">{t.notes || <span className="text-on-surface-variant">Sin notas.</span>}</p>
            <p className="mt-3 flex items-center gap-1.5 text-label-sm font-normal text-on-surface-variant">
              <CalendarClock size={14} aria-hidden /> Creada {ago(t.createdAt)}
              {t.createdBy === 'system' && t.type === 'checkout' ? ' · sola, al terminar la estadía' : ''}
            </p>
          </Card>
        </div>
      </div>

      {assigning && <AssignCleaningModal task={t} onClose={() => setAssigning(false)} />}
    </div>
  );
}
