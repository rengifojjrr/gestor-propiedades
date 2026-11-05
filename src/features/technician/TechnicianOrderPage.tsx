/**
 * Orden del técnico (en el teléfono): dónde es y cómo llegar, el problema con sus fotos,
 * «Empezar trabajo», presupuesto (con aviso de aprobación), materiales, foto de lo resuelto,
 * costo real y «Marcar como resuelta». Las resueltas muestran un resumen.
 */
import { ArrowLeft, Ban, CalendarClock, CircleCheck, ExternalLink, Hourglass, MapPin, Navigation, Play, Save, Wrench } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAction, useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { MAINTENANCE_CATEGORY_LABEL } from '@/domain/labels';
import { todayIn } from '@/lib/clock';
import { formatMoney } from '@/lib/money';
import { svc, type OrderView } from '@/services';
import { Badge, Banner, Button, Card, cn, ErrorState, Loading, Money, OrderStatusBadge, PhotoInput, PriorityBadge, PropertyImage, TextArea, TextInput, useToast } from '@/ui';
import { fromRows, materialsTotal, MaterialsEditor, toRows, type MaterialRow } from '@/features/operations/MaterialsEditor';
import { resolvedMessage } from '@/features/operations/ResolveOrderModal';
import { dayLabel, mapsDirUrl, numberOrUndefined, PhotoGrid, Requirements, stamp } from '@/features/operations/shared';

function BackLink() {
  return (
    <Link to="/tecnico" className="-ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-label-md text-on-surface-variant hover:bg-surface-low">
      <ArrowLeft size={18} aria-hidden /> Mis órdenes
    </Link>
  );
}

function OrderHeader({ order: o }: { order: OrderView }) {
  const actor = useActor();
  const property = useLive(() => svc.properties.getProperty(actor, o.propertyId), [actor, o.propertyId]);
  const today = todayIn(o.timezone);
  const directions = property ? mapsDirUrl([{ lat: property.lat, lng: property.lng }]) : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.propertyAddress}, ${o.propertyCity}`)}`;
  return (
    <header className="space-y-3">
      <BackLink />
      <div className="relative overflow-hidden rounded-lg">
        <PropertyImage src={o.heroSrc} alt={o.propertyName} className="h-36 w-full sm:h-44" />
        <div className="absolute inset-0 bg-image-scrim" aria-hidden />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          <PriorityBadge priority={o.priority} />
          <OrderStatusBadge status={o.status} />
          {o.overdue && <Badge tone="bad">Atrasada</Badge>}
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 text-on-image">
          <p className="text-label-md">
            {o.code} · {MAINTENANCE_CATEGORY_LABEL[o.category]}
          </p>
          <h1 className="text-headline-lg">{o.title}</h1>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-label-md text-primary">{o.propertyName}</p>
        <p className="flex items-start gap-1.5 text-body-sm text-on-surface-variant">
          <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden /> {o.propertyAddress}
          {o.propertyCity ? ` · ${o.propertyCity}` : ''}
        </p>
        {o.status !== 'resolved' && o.status !== 'cancelled' && (
          <p className={cn('flex items-center gap-1.5 text-body-sm', o.overdue ? 'text-error' : 'text-on-surface-variant')}>
            <CalendarClock size={16} aria-hidden />
            {o.scheduledDate ? `${o.overdue ? 'Atrasada: era' : 'Programada:'} ${dayLabel(o.scheduledDate, today).toLowerCase()}` : 'Sin fecha: cuanto antes'}
          </p>
        )}
      </div>
      {o.status !== 'resolved' && o.status !== 'cancelled' && (
        <a href={directions} target="_blank" rel="noreferrer" className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-md border border-outline-variant bg-surface-lowest px-6 text-body-md font-semibold text-primary hover:bg-surface-low" data-testid="como-llegar">
          <Navigation size={20} aria-hidden /> Cómo llegar <ExternalLink size={16} aria-hidden />
        </a>
      )}
    </header>
  );
}

function ApprovalNotice({ order: o }: { order: OrderView }) {
  const a = o.approval;
  if (a.status === 'pending')
    return (
      <Banner tone="warn" icon={Hourglass}>
        Supera el límite de gastos: espera la aprobación del propietario{a.amount != null ? ` (${formatMoney(a.amount, o.currency)})` : ''}.
      </Banner>
    );
  if (a.status === 'approved')
    return (
      <Banner tone="good" icon={CircleCheck}>
        El propietario aprobó el gasto{a.note ? `: «${a.note}»` : '.'}
      </Banner>
    );
  if (a.status === 'rejected')
    return (
      <Banner tone="bad" icon={Ban}>
        El propietario rechazó este gasto{a.note ? `: «${a.note}»` : ''}. Habla con administración antes de seguir.
      </Banner>
    );
  return null;
}

