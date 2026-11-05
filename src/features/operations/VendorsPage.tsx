/**
 * Proveedores: especialidades, calificación, contacto (llamar o escribir), órdenes abiertas y
 * hechas, y si usan la app. Propietario y administración los agregan y editan.
 */
import { Mail, Pencil, Phone, Plus, Smartphone, Star, Truck, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { MAINTENANCE_CATEGORY_LABEL } from '@/domain/labels';
import { MAINTENANCE_CATEGORIES, type MaintenanceCategory } from '@/domain/types';
import { svc, type VendorView } from '@/services';
import { Avatar, Badge, Button, cn, EmptyState, Loading, Modal, PageHeader, SearchInput, TextArea, TextInput, Toggle } from '@/ui';
import { CATEGORY_ICON, numberOrUndefined, useOpsAccess } from './shared';

export function Stars({ rating, className }: { rating: number; className?: string }) {
  const full = Math.round(rating);
  return (
    <span className={cn('inline-flex items-center gap-1', className)} role="img" aria-label={`${rating.toFixed(1)} de 5 estrellas`}>
      <span className="flex" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={16} className={i < full ? 'fill-current text-warning' : 'text-outline-variant'} />
        ))}
      </span>
      <span className="tabular text-label-md text-on-surface" aria-hidden>
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

