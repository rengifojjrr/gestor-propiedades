/**
 * «Equipo»: cuentas con su rol y propiedades asignadas. Agregar, editar y desactivar (nunca borrar).
 * El propietario es uno solo; las cuentas de administración solo las toca el propietario.
 */
import { Pencil, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/app/hooks';
import { useLive } from '@/data/live';
import { ROLE_DESCRIPTION, ROLE_LABEL } from '@/domain/labels';
import { TEAM_ROLES, type Role } from '@/domain/types';
import { svc, type TeamMember } from '@/services';
import { Avatar, Badge, Button, cn, IconButton, Loading, Modal, Select, TextInput, useConfirm, type Tone } from '@/ui';
import { SettingsSection, ToneIconButton, useSettingsPerms } from './SettingsSection';

const ROLE_TONE: Record<Role, Tone> = {
  owner: 'dark',
  admin: 'info',
  support: 'info',
  cleaner: 'good',
  technician: 'warn',
  accountant: 'neutral',
  guest: 'neutral',
  tenant: 'neutral',
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;
}

/** Qué cuenta puede editar quien mira (los servicios lo vuelven a verificar). */
function useMemberPerms() {
  const { actor, isOwner, canManage } = useSettingsPerms();
  const canEdit = (m: TeamMember) => (m.role === 'owner' || m.role === 'admin' ? isOwner && !actor.readOnly : canManage);
  const canToggle = (m: TeamMember) => m.role !== 'owner' && m.id !== actor.realUser.id && canEdit(m);
  return { canEdit, canToggle };
}

export function TeamSection({ onAdd, onEdit }: { onAdd: () => void; onEdit: (m: TeamMember) => void }) {
  const { actor, canManage } = useSettingsPerms();
  const run = useAction();
  const confirm = useConfirm();
  const team = useLive(() => svc.system.listTeam(actor), [actor]);
  const { canEdit, canToggle } = useMemberPerms();

  const toggle = async (m: TeamMember) => {
    if (m.active) {
      const ok = await confirm({
        title: `¿Desactivar a ${m.name}?`,
        body: 'Ya no podrá entrar ni aparecerá para asignarle trabajo. Su historial se conserva y la puedes reactivar cuando quieras.',
        confirmLabel: 'Desactivar',
        danger: true,
      });
      if (!ok) return;
    }
    await run(() => svc.system.updateUser(actor, m.id, { active: !m.active }), { success: m.active ? `${m.name} quedó desactivada.` : `${m.name} está activa otra vez.` });
  };

  const staff = team?.filter((m) => TEAM_ROLES.includes(m.role)) ?? [];
  const people = team?.filter((m) => !TEAM_ROLES.includes(m.role)) ?? [];

  return (
    <SettingsSection
      id="equipo"
      icon={Users}
      title="Equipo"
      subtitle="Quién entra a la app, con qué rol y a qué propiedades."
      action={
        canManage && (
          <Button icon={UserPlus} onClick={onAdd} data-testid="agregar-usuario">
            Agregar usuario
          </Button>
        )
      }
    >
      {!team ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <MemberGrid members={staff} canEdit={canEdit} canToggle={canToggle} onEdit={onEdit} onToggle={toggle} />
          {people.length > 0 && (
            <div>
              <p className="mb-3 text-label-md text-on-surface">Huéspedes e inquilinos con acceso a su app</p>
              <MemberGrid members={people} canEdit={canEdit} canToggle={canToggle} onEdit={onEdit} onToggle={toggle} />
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}

function MemberGrid({
  members,
  canEdit,
  canToggle,
  onEdit,
  onToggle,
}: {
  members: TeamMember[];
  canEdit: (m: TeamMember) => boolean;
  canToggle: (m: TeamMember) => boolean;
  onEdit: (m: TeamMember) => void;
  onToggle: (m: TeamMember) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {members.map((m) => (
        <li key={m.id} className={cn('flex items-start gap-3 rounded-lg border border-outline-variant/70 p-4 transition-colors hover:bg-surface-low', !m.active && 'opacity-60')}>
          <Avatar name={m.name} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-label-md text-primary">{m.name}</p>
            <p className="truncate text-body-sm text-on-surface-variant">{m.title ?? m.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <RoleBadge role={m.role} />
              {!m.active && <Badge tone="bad">Desactivada</Badge>}
            </div>
            {m.role !== 'guest' && m.role !== 'tenant' && (
              <p className="mt-2 text-label-sm font-normal text-on-surface-variant">
                <span className="font-semibold">Propiedades:</span> {m.propertyIds === 'all' ? 'todas' : m.propertyNames.length ? m.propertyNames.join(', ') : 'ninguna'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-0.5">
            {canEdit(m) && <IconButton icon={Pencil} size="sm" label={`Editar a ${m.name}`} onClick={() => onEdit(m)} />}
            {canToggle(m) && (
              <ToneIconButton icon={m.active ? UserX : UserCheck} tone={m.active ? 'danger' : 'good'} label={m.active ? `Desactivar a ${m.name}` : `Reactivar a ${m.name}`} onClick={() => onToggle(m)} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

const ROLE_ORDER: Role[] = ['admin', 'support', 'cleaner', 'technician', 'accountant', 'guest', 'tenant'];

/** Agregar o editar una cuenta. Móntalo solo mientras está abierto. */
export function UserModal({ member, onClose }: { member: TeamMember | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={member ? `Editar a ${member.name}` : 'Agregar usuario'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="form-usuario" loading={busy} data-testid="guardar-usuario">
            {member ? 'Guardar cambios' : 'Agregar'}
          </Button>
        </>
      }
    >
      <UserForm member={member} onDone={onClose} setBusy={setBusy} />
    </Modal>
  );
}

function UserForm({ member, onDone, setBusy }: { member: TeamMember | null; onDone: () => void; setBusy: (b: boolean) => void }) {
  const { actor, isOwner } = useSettingsPerms();
  const run = useAction();
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const vendors = useLive(() => svc.operations.listVendors(actor).catch(() => []), [actor]);
  const people = useLive(() => svc.people.listPeople(actor).catch(() => []), [actor]);
  const editingOwner = member?.role === 'owner';
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [title, setTitle] = useState(member?.title ?? '');
  const [role, setRole] = useState<Role>(member?.role ?? 'support');
  const [scope, setScope] = useState<'all' | 'some'>(member && member.propertyIds !== 'all' ? 'some' : 'all');
  const [picked, setPicked] = useState<Set<string>>(new Set(member && member.propertyIds !== 'all' ? member.propertyIds : []));
  const [vendorId, setVendorId] = useState(member?.vendorId ?? '');
  const [personId, setPersonId] = useState(member?.personId ?? '');
  const [errors, setErrors] = useState<Partial<Record<'name' | 'email' | 'properties' | 'person', string>>>({});

  const person = role === 'guest' || role === 'tenant';
  const roleOptions = ROLE_ORDER.filter((r) => r !== 'admin' || isOwner || member?.role === 'admin').map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const peopleOptions = (people ?? []).filter((p) => p.kind === (role === 'tenant' ? 'tenant' : 'guest'));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Escribe el nombre.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Escribe un correo válido.';
    if (!editingOwner && !person && scope === 'some' && picked.size === 0) next.properties = 'Elige al menos una propiedad.';
    if (!editingOwner && person && !personId) next.person = role === 'tenant' ? 'Elige la ficha del inquilino.' : 'Elige la ficha del huésped.';
    setErrors(next);
    if (Object.keys(next).length) return;

    const propertyIds: 'all' | string[] = person ? [] : scope === 'all' ? 'all' : [...picked];
    const common = { name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, title: title.trim() || undefined };
    setBusy(true);
    const result = member
      ? await run(
          () =>
            svc.system.updateUser(
              actor,
              member.id,
              editingOwner
                ? common
                : {
                    ...common,
                    ...(role !== member.role ? { role } : {}),
                    propertyIds,
                    vendorId: role === 'technician' ? vendorId || undefined : undefined,
                    personId: person ? personId : undefined,
                  },
            ),
          { success: 'Cambios guardados.' },
        )
      : await run(
          () =>
            svc.system.createUser(actor, {
              ...common,
              role,
              propertyIds,
              vendorId: role === 'technician' ? vendorId || undefined : undefined,
              personId: person ? personId : undefined,
            }),
          { success: `${name.trim()} ya puede entrar como ${ROLE_LABEL[role]}.` },
        );
    setBusy(false);
    if (result) onDone();
  };

  return (
    <form id="form-usuario" onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Nombre" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="off" data-testid="nombre-usuario" />
        <TextInput label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} autoComplete="off" data-testid="correo-usuario" />
        <TextInput label="Teléfono (opcional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <TextInput label="Cargo (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Limpieza · Florida" />
      </div>

      {editingOwner ? (
        <p className="rounded-md bg-surface-low px-3 py-2 text-body-sm text-on-surface-variant">El propietario es uno solo: su rol y su acceso a todo no cambian.</p>
      ) : (
        <>
          <Select label="Rol" value={role} onChange={(e) => setRole(e.target.value as Role)} options={roleOptions} hint={ROLE_DESCRIPTION[role]} data-testid="rol-usuario" />
          {!isOwner && <p className="-mt-2 text-label-sm font-normal text-on-surface-variant">Solo el propietario da acceso de administración.</p>}

          {person ? (
            <Select
              label={role === 'tenant' ? 'Ficha del inquilino' : 'Ficha del huésped'}
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              placeholder="Elige…"
              options={peopleOptions.map((p) => ({ value: p.id, label: p.name }))}
              error={errors.person}
              hint="Ve solo lo suyo: su reserva o su contrato."
            />
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-label-md text-on-surface">Propiedades asignadas</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Alcance">
                {(['all', 'some'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scope === s}
                    onClick={() => setScope(s)}
                    className={cn(
                      'h-10 rounded-full border px-4 text-label-md',
                      scope === s ? 'border-secondary bg-secondary-container text-on-secondary-container' : 'border-outline-variant text-on-surface-variant hover:bg-surface-low',
                    )}
                  >
                    {s === 'all' ? 'Todas' : 'Solo algunas'}
                  </button>
                ))}
              </div>
              {scope === 'some' && (
                <div className="grid grid-cols-1 gap-1 rounded-md border border-outline-variant/60 p-2 sm:grid-cols-2">
                  {(properties ?? []).map((p) => (
                    <label key={p.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-body-sm hover:bg-surface-low">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[var(--color-secondary)]"
                        checked={picked.has(p.id)}
                        onChange={(e) =>
                          setPicked((cur) => {
                            const next = new Set(cur);
                            if (e.target.checked) next.add(p.id);
                            else next.delete(p.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 truncate">{p.name}</span>
                    </label>
                  ))}
                </div>
              )}
              {errors.properties && <p className="text-label-sm text-error">{errors.properties}</p>}
              {(role === 'cleaner' || role === 'technician') && (
                <p className="text-label-sm font-normal text-on-surface-variant">Limpieza y mantenimiento ven solo las propiedades de las tareas u órdenes que se les asignen.</p>
              )}
            </fieldset>
          )}

          {role === 'technician' && (
            <Select
              label="Proveedor"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              options={[{ value: '', label: 'Sin proveedor (técnico propio)' }, ...(vendors ?? []).map((v) => ({ value: v.id, label: v.name }))]}
            />
          )}
        </>
      )}
    </form>
  );
}