function WorkView({ order: o }: { order: OrderView }) {
  const actor = useActor();
  const run = useAction();
  const toast = useToast();
  const [runBusy, busy] = useBusyAction();
  const [estimate, setEstimate] = useState(o.estimate != null ? String(o.estimate) : '');
  const [rows, setRows] = useState<MaterialRow[]>(() => toRows(o.materials));
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState(false);

  const reportPhotos = o.photos.filter((p) => p.phase === 'report').map((p) => p.fileId);
  const resolvedPhotos = o.photos.filter((p) => p.phase === 'resolved').map((p) => p.fileId);
  const est = numberOrUndefined(estimate);
  const estimateChanged = est != null && est >= 0 && est !== o.estimate;
  const materials = fromRows(rows);
  const materialsChanged = JSON.stringify(materials) !== JSON.stringify(o.materials);
  const actualCost = numberOrUndefined(cost);
  const costOk = actualCost != null && actualCost >= 0;
  const rejected = o.approval.status === 'rejected';
  const ready = resolvedPhotos.length > 0 && costOk && !rejected;

  const resolve = async () => {
    if (!ready || actualCost == null) return;
    setResolving(true);
    const result = await run(() => svc.operations.resolveOrder(actor, o.id, { actualCost, materials, note: note.trim() }));
    setResolving(false);
    if (!result) return;
    const msg = resolvedMessage(result.expenseStatus, actualCost);
    if (result.expenseStatus === 'pending_approval') toast.info(msg);
    else toast.success(msg);
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      {(o.status === 'open' || o.status === 'scheduled') && (
        <Button
          size="lg"
          fullWidth
          icon={Play}
          loading={busy}
          onClick={() => runBusy(() => svc.operations.updateOrder(actor, o.id, { status: 'in_progress' }), { success: 'Trabajo empezado' })}
          data-testid="empezar-trabajo"
        >
          Empezar trabajo
        </Button>
      )}
      {o.status === 'in_progress' && (
        <Banner tone="info" icon={Wrench}>
          Estás trabajando en esta orden.
        </Banner>
      )}

      <Card padding="lg" as="section" aria-label="El problema">
        <h2 className="text-headline-md text-primary">El problema</h2>
        <p className="mt-2 text-body-md whitespace-pre-line text-on-surface">{o.description || 'Sin descripción.'}</p>
        <p className="mt-4 mb-2 text-label-md text-on-surface">Fotos del problema · {reportPhotos.length}</p>
        <PhotoGrid fileIds={reportPhotos} alt="Foto del problema" emptyText="Nadie subió fotos todavía." className="mb-3" />
        <PhotoInput
          onPhoto={async (blob) => {
            await run(() => svc.operations.addOrderPhoto(actor, o.id, 'report', blob));
          }}
          label="Foto del problema"
          size="md"
          variant="secondary"
          sample={{ phase: 'report', caption: o.propertyName }}
          testId="foto-problema"
        />
      </Card>

      <Card padding="lg" as="section" aria-label="Presupuesto">
        <h2 className="text-headline-md text-primary">Presupuesto</h2>
        <p className="mb-3 text-body-sm text-on-surface-variant">Si pasa del límite, el propietario lo aprueba antes de cobrarse.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <TextInput aria-label={`Presupuesto en ${o.currency}`} inputMode="decimal" placeholder={`0 ${o.currency}`} value={estimate} onChange={(e) => setEstimate(e.target.value)} data-testid="presupuesto" />
          <Button
            variant="tonal"
            icon={Save}
            className="shrink-0"
            disabled={!estimateChanged}
            onClick={() => est != null && run(() => svc.operations.updateOrder(actor, o.id, { estimate: est }), { success: 'Presupuesto guardado' })}
          >
            Guardar presupuesto
          </Button>
        </div>
        <div className="mt-3">
          <ApprovalNotice order={o} />
        </div>
      </Card>

      <Card padding="lg" as="section" aria-label="Materiales">
        <h2 className="mb-3 text-headline-md text-primary">Materiales</h2>
        <MaterialsEditor rows={rows} onChange={setRows} currency={o.currency} />
        {materialsChanged && (
          <Button variant="tonal" icon={Save} className="mt-3" onClick={() => run(() => svc.operations.updateOrder(actor, o.id, { materials }), { success: 'Materiales guardados' })}>
            Guardar materiales
          </Button>
        )}
      </Card>

      <Card padding="lg" as="section" aria-label="Lo resuelto" accent="good">
        <h2 className="text-headline-md text-primary">Lo resuelto</h2>
        <p className="mb-4 text-body-sm text-on-surface-variant">Foto de cómo quedó y el costo real. El costo va solo a las finanzas.</p>
        <PhotoGrid fileIds={resolvedPhotos} alt="Foto de lo resuelto" className="mb-3" />
        <div className="[&_button:first-of-type]:w-full">
          <PhotoInput
            onPhoto={async (blob) => {
              await run(() => svc.operations.addOrderPhoto(actor, o.id, 'resolved', blob));
            }}
            label={resolvedPhotos.length ? 'Otra foto' : 'Foto de lo resuelto'}
            variant={resolvedPhotos.length ? 'secondary' : 'primary'}
            sample={{ phase: 'resolved', caption: o.propertyName }}
            testId="foto-resuelto"
          />
        </div>
        <div className="mt-5 space-y-4">
          <TextInput
            label={`Costo real (${o.currency})`}
            inputMode="decimal"
            placeholder="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            data-testid="costo-real"
            error={cost.trim() && !costOk ? 'Escribe un número (0 o más)' : undefined}
            hint={[materialsTotal(materials) > 0 ? `Materiales: ${formatMoney(materialsTotal(materials), o.currency)}` : '', o.estimate != null ? `Presupuesto: ${formatMoney(o.estimate, o.currency)}` : ''].filter(Boolean).join(' · ') || undefined}
          />
          <TextArea label="Nota (opcional)" placeholder="Qué se hizo" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          <Requirements
            items={[
              { ok: resolvedPhotos.length > 0, label: 'Al menos 1 foto de lo resuelto' },
              { ok: costOk, label: 'El costo real' },
              ...(rejected ? [{ ok: false, label: 'El gasto fue rechazado: habla con administración' }] : []),
            ]}
          />
          <Button variant="success" size="lg" fullWidth icon={CircleCheck} disabled={!ready} loading={resolving} onClick={resolve} data-testid="resolver-orden">
            Marcar como resuelta
          </Button>
        </div>
      </Card>
    </>
  );
}