function VendorModal({ vendor, onClose }: { vendor?: VendorView; onClose: () => void }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [name, setName] = useState(vendor?.name ?? '');
  const [contactName, setContactName] = useState(vendor?.contactName ?? '');
  const [phone, setPhone] = useState(vendor?.phone ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [specialties, setSpecialties] = useState<MaintenanceCategory[]>(vendor?.specialties ?? []);
  const [rating, setRating] = useState(vendor ? String(vendor.rating) : '4.5');
  const [notes, setNotes] = useState(vendor?.notes ?? '');
  const [active, setActive] = useState(vendor?.active ?? true);
  const [tried, setTried] = useState(false);
  const ratingNum = numberOrUndefined(rating);
  const errors = {
    name: name.trim().length < 2 ? 'Escribe el nombre' : undefined,
    rating: ratingNum == null || ratingNum < 0 || ratingNum > 5 ? 'Del 0 al 5' : undefined,
    specialties: specialties.length === 0 ? 'Elige al menos una' : undefined,
  };
  const valid = !errors.name && !errors.rating && !errors.specialties;
  const toggle = (c: MaintenanceCategory) => setSpecialties((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));
  const submit = async () => {
    setTried(true);
    if (!valid || ratingNum == null) return;
    const done = await run(
      () =>
        svc.operations.saveVendor(actor, {
          id: vendor?.id ?? svc.operations.newVendorId(),
          name: name.trim(),
          contactName: contactName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          specialties: MAINTENANCE_CATEGORIES.filter((c) => specialties.includes(c)),
          rating: Math.round(ratingNum * 10) / 10,
          notes: notes.trim(),
          active,
        }),
      { success: vendor ? 'Proveedor guardado' : 'Proveedor agregado' },
    );
    if (done) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={vendor ? 'Editar proveedor' : 'Agregar proveedor'}
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
        <TextInput label="Nombre" placeholder="Ej. Plomería del Centro" value={name} onChange={(e) => setName(e.target.value)} error={tried ? errors.name : undefined} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Persona de contacto" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <TextInput label="Calificación (0 a 5)" inputMode="decimal" value={rating} onChange={(e) => setRating(e.target.value)} error={tried ? errors.rating : undefined} />
          <TextInput label="Teléfono" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <TextInput label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-label-md text-on-surface">Especialidades</legend>
          <div className="flex flex-wrap gap-2">
            {MAINTENANCE_CATEGORIES.map((c) => {
              const on = specialties.includes(c);
              const Icon = CATEGORY_ICON[c];
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(c)}
                  className={cn('inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-label-md', on ? 'border-primary bg-primary text-on-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-low')}
                >
                  <Icon size={16} aria-hidden />
                  {MAINTENANCE_CATEGORY_LABEL[c]}
                </button>
              );
            })}
          </div>
          {tried && errors.specialties && <p className="mt-1 text-label-sm text-error">{errors.specialties}</p>}
        </fieldset>
        <TextArea label="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <Toggle checked={active} onChange={setActive} label="Activo" description="Los inactivos no aparecen para asignar." />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

function VendorCard({ vendor: v, canEdit, onEdit }: { vendor: VendorView; canEdit: boolean; onEdit: () => void }) {
  return (
    <article className={cn('flex flex-col rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 shadow-card md:p-5', !v.active && 'opacity-70')} data-testid={`proveedor-${v.id}`}>
      <div className="flex items-start gap-3">
        <Avatar name={v.name} />
        <div className="min-w-0 flex-1">
          <h3 className="text-label-md text-primary">{v.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stars rating={v.rating} />
            {v.hasAppUser && (
              <Badge tone="good" icon={Smartphone}>
                Usa la app
              </Badge>
            )}
            {!v.active && <Badge>Inactivo</Badge>}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {v.specialties.map((s) => (
          <Badge key={s} tone="info">
            {MAINTENANCE_CATEGORY_LABEL[s]}
          </Badge>
        ))}
      </div>
      {v.notes && <p className="mt-3 text-body-sm text-on-surface-variant">{v.notes}</p>}
      <div className="mt-3 space-y-1">
        {v.contactName && <p className="text-body-sm text-on-surface">{v.contactName}</p>}
        {v.phone && (
          <a href={`tel:${v.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-2 text-body-sm text-primary hover:underline">
            <Phone size={16} aria-hidden /> {v.phone}
          </a>
        )}
        {v.email && (
          <a href={`mailto:${v.email}`} className="flex min-w-0 items-center gap-2 text-body-sm text-primary hover:underline">
            <Mail size={16} className="shrink-0" aria-hidden /> <span className="truncate">{v.email}</span>
          </a>
        )}
      </div>
      <div className="mt-auto pt-4">
        <div className="flex items-center justify-between gap-2 border-t border-outline-variant/50 pt-3">
          <p className="flex items-center gap-1.5 text-label-md text-on-surface">
            <Wrench size={16} className="text-on-surface-variant" aria-hidden />
            {v.openOrders} {v.openOrders === 1 ? 'abierta' : 'abiertas'} · {v.doneOrders} {v.doneOrders === 1 ? 'hecha' : 'hechas'}
          </p>
          {canEdit && (
            <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>
              Editar
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

export default function VendorsPage() {
  const actor = useActor();
  const { canManage } = useOpsAccess();
  const vendors = useLive(() => svc.operations.listVendors(actor), [actor]);
  const [editing, setEditing] = useState<VendorView | 'new' | null>(null);
  const [q, setQ] = useState('');
  if (!vendors) return <Loading />;
  const needle = q.trim().toLowerCase();
  const list = vendors.filter(
    (v) => !needle || v.name.toLowerCase().includes(needle) || v.contactName.toLowerCase().includes(needle) || v.specialties.some((s) => MAINTENANCE_CATEGORY_LABEL[s].toLowerCase().includes(needle)),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        back="/operacion"
        title="Proveedores"
        subtitle="Técnicos y empresas que atienden las propiedades."
        actions={
          canManage ? (
            <Button icon={Plus} onClick={() => setEditing('new')}>
              Agregar proveedor
            </Button>
          ) : undefined
        }
      />
      <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre o especialidad" className="max-w-md" />
      {list.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((v) => (
            <VendorCard key={v.id} vendor={v} canEdit={canManage} onEdit={() => setEditing(v)} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Truck} title="No hay proveedores con ese nombre" />
      )}
      {editing && <VendorModal vendor={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
