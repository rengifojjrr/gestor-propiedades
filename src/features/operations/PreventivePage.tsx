/**
 * Mantenimiento preventivo: calendarios que crean su orden solos cuando llega la fecha
 * (filtros, fumigación, piscina, jardín…). Propietario y administración los crean y editan.
 */
import { CalendarClock, Pencil, Plus, Repeat, Sparkles, Truck } from 'lucide-react';
import { useState } from 'react';
import { useAction, useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import type { MaintenanceCategory } from '@/domain/types';
import { formatDate } from '@/lib/dates';
import { svc, type PreventiveView } from '@/services';
import { Banner, Button, cn, EmptyState, Loading, Modal, Money, PageHeader, Select, TextInput, Toggle } from '@/ui';
import { CATEGORY_OPTIONS, CategoryTile, everyLabel, InfoLine, numberOrUndefined, useFieldStaff } from './shared';

function dueLabel(days: number): { text: string; tone: 'bad' | 'warn' | 'neutral' } {
  if (days < 0) return { text: `Vencido hace ${-days} ${-days === 1 ? 'día' : 'días'}`, tone: 'bad' };
  if (days === 0) return { text: 'Vence hoy', tone: 'warn' };
  if (days === 1) return { text: 'Mañana', tone: 'warn' };
  return { text: `En ${days} días`, tone: days <= 3 ? 'warn' : 'neutral' };
}

type Draft = {
  id?: string;
  active?: boolean;
  propertyId: string;
  title: string;
  category: MaintenanceCategory;
  count: string;
  unit: 'week' | 'month';
  nextDue: string;
  vendorId: string;
  assigneeUserId: string;
  estimate: string;
};

function draftOf(p?: PreventiveView): Draft {
  return {
    id: p?.id,
    active: p?.active,
    propertyId: p?.propertyId ?? '',
    title: p?.title ?? '',
    category: p?.category ?? 'hvac',
    count: String(p?.every.count ?? 1),
    unit: p?.every.unit ?? 'month',
    nextDue: p?.nextDue ?? '',
    vendorId: p?.vendorId ?? '',
    assigneeUserId: p?.assigneeUserId ?? '',
    estimate: p?.estimate != null ? String(p.estimate) : '',
  };
}

function PreventiveModal({ item, onClose }: { item?: PreventiveView; onClose: () => void }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const { vendors, technicians } = useFieldStaff();
  const [d, setD] = useState<Draft>(() => draftOf(item));
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const count = Number.parseInt(d.count, 10);
  const estimate = numberOrUndefined(d.estimate);
  const errors = {
    propertyId: !d.propertyId ? 'Elige una propiedad' : undefined,
    title: d.title.trim().length < 3 ? 'Escribe un título' : undefined,
    count: !(count >= 1) ? 'Mínimo 1' : undefined,
    nextDue: !/^\d{4}-\d{2}-\d{2}$/.test(d.nextDue) ? 'Elige la fecha' : undefined,
    estimate: d.estimate.trim() && (estimate == null || estimate < 0) ? 'Número no válido' : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const submit = async () => {
    setTried(true);
    if (!valid) return;
    const done = await run(
      () =>
        svc.operations.savePreventive(actor, {
          id: d.id,
          active: d.active,
          propertyId: d.propertyId,
          title: d.title.trim(),
          category: d.category,
          every: { unit: d.unit, count },
          nextDue: d.nextDue,
          vendorId: d.vendorId || undefined,
          assigneeUserId: d.assigneeUserId || undefined,
          estimate,
        }),
      { success: item ? 'Preventivo guardado' : 'Preventivo creado' },
    );
    if (done) onClose();
  };
  const err = (k: keyof typeof errors) => (tried ? errors[k] : undefined);
  return (
    <Modal
      open
      onClose={onClose}
      title={item ? 'Editar preventivo' : 'Nuevo preventivo'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Select label="Propiedad" value={d.propertyId} onChange={(e) => set({ propertyId: e.target.value })} placeholder="Elige una propiedad" options={(properties ?? []).map((p) => ({ value: p.id, label: p.name }))} error={err('propertyId')} />
        <TextInput label="Qué se hace" placeholder="Ej. cambio de filtro del aire" value={d.title} onChange={(e) => set({ title: e.target.value })} error={err('title')} />
        <Select label="Categoría" value={d.category} onChange={(e) => set({ category: e.target.value as MaintenanceCategory })} options={CATEGORY_OPTIONS} />
        <div className="grid grid-cols-2 gap-3">
          <TextInput type="number" min={1} label="Cada" value={d.count} onChange={(e) => set({ count: e.target.value })} error={err('count')} />
          <Select
            label="Unidad"
            value={d.unit}
            onChange={(e) => set({ unit: e.target.value as 'week' | 'month' })}
            options={[
              { value: 'week', label: count === 1 ? 'semana' : 'semanas' },
              { value: 'month', label: count === 1 ? 'mes' : 'meses' },
            ]}
          />
        </div>
        <TextInput type="date" label="Próxima fecha" value={d.nextDue} onChange={(e) => set({ nextDue: e.target.value })} error={err('nextDue')} hint="Ese día se crea la orden y la fecha avanza sola." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Proveedor" value={d.vendorId} onChange={(e) => set({ vendorId: e.target.value })} placeholder="El habitual de la categoría" options={vendors.map((v) => ({ value: v.id, label: v.name }))} />
          <Select label="Técnico (opcional)" value={d.assigneeUserId} onChange={(e) => set({ assigneeUserId: e.target.value })} placeholder="El del proveedor" options={technicians.map((t) => ({ value: t.id, label: t.name }))} />
        </div>
        <TextInput label="Costo estimado (opcional)" inputMode="decimal" placeholder="0" value={d.estimate} onChange={(e) => set({ estimate: e.target.value })} error={err('estimate')} />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

function PreventiveCard({ item, currency, onEdit }: { item: PreventiveView; currency: string; onEdit: () => void }) {
  const actor = useActor();
  const run = useAction();
  const due = dueLabel(item.dueInDays);
  const toggle = (active: boolean) =>
    run(
      () =>
        svc.operations.savePreventive(actor, {
          id: item.id,
          active,
          propertyId: item.propertyId,
          title: item.title,
          category: item.category,
          every: item.every,
          nextDue: item.nextDue,
          vendorId: item.vendorId,
          assigneeUserId: item.assigneeUserId,
          estimate: item.estimate,
        }),
      { success: active ? 'Preventivo activado' : 'Preventivo en pausa' },
    );
  return (
    <article className={cn('flex flex-col rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 shadow-card md:p-5', !item.active && 'opacity-70')} data-testid={`preventivo-${item.id}`}>
      <div className="flex items-start gap-3">
        <CategoryTile category={item.category} />
        <div className="min-w-0 flex-1">
          <h3 className="text-label-md text-primary">{item.title}</h3>
          <p className="text-body-sm text-on-surface-variant">
            {item.propertyName} · {item.categoryLabel}
          </p>
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        <InfoLine icon={Repeat}>{everyLabel(item.every)}</InfoLine>
        <InfoLine icon={CalendarClock} tone={item.active && due.tone !== 'neutral' ? due.tone : undefined}>
          Próxima: {formatDate(item.nextDue, { weekday: true })} · {item.active ? due.text : 'en pausa'}
        </InfoLine>
        <InfoLine icon={Truck}>{item.vendorName ?? 'Proveedor habitual de la categoría'}</InfoLine>
        {item.estimate != null && (
          <InfoLine icon={Sparkles}>
            Estimado <Money amount={item.estimate} currency={currency} />
          </InfoLine>
        )}
      </div>
      <div className="mt-auto pt-4">
        <div className="flex items-center justify-between gap-3 border-t border-outline-variant/50 pt-2">
          <Toggle checked={item.active} onChange={toggle} label={item.active ? 'Activo' : 'En pausa'} />
          <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
            Editar
          </Button>
        </div>
      </div>
    </article>
  );
}

export default function PreventivePage() {
  const actor = useActor();
  const items = useLive(() => svc.operations.listPreventive(actor), [actor]);
  const props = useLive(() => svc.properties.listProperties(actor), [actor]);
  const [editing, setEditing] = useState<PreventiveView | 'new' | null>(null);
  const [propertyFilter, setPropertyFilter] = useState('');
  if (!items) return <Loading />;
  const properties = [...new Map(items.map((i) => [i.propertyId, i.propertyName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const list = items.filter((i) => !propertyFilter || i.propertyId === propertyFilter);
  const soon = items.filter((i) => i.active && i.dueInDays <= 7).length;
  return (
    <div className="space-y-6">
      <PageHeader
        back="/operacion"
        title="Mantenimiento preventivo"
        subtitle={`${items.filter((i) => i.active).length} calendarios activos · ${soon} vencen esta semana`}
        actions={
          <Button icon={Plus} onClick={() => setEditing('new')}>
            Nuevo preventivo
          </Button>
        }
      />
      <Banner icon={CalendarClock}>Crean órdenes solas cuando llega la fecha: ese día aparece una orden programada para el proveedor y la próxima fecha avanza sola.</Banner>
      <div className="max-w-xs">
        <Select aria-label="Filtrar por propiedad" value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} placeholder="Todas las propiedades" options={properties.map(([value, label]) => ({ value, label }))} />
      </div>
      {list.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((i) => (
            <PreventiveCard key={i.id} item={i} currency={props?.find((p) => p.id === i.propertyId)?.currency ?? 'USD'} onEdit={() => setEditing(i)} />
          ))}
        </div>
      ) : (
        <EmptyState icon={CalendarClock} title="Sin calendarios" body="Crea uno para que las órdenes de rutina se hagan solas." />
      )}
      {editing && <PreventiveModal item={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
