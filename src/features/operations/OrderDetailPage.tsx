/**
 * Detalle de una orden de mantenimiento: problema, propiedad, quién la atiende, costos y aprobación
 * (si el rol los puede ver), fotos y fechas. Propietario y administración la editan, la asignan,
 * la resuelven o la cancelan; atención al cliente solo mira.
 */
import { Ban, CircleCheck, ExternalLink, Hourglass, MapPin, Repeat, Save, Siren, Truck, UserRound, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAction, useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { MAINTENANCE_CATEGORY_LABEL, ORDER_STATUS_LABEL, PRIORITY_LABEL } from '@/domain/labels';
import { PRIORITIES, type Priority } from '@/domain/types';
import { todayIn } from '@/lib/clock';
import { formatDate } from '@/lib/dates';
import { svc, type OrderView } from '@/services';
import type { OrderPatch } from '@/services/operations';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  CardHeader,
  ErrorState,
  KeyValue,
  Loading,
  Money,
  OrderStatusBadge,
  PageHeader,
  PhotoInput,
  PriorityBadge,
  PropertyImage,
  Select,
  TextInput,
  useConfirm,
} from '@/ui';
import { ApprovalBox, type Threshold } from './Approval';
import { AssignOrderModal } from './AssignModals';
import { materialsTotal } from './MaterialsEditor';
import { ResolveOrderModal } from './ResolveOrderModal';
import { ago, CategoryTile, dayLabel, numberOrUndefined, PhotoGrid, stamp, useOpsAccess } from './shared';

type EditableStatus = 'open' | 'scheduled' | 'in_progress';

/** «Hoy · 5 nov» o «vie 13 nov». */
function scheduledLabel(date: string, today: string): string {
  const label = dayLabel(date, today);
  return ['Hoy', 'Mañana', 'Ayer'].includes(label) ? `${label} · ${formatDate(date)}` : label;
}

