/**
 * Asignar: una orden a un técnico o proveedor, y una limpieza a una persona de limpieza.
 * Los modales se montan solo mientras están abiertos (así su estado empieza limpio).
 */
import type { LucideIcon } from 'lucide-react';
import { ChevronDown, Sparkles, Truck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { MAINTENANCE_CATEGORY_LABEL } from '@/domain/labels';
import type { MaintenanceCategory } from '@/domain/types';
import { svc, type CleaningTaskView, type OrderView, type TeamMember, type VendorView } from '@/services';
import { Avatar, Badge, Button, cn, Loading, Modal, TextInput } from '@/ui';
import { todayIn } from '@/lib/clock';
import { useFieldStaff, whenLabel } from './shared';

/** '' = automático · 'u:<usuario>' = técnico con la app · 'v:<proveedor>' = proveedor. */
export type AssigneeValue = string;

export function assigneeValueOf(o: { assigneeUserId?: string; vendorId?: string }): AssigneeValue {
  if (o.assigneeUserId) return `u:${o.assigneeUserId}`;
  if (o.vendorId) return `v:${o.vendorId}`;
  return '';
}

/** Lo que piden los servicios: técnico (con su proveedor) o proveedor. */
export function assigneePayload(value: AssigneeValue, technicians: TeamMember[]): { assigneeUserId?: string; vendorId?: string } {
  if (value.startsWith('u:')) {
    const id = value.slice(2);
    return { assigneeUserId: id, vendorId: technicians.find((t) => t.id === id)?.vendorId };
  }
  if (value.startsWith('v:')) return { vendorId: value.slice(2) };
  return {};
}

export function assigneeName(value: AssigneeValue, technicians: TeamMember[], vendors: VendorView[]): string | undefined {
  if (value.startsWith('u:')) return technicians.find((t) => t.id === value.slice(2))?.name;
  if (value.startsWith('v:')) return vendors.find((v) => v.id === value.slice(2))?.name;
  return undefined;
}

function ChoiceRow({ name, value, checked, onChange, title, subtitle, avatar, icon: Icon, badge }: { name: string; value: string; checked: boolean; onChange: (v: string) => void; title: string; subtitle?: ReactNode; avatar?: string; icon?: LucideIcon; badge?: ReactNode }) {
  return (
    <label
      className={cn(
        'flex min-h-16 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
        checked ? 'border-primary bg-surface-low' : 'border-outline-variant hover:bg-surface-low',
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="h-5 w-5 shrink-0 accent-primary" />
      {avatar ? (
        <Avatar name={avatar} size="sm" />
      ) : Icon ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary">
          <Icon size={16} aria-hidden />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-label-md text-primary">{title}</span>
        {subtitle && <span className="block truncate text-body-sm text-on-surface-variant">{subtitle}</span>}
      </span>
      {badge}
    </label>
  );
}

/** Técnicos con la app y proveedores: primero los especialistas de la categoría; los demás, a un toque. */
export function AssigneeOptions({ value, onChange, category, name, allowAuto }: { value: AssigneeValue; onChange: (v: AssigneeValue) => void; category: MaintenanceCategory; name: string; allowAuto?: boolean }) {
  const { technicians, vendors, loading } = useFieldStaff();
  const [showAll, setShowAll] = useState(false);
  if (loading) return <Loading label="Cargando el equipo…" className="py-4" />;
  const byRating = [...vendors].sort((a, b) => b.rating - a.rating);
  const specialists = byRating.filter((v) => v.specialties.includes(category));
  const others = byRating.filter((v) => !v.specialties.includes(category));
  const expanded = showAll || others.some((v) => value === `v:${v.id}`) || specialists.length === 0;
  const vendorRow = (v: VendorView) => (
    <ChoiceRow
      key={v.id}
      name={name}
      value={`v:${v.id}`}
      checked={value === `v:${v.id}`}
      onChange={onChange}
      icon={Truck}
      title={v.name}
      subtitle={v.specialties.map((s) => MAINTENANCE_CATEGORY_LABEL[s]).join(' · ')}
      badge={v.specialties.includes(category) ? <Badge tone="info">Especialista</Badge> : undefined}
    />
  );
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1.5 text-label-md text-on-surface">¿Quién lo atiende?</legend>
      {allowAuto && (
        <ChoiceRow name={name} value="" checked={value === ''} onChange={onChange} icon={Sparkles} title="Automático" subtitle={`El proveedor habitual de ${MAINTENANCE_CATEGORY_LABEL[category].toLowerCase()}`} />
      )}
      {technicians.length > 0 && <p className="pt-1 text-label-sm uppercase text-on-surface-variant">Técnicos con la app</p>}
      {technicians.map((t) => (
        <ChoiceRow
          key={t.id}
          name={name}
          value={`u:${t.id}`}
          checked={value === `u:${t.id}`}
          onChange={onChange}
          avatar={t.name}
          title={t.name}
          subtitle={vendors.find((v) => v.id === t.vendorId)?.name ?? t.title}
          badge={<Badge tone="good">Usa la app</Badge>}
        />
      ))}
      <p className="pt-1 text-label-sm uppercase text-on-surface-variant">Proveedores de {MAINTENANCE_CATEGORY_LABEL[category].toLowerCase()}</p>
      {specialists.length ? specialists.map(vendorRow) : <p className="text-body-sm text-on-surface-variant">Ninguno con esta especialidad.</p>}
      {others.length > 0 &&
        (expanded ? (
          <>
            <p className="pt-1 text-label-sm uppercase text-on-surface-variant">Otros proveedores</p>
            {others.map(vendorRow)}
          </>
        ) : (
          <Button variant="ghost" size="sm" icon={ChevronDown} onClick={() => setShowAll(true)}>
            Otros proveedores ({others.length})
          </Button>
        ))}
    </fieldset>
  );
}

/** «Asignar técnico»: técnico con la app o proveedor, y fecha opcional. */
export function AssignOrderModal({ order, onClose }: { order: OrderView; onClose: () => void }) {
  const actor = useActor();
  const staff = useFieldStaff();
  const [run, busy] = useBusyAction();
  const [value, setValue] = useState<AssigneeValue>(assigneeValueOf(order));
  const [date, setDate] = useState(order.scheduledDate ?? '');
  const submit = async () => {
    const payload = assigneePayload(value, staff.technicians);
    const who = assigneeName(value, staff.technicians, staff.vendors);
    const done = await run(() => svc.operations.assignOrder(actor, order.id, { ...payload, scheduledDate: date || undefined }), { success: who ? `Asignada a ${who}` : 'Orden asignada' });
    if (done) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Asignar técnico"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!value} data-testid="confirmar-asignacion">
            Asignar
          </Button>
        </>
      }
    >
      <p className="mb-4 text-body-sm text-on-surface-variant">
        <strong className="text-on-surface">{order.code}</strong> · {order.title} · {order.propertyName}
      </p>
      <AssigneeOptions value={value} onChange={setValue} category={order.category} name={`asignar-${order.id}`} />
      <TextInput type="date" label="Fecha programada (opcional)" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
    </Modal>
  );
}

/** «Asignar» una limpieza a una persona de limpieza. */
export function AssignCleaningModal({ task, onClose }: { task: CleaningTaskView; onClose: () => void }) {
  const actor = useActor();
  const { cleaners, loading } = useFieldStaff();
  const [run, busy] = useBusyAction();
  const [value, setValue] = useState(task.assigneeId ?? '');
  const submit = async () => {
    const who = cleaners.find((c) => c.id === value)?.name;
    const done = await run(() => svc.operations.assignCleaning(actor, task.id, value), { success: who ? `Asignada a ${who}` : 'Limpieza asignada' });
    if (done) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Asignar limpieza"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!value || value === task.assigneeId}>
            Asignar
          </Button>
        </>
      }
    >
      <p className="mb-4 text-body-sm text-on-surface-variant">
        {task.propertyName} · {whenLabel(task.date, task.time, todayIn(task.timezone))}
      </p>
      {loading ? (
        <Loading className="py-4" />
      ) : (
        <fieldset className="min-w-0 space-y-2">
          <legend className="mb-1.5 text-label-md text-on-surface">Persona de limpieza</legend>
          {cleaners.map((c) => (
            <ChoiceRow
              key={c.id}
              name={`limpieza-${task.id}`}
              value={c.id}
              checked={value === c.id}
              onChange={setValue}
              avatar={c.name}
              title={c.name}
              subtitle={c.title ?? c.propertyNames.join(', ')}
              badge={c.id === task.assigneeId ? <Badge>Ahora</Badge> : undefined}
            />
          ))}
        </fieldset>
      )}
    </Modal>
  );
}
