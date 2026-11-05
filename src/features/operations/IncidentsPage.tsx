/**
 * Incidencias: lo que reportan huéspedes, inquilinos, limpieza y el equipo. El equipo (también
 * atención al cliente) las convierte en orden asignada o las descarta.
 */
import { ArrowRight, Ban, CircleCheck, Siren, TriangleAlert, UserRound, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAction, useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { MAINTENANCE_CATEGORY_LABEL } from '@/domain/labels';
import type { Incident, Priority } from '@/domain/types';
import { svc, type IncidentView } from '@/services';
import { Badge, Button, EmptyState, Loading, Modal, PageHeader, PriorityBadge, Tabs, TextInput, useConfirm, useToast } from '@/ui';
import { assigneeName, assigneePayload, AssigneeOptions, type AssigneeValue } from './AssignModals';
import { ReportProblemModal } from './ReportProblemModal';
import { ago, CATEGORY_ICON, INCIDENT_KIND_LABEL, INCIDENT_SOURCE_LABEL, PhotoGrid, PriorityPicker, useFieldStaff, useOpsAccess } from './shared';

type Tab = Incident['status'];

const TABS: { id: Tab; label: string }[] = [
  { id: 'open', label: 'Abiertas' },
  { id: 'in_progress', label: 'En curso' },
  { id: 'resolved', label: 'Resueltas' },
  { id: 'dismissed', label: 'Descartadas' },
];

function AssignIncidentModal({ incident, onClose }: { incident: IncidentView; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const staff = useFieldStaff();
  const [run, busy] = useBusyAction();
  const [priority, setPriority] = useState<Priority>(incident.severity);
  const [value, setValue] = useState<AssigneeValue>('');
  const [date, setDate] = useState('');
  const submit = async () => {
    const order = await run(() => svc.operations.assignIncident(actor, incident.id, { priority, ...assigneePayload(value, staff.technicians), scheduledDate: date || undefined }));
    if (!order) return;
    const who = assigneeName(value, staff.technicians, staff.vendors);
    toast.success(`Orden ${order.code} creada${who ? ` para ${who}` : ''}`);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Crear orden y asignar"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} icon={Wrench} data-testid="crear-orden-incidencia">
            Crear orden
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-md bg-surface-low p-4">
          <p className="text-label-sm uppercase text-on-surface-variant">{incident.propertyName}</p>
          <p className="mt-1 text-label-md text-primary">{incident.title}</p>
          {incident.description && <p className="mt-1 text-body-sm text-on-surface-variant">{incident.description}</p>}
        </div>
        <PriorityPicker name={`prioridad-${incident.id}`} label="Prioridad" value={priority} onChange={setPriority} />
        <AssigneeOptions value={value} onChange={setValue} category={incident.category} name={`quien-${incident.id}`} allowAuto />
        <TextInput type="date" label="Fecha programada (opcional)" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Modal>
  );
}

function IncidentCard({ incident: i, canTriage, onAssign, onDismiss }: { incident: IncidentView; canTriage: boolean; onAssign: () => void; onDismiss: () => void }) {
  const Icon = CATEGORY_ICON[i.category];
  const actionable = canTriage && i.status === 'open' && !i.maintenanceOrderId;
  return (
    <article className="flex flex-col rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 shadow-card md:p-5" data-testid={`incidencia-${i.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={i.severity} />
        <Badge tone="neutral">{INCIDENT_KIND_LABEL[i.kind]}</Badge>
        <Badge tone="info">{INCIDENT_SOURCE_LABEL[i.source]}</Badge>
      </div>
      <h3 className="mt-3 flex items-start gap-2 text-headline-md text-primary">
        <Icon size={20} className="mt-1 shrink-0" aria-hidden />
        <span>{i.title}</span>
      </h3>
      <p className="mt-1 text-body-sm text-on-surface-variant">
        {i.propertyName} · {MAINTENANCE_CATEGORY_LABEL[i.category]}
      </p>
      {i.description && <p className="mt-2 line-clamp-3 text-body-sm text-on-surface">{i.description}</p>}
      <p className="mt-2 flex items-center gap-1.5 text-body-sm text-on-surface-variant">
        <UserRound size={16} aria-hidden />
        {i.reporterName} ({INCIDENT_SOURCE_LABEL[i.source].toLowerCase()}) · {ago(i.createdAt)}
      </p>
      {i.photos.length > 0 && <PhotoGrid fileIds={i.photos} alt={`Foto de «${i.title}»`} size="sm" className="mt-3" />}
      <div className="mt-auto pt-4">
        {i.maintenanceOrderId ? (
          <Link to={`/operacion/mantenimiento/${i.maintenanceOrderId}`} className="flex items-center justify-between gap-2 rounded-md bg-surface-low px-3 py-2.5 text-label-md text-primary hover:bg-surface-container">
            <span className="flex items-center gap-2">
              <Wrench size={16} aria-hidden /> Orden {i.orderCode ?? ''}
            </span>
            <ArrowRight size={16} aria-hidden />
          </Link>
        ) : actionable ? (
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" size="sm" icon={Wrench} onClick={onAssign} data-testid={`asignar-incidencia-${i.id}`}>
              Crear orden y asignar
            </Button>
            <Button variant="secondary" size="sm" icon={Ban} onClick={onDismiss}>
              Descartar
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function IncidentsPage() {
  const actor = useActor();
  const run = useAction();
  const confirm = useConfirm();
  const { canTriage } = useOpsAccess();
  const incidents = useLive(() => svc.operations.listIncidents(actor), [actor]);
  const [tab, setTab] = useState<Tab>('open');
  const [assigning, setAssigning] = useState<IncidentView | null>(null);
  const [reporting, setReporting] = useState(false);

  if (!incidents) return <Loading />;
  const count = (s: Tab) => incidents.filter((i) => i.status === s).length;
  const list = incidents.filter((i) => i.status === tab);

  const dismiss = async (i: IncidentView) => {
    if (!(await confirm({ title: '¿Descartar esta incidencia?', body: `«${i.title}» no se volverá orden. Queda en Descartadas.`, confirmLabel: 'Descartar', cancelLabel: 'Volver', danger: true }))) return;
    await run(() => svc.operations.dismissIncident(actor, i.id), { success: 'Incidencia descartada' });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        back="/operacion"
        title="Incidencias"
        subtitle="Lo que reportan huéspedes, inquilinos, la limpieza y el equipo. Las urgentes y altas se vuelven orden solas."
        actions={
          canTriage ? (
            <Button variant="secondary" icon={TriangleAlert} onClick={() => setReporting(true)}>
              Reportar problema
            </Button>
          ) : undefined
        }
      />
      <Tabs ariaLabel="Estado de las incidencias" value={tab} onChange={setTab} tabs={TABS.map((t) => ({ ...t, count: count(t.id) }))} className="w-full sm:w-fit" />
      {list.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((i) => (
            <IncidentCard key={i.id} incident={i} canTriage={canTriage} onAssign={() => setAssigning(i)} onDismiss={() => dismiss(i)} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={tab === 'open' ? CircleCheck : Siren}
          title={tab === 'open' ? 'Nada por atender' : 'No hay incidencias aquí'}
          body={tab === 'open' ? 'Cuando alguien reporte un problema, aparece aquí para asignarlo.' : undefined}
        />
      )}
      {assigning && <AssignIncidentModal incident={assigning} onClose={() => setAssigning(null)} />}
      {reporting && <ReportProblemModal onClose={() => setReporting(false)} />}
    </div>
  );
}