function EditOrderCard({ order }: { order: OrderView }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [status, setStatus] = useState<EditableStatus>(order.status as EditableStatus);
  const [priority, setPriority] = useState<Priority>(order.priority);
  const [date, setDate] = useState(order.scheduledDate ?? '');
  const [estimate, setEstimate] = useState(order.estimate != null ? String(order.estimate) : '');
  const est = numberOrUndefined(estimate);
  const patch: OrderPatch = {};
  if (status !== order.status) patch.status = status;
  if (priority !== order.priority) patch.priority = priority;
  if (date && date !== order.scheduledDate) patch.scheduledDate = date;
  if (est != null && est >= 0 && est !== order.estimate) patch.estimate = est;
  const changed = Object.keys(patch).length > 0;
  return (
    <Card padding="lg">
      <CardHeader title="Editar" subtitle="Estado, prioridad, fecha y presupuesto." />
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (changed) await run(() => svc.operations.updateOrder(actor, order.id, patch), { success: 'Cambios guardados' });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Estado"
            value={status}
            onChange={(e) => setStatus(e.target.value as EditableStatus)}
            options={(['open', 'scheduled', 'in_progress'] as const).map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] }))}
          />
          <Select label="Prioridad" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextInput type="date" label="Fecha" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextInput label={`Presupuesto (${order.currency})`} inputMode="decimal" placeholder="0" value={estimate} onChange={(e) => setEstimate(e.target.value)} error={estimate.trim() && (est == null || est < 0) ? 'Número no válido' : undefined} />
        </div>
        <Button type="submit" variant="tonal" icon={Save} fullWidth loading={busy} disabled={!changed}>
          Guardar cambios
        </Button>
      </form>
    </Card>
  );
}

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const run = useAction();
  const confirm = useConfirm();
  const { canManage } = useOpsAccess();
  const res = useLiveResult(() => svc.operations.getOrder(actor, id), [actor, id]);
  const settings = useLive(() => (canManage ? svc.system.getAppSettings(actor) : Promise.resolve(undefined)), [actor, canManage]);
  const [assigning, setAssigning] = useState(false);
  const [resolving, setResolving] = useState(false);

  if (res.loading && !res.data) return <Loading />;
  if (!res.data)
    return (
      <div className="space-y-4">
        <PageHeader title="Orden" back="/operacion" />
        <ErrorState error={res.error ?? 'No se encontró la orden.'} />
      </div>
    );

  const o = res.data;
  const today = todayIn(o.timezone);
  const open = o.status !== 'resolved' && o.status !== 'cancelled';
  const threshold: Threshold | undefined = settings ? { amount: settings.approvalThreshold, currency: settings.baseCurrency } : undefined;
  const reportPhotos = o.photos.filter((p) => p.phase === 'report').map((p) => p.fileId);
  const resolvedPhotos = o.photos.filter((p) => p.phase === 'resolved').map((p) => p.fileId);
  const who = o.assigneeName ?? o.vendorName;

  const cancel = async () => {
    if (!(await confirm({ title: `¿Cancelar ${o.code}?`, body: 'La orden se cierra sin gasto. El técnico deja de verla como pendiente.', confirmLabel: 'Cancelar orden', cancelLabel: 'Volver', danger: true }))) return;
    await run(() => svc.operations.updateOrder(actor, o.id, { status: 'cancelled' }), { success: 'Orden cancelada' });
  };

  return (
    <div className="space-y-6" data-testid="detalle-orden">
      <PageHeader
        back="/operacion"
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label-sm uppercase text-on-surface-variant">{o.code}</span>
            <PriorityBadge priority={o.priority} />
            <OrderStatusBadge status={o.status} />
            {o.overdue && <Badge tone="bad">Atrasada</Badge>}
            {!o.canSeeCost && o.approval.status === 'pending' && (
              <Badge tone="warn" icon={Hourglass}>
                Gasto por aprobar
              </Badge>
            )}
          </div>
        }
        title={o.title}
        subtitle={`${o.propertyName} · ${MAINTENANCE_CATEGORY_LABEL[o.category]}`}
        actions={
          canManage && open ? (
            <>
              <Button variant="success" icon={CircleCheck} onClick={() => setResolving(true)} data-testid="resolver-equipo">
                Resolver
              </Button>
              <Button variant="secondary" icon={Ban} onClick={cancel}>
                Cancelar
              </Button>
            </>
          ) : undefined
        }
      />

      {o.status === 'resolved' && (
        <Banner tone="good" icon={CircleCheck}>
          Resuelta {o.resolvedAt ? stamp(o.resolvedAt, o.timezone) : ''}
          {o.resolutionNote ? ` · «${o.resolutionNote}»` : ''}
        </Banner>
      )}
      {o.status === 'cancelled' && <Banner icon={Ban}>Esta orden se canceló.</Banner>}
      {o.canSeeCost && o.approval.status === 'pending' && <ApprovalBox order={o} threshold={threshold} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card padding="none" className="overflow-hidden">
            <div className="flex flex-col sm:flex-row">
              <PropertyImage src={o.heroSrc} alt={o.propertyName} className="h-40 w-full sm:h-auto sm:w-56" />
              <div className="flex-1 space-y-2 p-4 md:p-5">
                <p className="text-label-sm uppercase text-on-surface-variant">Propiedad</p>
                <p className="text-headline-md text-primary">{o.propertyName}</p>
                <p className="flex items-start gap-1.5 text-body-sm text-on-surface-variant">
                  <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden />
                  {o.propertyAddress}
                  {o.propertyCity ? ` · ${o.propertyCity}` : ''}
                </p>
                <Link to={`/propiedades/${o.propertyId}`} className="inline-flex items-center gap-1 text-label-md text-secondary hover:underline">
                  Ver la propiedad <ExternalLink size={14} aria-hidden />
                </Link>
              </div>
            </div>
          </Card>

          <Card padding="lg">
            <div className="mb-4 flex items-start gap-3">
              <CategoryTile category={o.category} />
              <div className="min-w-0">
                <h2 className="text-headline-md text-primary">El problema</h2>
                <p className="text-body-sm text-on-surface-variant">
                  {MAINTENANCE_CATEGORY_LABEL[o.category]} · reportado {ago(o.createdAt)}
                </p>
              </div>
            </div>
            <p className="text-body-md whitespace-pre-line text-on-surface">{o.description || 'Sin descripción.'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {o.incidentId && (
                <Link to="/operacion/incidencias" className="inline-flex items-center gap-1.5 rounded-full bg-surface-low px-3 py-1.5 text-label-md text-primary hover:bg-surface-container">
                  <Siren size={16} aria-hidden /> Viene de una incidencia
                </Link>
              )}
              {o.preventiveId &&
                (canManage ? (
                  <Link to="/operacion/preventivo" className="inline-flex items-center gap-1.5 rounded-full bg-surface-low px-3 py-1.5 text-label-md text-primary hover:bg-surface-container">
                    <Repeat size={16} aria-hidden /> Preventivo automático
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-low px-3 py-1.5 text-label-md text-primary">
                    <Repeat size={16} aria-hidden /> Preventivo automático
                  </span>
                ))}
            </div>
            <div className="mt-5 space-y-2">
              <p className="text-label-md text-on-surface">Fotos del problema · {reportPhotos.length}</p>
              <PhotoGrid fileIds={reportPhotos} alt="Foto del problema" emptyText="Sin fotos del problema." />
              {canManage && open && (
                <PhotoInput
                  onPhoto={async (blob) => {
                    await run(() => svc.operations.addOrderPhoto(actor, o.id, 'report', blob), { success: 'Foto agregada' });
                  }}
                  label="Agregar foto"
                  size="md"
                  variant="secondary"
                  sample={{ phase: 'report', caption: o.propertyName }}
                />
              )}
            </div>
          </Card>

          {(o.status === 'resolved' || resolvedPhotos.length > 0) && (
            <Card padding="lg">
              <CardHeader title="Lo resuelto" subtitle={o.resolvedAt ? stamp(o.resolvedAt, o.timezone) : 'Fotos que ya subió el técnico.'} />
              <PhotoGrid fileIds={resolvedPhotos} alt="Foto de lo resuelto" emptyText="Sin fotos." />
              {o.resolutionNote && <p className="mt-3 text-body-md text-on-surface">«{o.resolutionNote}»</p>}
            </Card>
          )}

          {canManage && open && <EditOrderCard key={`${o.status}|${o.priority}|${o.scheduledDate ?? ''}|${o.estimate ?? ''}`} order={o} />}
        </div>

        <div className="space-y-6">
          <Card padding="lg">
            <CardHeader title="Quién la atiende" />
            <div className="flex items-center gap-3">
              {o.assigneeName ? (
                <Avatar name={o.assigneeName} />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-container text-primary">
                  {o.vendorName ? <Truck size={20} aria-hidden /> : <UserRound size={20} aria-hidden />}
                </span>
              )}
              <div className="min-w-0">
                <p className={who ? 'text-label-md text-primary' : 'text-label-md text-error'}>{who ?? 'Sin asignar'}</p>
                {o.assigneeName && o.vendorName && <p className="text-body-sm text-on-surface-variant">{o.vendorName}</p>}
              </div>
            </div>
            <dl className="mt-3">
              <KeyValue
                label="Programada"
                value={
                  o.scheduledDate ? (
                    <span className={o.overdue ? 'text-error' : undefined}>{scheduledLabel(o.scheduledDate, today)}</span>
                  ) : (
                    'Sin fecha'
                  )
                }
              />
              <KeyValue label="Creada" value={stamp(o.createdAt, o.timezone)} />
              {o.resolvedAt && <KeyValue label="Resuelta" value={stamp(o.resolvedAt, o.timezone)} />}
            </dl>
            {canManage && open && (
              <Button variant="primary" fullWidth className="mt-4" icon={Wrench} onClick={() => setAssigning(true)} data-testid="asignar-orden">
                {who ? 'Reasignar' : 'Asignar técnico'}
              </Button>
            )}
          </Card>

          {o.canSeeCost && (
            <Card padding="lg">
              <CardHeader title="Costos" />
              <dl>
                <KeyValue label="Presupuesto" value={o.estimate != null ? <Money amount={o.estimate} currency={o.currency} /> : '—'} />
                <KeyValue label="Costo real" value={o.actualCost != null ? <Money amount={o.actualCost} currency={o.currency} className="font-bold" /> : '—'} />
              </dl>
              {o.materials.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-label-md text-on-surface">Materiales</p>
                  <ul className="space-y-1">
                    {o.materials.map((m, i) => (
                      <li key={i} className="flex justify-between gap-3 text-body-sm">
                        <span className="text-on-surface">
                          {m.name} <span className="text-on-surface-variant">× {m.qty}</span>
                        </span>
                        <Money amount={m.cost} currency={o.currency} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-right text-label-sm text-on-surface-variant">Total {<Money amount={materialsTotal(o.materials)} currency={o.currency} />}</p>
                </div>
              )}
              {o.approval.status !== 'pending' && (
                <div className="mt-4">
                  <ApprovalBox order={o} threshold={threshold} />
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {assigning && <AssignOrderModal order={o} onClose={() => setAssigning(false)} />}
      {resolving && <ResolveOrderModal order={o} onClose={() => setResolving(false)} />}
    </div>
  );
}