function ResolvedSummary({ order: o }: { order: OrderView }) {
  const reportPhotos = o.photos.filter((p) => p.phase === 'report').map((p) => p.fileId);
  const resolvedPhotos = o.photos.filter((p) => p.phase === 'resolved').map((p) => p.fileId);
  if (o.status === 'cancelled') return <Banner icon={Ban}>Esta orden se canceló. No tienes que hacer nada.</Banner>;
  return (
    <>
      <Banner tone="good" icon={CircleCheck}>
        Resuelta{o.resolvedAt ? ` · ${stamp(o.resolvedAt, o.timezone)}` : ''}
      </Banner>
      <Card padding="lg" as="section" aria-label="Resumen">
        <h2 className="mb-3 text-headline-md text-primary">Resumen</h2>
        <dl className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-body-sm text-on-surface-variant">Costo real</dt>
            <dd className="text-headline-md text-primary">{o.actualCost != null ? <Money amount={o.actualCost} currency={o.currency} /> : '—'}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-body-sm text-on-surface-variant">Gasto</dt>
            <dd className="text-label-md text-on-surface">
              {o.approval.status === 'pending' ? 'Pendiente de aprobación del propietario' : o.approval.status === 'rejected' ? 'Rechazado' : (o.actualCost ?? 0) > 0 ? 'Registrado en las finanzas' : 'Sin costo'}
            </dd>
          </div>
        </dl>
        {o.materials.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-outline-variant/50 pt-3">
            {o.materials.map((m, i) => (
              <li key={i} className="flex justify-between gap-3 text-body-sm">
                <span>
                  {m.name} <span className="text-on-surface-variant">× {m.qty}</span>
                </span>
                <Money amount={m.cost} currency={o.currency} />
              </li>
            ))}
          </ul>
        )}
        {o.resolutionNote && <p className="mt-4 text-body-md text-on-surface">«{o.resolutionNote}»</p>}
      </Card>
      <Card padding="lg" as="section" aria-label="Fotos">
        <p className="mb-2 text-label-md text-on-surface">Del problema</p>
        <PhotoGrid fileIds={reportPhotos} alt="Foto del problema" emptyText="Sin fotos." className="mb-4" />
        <p className="mb-2 text-label-md text-on-surface">De lo resuelto</p>
        <PhotoGrid fileIds={resolvedPhotos} alt="Foto de lo resuelto" emptyText="Sin fotos." />
      </Card>
    </>
  );
}

export default function TechnicianOrderPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const res = useLiveResult(() => svc.operations.getOrder(actor, id), [actor, id]);
  if (res.loading && !res.data) return <Loading />;
  if (!res.data)
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <BackLink />
        <ErrorState error={res.error ?? 'No se encontró la orden.'} />
      </div>
    );
  const o = res.data;
  const closed = o.status === 'resolved' || o.status === 'cancelled';
  return (
    <div className="mx-auto max-w-2xl space-y-5" data-testid="orden-tecnico">
      <OrderHeader order={o} />
      {closed ? <ResolvedSummary order={o} /> : <WorkView order={o} />}
    </div>
  );
}
