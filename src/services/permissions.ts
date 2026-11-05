/**
 * Permisos por rol: can(sujeto, acción, recurso). Se aplican en la capa de servicios,
 * nunca solo escondiendo botones. La tabla legible está en docs/PERMISOS.md.
 *
 * En esta demo sin servidor los permisos corren en el navegador (ver docs/DECISIONES.md):
 * con Supabase, las mismas reglas se repiten en RLS (docs/SUPABASE.md).
 */
import type { DocVisibility, Role, Settings, User } from '@/domain/types';

export type Action =
  | 'property.read'
  | 'property.create'
  | 'property.update'
  | 'property.readPrivate'
  | 'property.revealCode'
  | 'booking.read'
  | 'booking.write'
  | 'booking.note'
  | 'booking.import'
  | 'lease.read'
  | 'lease.write'
  | 'lease.recordPayment'
  | 'cleaning.read'
  | 'cleaning.write'
  | 'cleaning.work'
  | 'maintenance.read'
  | 'maintenance.write'
  | 'maintenance.work'
  | 'maintenance.readCost'
  | 'maintenance.approve'
  | 'incident.read'
  | 'incident.create'
  | 'incident.assign'
  | 'vendor.read'
  | 'vendor.write'
  | 'person.read'
  | 'person.write'
  | 'thread.read'
  | 'message.send'
  | 'message.broadcast'
  | 'template.read'
  | 'template.write'
  | 'finance.read'
  | 'finance.write'
  | 'finance.export'
  | 'finance.approve'
  | 'document.read'
  | 'document.write'
  | 'calendar.read'
  | 'notification.read'
  | 'settings.read'
  | 'settings.write'
  | 'team.read'
  | 'team.write'
  | 'audit.read';

/** Lo que el recurso dice de sí mismo para decidir. */
export interface Resource {
  propertyId?: string | null;
  /** Usuario asignado (tarea de limpieza u orden de trabajo). */
  assigneeId?: string | null;
  /** Huésped o inquilino dueño del recurso (reserva, contrato, hilo). */
  personId?: string | null;
  visibility?: DocVisibility;
}

/** Quién pide: el usuario, si solo mira («Ver como…») y a qué propiedades llega. */
export interface Subject {
  user: User;
  /** «Ver como…» del propietario: solo mirar. */
  readOnly: boolean;
  /** Propiedades a las que llega (para limpieza, técnico, huésped e inquilino sale de sus tareas/reservas). */
  propertyIds: 'all' | ReadonlySet<string>;
  settings: Pick<Settings, 'shareOwnerFinancials'>;
}

const READ_VERBS = new Set(['read', 'readCost', 'readPrivate', 'export']);

export function isWriteAction(action: Action): boolean {
  return !READ_VERBS.has(action.split('.')[1]);
}

function inScope(s: Subject, propertyId: string | null | undefined): boolean {
  if (propertyId == null) return true;
  return s.propertyIds === 'all' || s.propertyIds.has(propertyId);
}

function ownedBy(s: Subject, res: Resource): boolean {
  return !!s.user.personId && res.personId === s.user.personId;
}

const ADMIN_DENIED = new Set<Action>(['maintenance.approve', 'finance.approve', 'settings.write']);

const SUPPORT_ALLOWED = new Set<Action>([
  'property.read',
  'booking.read',
  'booking.note',
  'cleaning.read',
  'maintenance.read',
  'incident.read',
  'incident.create',
  'incident.assign',
  'vendor.read',
  'person.read',
  'person.write',
  'thread.read',
  'message.send',
  'message.broadcast',
  'template.read',
  'template.write',
  'calendar.read',
  'notification.read',
  'document.read',
  'team.read',
]);

const ACCOUNTANT_ALLOWED = new Set<Action>([
  'finance.read',
  'finance.export',
  'property.read',
  'property.readPrivate',
  'lease.read',
  'document.read',
  'notification.read',
  'calendar.read',
]);

function roleCan(s: Subject, action: Action, res: Resource): boolean {
  const { role } = s.user;
  switch (role) {
    case 'owner':
      return true;

    case 'admin': {
      if (ADMIN_DENIED.has(action)) return false;
      if (action === 'property.readPrivate') return s.settings.shareOwnerFinancials && inScope(s, res.propertyId);
      if (action === 'property.create') return s.propertyIds === 'all';
      if (action.startsWith('document.') && res.visibility === 'owner') return false;
      return inScope(s, res.propertyId);
    }

    case 'support': {
      if (!SUPPORT_ALLOWED.has(action)) return false;
      if (action === 'document.read' && !(res.visibility === 'team' || res.visibility === 'tenant' || res.visibility === 'guest'))
        return false;
      return inScope(s, res.propertyId);
    }

    case 'accountant': {
      if (!ACCOUNTANT_ALLOWED.has(action)) return false;
      if (action === 'property.readPrivate') return s.settings.shareOwnerFinancials;
      if (action === 'document.read') return res.visibility === 'finance';
      return inScope(s, res.propertyId);
    }

    case 'cleaner': {
      if (action === 'cleaning.read' || action === 'cleaning.work') return res.assigneeId === s.user.id;
      if (action === 'property.read' || action === 'incident.create') return res.propertyId != null && inScope(s, res.propertyId);
      return action === 'notification.read' || action === 'calendar.read';
    }

    case 'technician': {
      if (action === 'maintenance.read' || action === 'maintenance.work' || action === 'maintenance.readCost')
        return res.assigneeId === s.user.id;
      if (action === 'property.read') return res.propertyId != null && inScope(s, res.propertyId);
      return action === 'notification.read';
    }

    case 'guest': {
      if (action === 'booking.read' || action === 'thread.read' || action === 'message.send') return ownedBy(s, res);
      if (action === 'property.read' || action === 'incident.create') return res.propertyId != null && inScope(s, res.propertyId);
      if (action === 'document.read') return res.visibility === 'guest' && res.propertyId != null && inScope(s, res.propertyId);
      return action === 'notification.read';
    }

    case 'tenant': {
      if (action === 'lease.read' || action === 'thread.read' || action === 'message.send') return ownedBy(s, res);
      if (action === 'property.read' || action === 'incident.create') return res.propertyId != null && inScope(s, res.propertyId);
      if (action === 'document.read')
        return res.visibility === 'tenant' && (ownedBy(s, res) || (res.personId == null && res.propertyId != null && inScope(s, res.propertyId)));
      return action === 'notification.read';
    }
  }
}

/** ¿Puede este sujeto hacer esta acción sobre este recurso? */
export function can(subject: Subject, action: Action, resource: Resource = {}): boolean {
  if (!subject.user.active) return false;
  if (subject.readOnly && isWriteAction(action)) return false;
  return roleCan(subject, action, resource);
}

export class ForbiddenError extends Error {
  constructor(message = 'No tienes permiso para hacer esto.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function assertCan(subject: Subject, action: Action, resource: Resource = {}, message?: string): void {
  if (!can(subject, action, resource)) {
    throw new ForbiddenError(
      message ?? (subject.readOnly && isWriteAction(action) ? 'Modo «Ver como…»: solo mirar.' : 'No tienes permiso para hacer esto.'),
    );
  }
}

/** Roles del equipo que ven el panel del propietario (con sus límites). */
export const DASHBOARD_ROLES: Role[] = ['owner', 'admin'];
