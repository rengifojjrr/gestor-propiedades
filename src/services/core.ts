/**
 * Base de los servicios: quién pide (Actor → Subject), errores, auditoría y avisos.
 * Las pantallas llaman a los servicios con el actor actual; los servicios validan con zod,
 * aplican permisos con can() y recién ahí tocan la capa de datos.
 */
import { data } from '@/data';
import type { AppNotification, AuditEntry, Role, Settings, User } from '@/domain/types';
import { nowIso } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { z } from 'zod';
import { assertCan, can, type Action, type Resource, type Subject } from './permissions';

export { ForbiddenError, can, assertCan } from './permissions';
export type { Action, Resource, Subject } from './permissions';

/** Quién usa la app ahora. `realUser` difiere de `user` en «Ver como…» (solo mirar). */
export interface Actor {
  user: User;
  realUser: User;
  readOnly: boolean;
}

export function actorFor(user: User, viewer?: User): Actor {
  return { user, realUser: viewer ?? user, readOnly: !!viewer && viewer.id !== user.id };
}

export class NotFoundError extends Error {
  constructor(what = 'el registro') {
    super(`No se encontró ${what}.`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

export class ValidationError extends Error {
  constructor(public issues: { path: string; message: string }[]) {
    super(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · '));
    this.name = 'ValidationError';
  }
}

/** Valida con zod y lanza ValidationError con mensajes en español. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

export async function getSettings(): Promise<Settings> {
  const s = await data().settings.get('app');
  if (!s) throw new NotFoundError('la configuración');
  return s;
}

/**
 * Calcula a qué propiedades llega cada rol:
 * equipo → las asignadas; limpieza → las de sus tareas; técnico → las de sus órdenes;
 * huésped → las de sus reservas; inquilino → las de sus contratos.
 */
export async function subjectFor(actor: Actor): Promise<Subject> {
  const { user } = actor;
  const settings = await getSettings();
  let propertyIds: Subject['propertyIds'];
  const db = data();
  switch (user.role) {
    case 'owner':
      propertyIds = 'all';
      break;
    case 'admin':
    case 'support':
    case 'accountant':
      propertyIds = user.propertyIds === 'all' ? 'all' : new Set(user.propertyIds);
      break;
    case 'cleaner':
      propertyIds = new Set(
        (await db.cleaningTasks.find((t) => t.assigneeId === user.id && t.status !== 'cancelled')).map((t) => t.propertyId),
      );
      break;
    case 'technician':
      propertyIds = new Set(
        (await db.maintenanceOrders.find((o) => o.assigneeUserId === user.id && o.status !== 'cancelled')).map((o) => o.propertyId),
      );
      break;
    case 'guest':
      propertyIds = new Set(
        (await db.bookings.find((b) => b.guestId === user.personId && b.status !== 'cancelled')).map((b) => b.propertyId),
      );
      break;
    case 'tenant':
      propertyIds = new Set((await db.leases.find((l) => l.tenantId === user.personId)).map((l) => l.propertyId));
      break;
  }
  return { user, readOnly: actor.readOnly, propertyIds, settings };
}

/** Atajo: calcula el sujeto y verifica el permiso. */
export async function authorize(actor: Actor, action: Action, resource: Resource = {}): Promise<Subject> {
  const s = await subjectFor(actor);
  assertCan(s, action, resource);
  return s;
}

/** Filtra una lista con can(). */
export function allowed<T>(s: Subject, action: Action, items: T[], toResource: (item: T) => Resource): T[] {
  return items.filter((item) => can(s, action, toResource(item)));
}

/** Auditoría (solo se agrega): quién hizo qué y cuándo. */
export async function audit(actor: Actor, action: string, entity: string, entityId: string | undefined, summary: string): Promise<void> {
  const entry: AuditEntry = {
    id: newId('au'),
    at: nowIso(),
    actorId: actor.realUser.id,
    actorName: actor.realUser.name,
    actorRole: actor.realUser.role,
    action,
    entity,
    entityId,
    summary,
  };
  await data().audit.append(entry);
}

/** Aviso guardado (además de los que se calculan solos, ver services/system.ts). */
export async function pushNotification(n: Omit<AppNotification, 'id' | 'at'> & { roles: Role[] }): Promise<void> {
  await data().notifications.put({ id: newId('nt'), at: nowIso(), ...n });
}

export function systemActor(owner: User): Actor {
  return { user: owner, realUser: { ...owner, name: 'Sistema', id: 'system' }, readOnly: false };
}

/** Actor «sistema» (para automatismos: avance de reservas y preventivo). */
export async function getSystemActor(): Promise<Actor> {
  const owner = (await data().users.find((u) => u.role === 'owner'))[0];
  if (!owner) throw new NotFoundError('el propietario');
  return systemActor(owner);
}
