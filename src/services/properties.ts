/**
 * Propiedades: portafolio, ficha, estado, salud, códigos de acceso (tapados) y checklist.
 */
import { data } from '@/data';
import { ACCESS_KIND_LABEL } from '@/domain/labels';
import { codesVisibleForStay, maskCode, propertyHealth, type HealthResult } from '@/domain/rules';
import {
  ChecklistSchema,
  PropertySchema,
  type AccessCodeView,
  type Booking,
  type CleaningTask,
  type DocumentRecord,
  type Lease,
  type MaintenanceOrder,
  type OwnerPrivate,
  type Property,
  type PropertyStatus,
  type StatusOverride,
} from '@/domain/types';
import { nowIso, todayIn } from '@/lib/clock';
import { addDays } from '@/lib/dates';
import { newId } from '@/lib/ids';
import type { z } from 'zod';
import {
  allowed,
  audit,
  authorize,
  can,
  ForbiddenError,
  NotFoundError,
  parse,
  subjectFor,
  type Actor,
  type Subject,
} from './core';
import { storeFile } from './files';

/** Lo que llega a las pantallas: los datos privados del propietario solo si se pueden ver. */
export interface PropertyView extends Omit<Property, 'ownerPrivate' | 'nightlyRate' | 'cleaningFee' | 'monthlyRent' | 'cleaningPay'> {
  ownerPrivate?: OwnerPrivate;
  nightlyRate?: number;
  cleaningFee?: number;
  cleaningPay?: number;
  monthlyRent?: number;
  status: PropertyStatus;
  today: string;
}

const PRICE_ROLES = new Set(['owner', 'admin', 'support', 'accountant']);

/** Estado visible: el manual manda (mantenimiento/bloqueada); si no, ocupada si hay estadía o contrato hoy. */
export function effectiveStatus(p: Property, bookings: Booking[], leases: Lease[], today = todayIn(p.timezone)): PropertyStatus {
  if (p.statusOverride === 'maintenance') return 'maintenance';
  if (p.statusOverride === 'blocked') return 'blocked';
  const stay = bookings.some(
    (b) => b.propertyId === p.id && (b.status === 'in_progress' || (b.status === 'confirmed' && b.checkIn <= today && today < b.checkOut)),
  );
  const lease = leases.some((l) => l.propertyId === p.id && l.status === 'active' && l.start <= today && today <= l.end);
  return stay || lease ? 'occupied' : 'vacant';
}

export function toView(p: Property, s: Subject, status: PropertyStatus): PropertyView {
  const { ownerPrivate, nightlyRate, cleaningFee, monthlyRent, cleaningPay, ...rest } = p;
  const view: PropertyView = { ...rest, status, today: todayIn(p.timezone) };
  if (can(s, 'property.readPrivate', { propertyId: p.id })) view.ownerPrivate = ownerPrivate;
  if (PRICE_ROLES.has(s.user.role)) Object.assign(view, { nightlyRate, cleaningFee, monthlyRent, cleaningPay });
  return view;
}

export async function listProperties(actor: Actor, opts: { includeArchived?: boolean } = {}): Promise<PropertyView[]> {
  const s = await subjectFor(actor);
  const db = data();
  const [props, bookings, leases] = await Promise.all([db.properties.all(), db.bookings.all(), db.leases.all()]);
  return allowed(s, 'property.read', props, (p) => ({ propertyId: p.id }))
    .filter((p) => opts.includeArchived || !p.archived)
    .map((p) => toView(p, s, effectiveStatus(p, bookings, leases)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProperty(actor: Actor, id: string): Promise<PropertyView> {
  const s = await authorize(actor, 'property.read', { propertyId: id });
  const db = data();
  const p = await db.properties.get(id);
  if (!p) throw new NotFoundError('la propiedad');
  const [bookings, leases] = await Promise.all([db.bookings.find((b) => b.propertyId === id), db.leases.find((l) => l.propertyId === id)]);
  return toView(p, s, effectiveStatus(p, bookings, leases));
}

// ───────────────────────── Salud ─────────────────────────

export function healthFor(
  p: Property,
  ctx: { incidents: { severity: 'urgent' | 'high' | 'medium' | 'low'; status: string; propertyId: string }[]; orders: MaintenanceOrder[]; cleanings: CleaningTask[]; documents: DocumentRecord[] },
): HealthResult {
  const today = todayIn(p.timezone);
  const soon = addDays(today, 30);
  return propertyHealth({
    openIncidents: ctx.incidents.filter((i) => i.propertyId === p.id && (i.status === 'open' || i.status === 'in_progress')),
    overdueOrders: ctx.orders.filter(
      (o) => o.propertyId === p.id && o.scheduledDate && o.scheduledDate < today && (o.status === 'open' || o.status === 'scheduled' || o.status === 'in_progress'),
    ).length,
    overdueCleanings: ctx.cleanings.filter((c) => c.propertyId === p.id && c.status === 'pending' && c.date < today).length,
    expiringDocs: ctx.documents.filter((d) => d.propertyId === p.id && d.expiresOn && d.expiresOn >= today && d.expiresOn <= soon).length,
    expiredDocs: ctx.documents.filter((d) => d.propertyId === p.id && d.expiresOn && d.expiresOn < today).length,
  });
}

export async function getHealth(actor: Actor, id: string): Promise<HealthResult> {
  await authorize(actor, 'property.read', { propertyId: id });
  const db = data();
  const p = await db.properties.get(id);
  if (!p) throw new NotFoundError('la propiedad');
  const [incidents, orders, cleanings, documents] = await Promise.all([
    db.incidents.find((i) => i.propertyId === id),
    db.maintenanceOrders.find((o) => o.propertyId === id),
    db.cleaningTasks.find((c) => c.propertyId === id),
    db.documents.find((d) => d.propertyId === id),
  ]);
  return healthFor(p, { incidents, orders, cleanings, documents });
}

/** Salud de todas las propiedades visibles (para el panel). */
export async function healthAll(actor: Actor): Promise<Record<string, HealthResult>> {
  const s = await subjectFor(actor);
  const db = data();
  const [props, incidents, orders, cleanings, documents] = await Promise.all([
    db.properties.all(),
    db.incidents.all(),
    db.maintenanceOrders.all(),
    db.cleaningTasks.all(),
    db.documents.all(),
  ]);
  const out: Record<string, HealthResult> = {};
  for (const p of allowed(s, 'property.read', props, (x) => ({ propertyId: x.id })))
    out[p.id] = healthFor(p, { incidents, orders, cleanings, documents });
  return out;
}

// ───────────────────────── Ficha: operación ─────────────────────────

export interface PropertyOperations {
  currentBooking?: Booking & { guestName: string };
  nextBooking?: Booking & { guestName: string };
  activeLease?: Lease & { tenantName: string };
  pendingCleanings: CleaningTask[];
  lastCleaning?: CleaningTask;
  openOrders: MaintenanceOrder[];
  openIncidents: number;
}

/** Lo que pasa hoy en una propiedad: próxima reserva, limpieza y órdenes abiertas (según permisos). */
export async function propertyOperations(actor: Actor, id: string): Promise<PropertyOperations> {
  const s = await authorize(actor, 'property.read', { propertyId: id });
  const db = data();
  const p = await db.properties.get(id);
  if (!p) throw new NotFoundError('la propiedad');
  const today = todayIn(p.timezone);
  const [bookings, leases, cleanings, orders, incidents, people] = await Promise.all([
    db.bookings.find((b) => b.propertyId === id && b.status !== 'cancelled'),
    db.leases.find((l) => l.propertyId === id),
    db.cleaningTasks.find((c) => c.propertyId === id),
    db.maintenanceOrders.find((o) => o.propertyId === id),
    db.incidents.find((i) => i.propertyId === id && (i.status === 'open' || i.status === 'in_progress')),
    db.people.all(),
  ]);
  const name = (pid: string) => people.find((x) => x.id === pid)?.name ?? '—';
  const ops: PropertyOperations = { pendingCleanings: [], openOrders: [], openIncidents: incidents.length };
  if (can(s, 'booking.read', { propertyId: id })) {
    const cur = bookings.find((b) => b.status === 'in_progress' || (b.checkIn <= today && today < b.checkOut && b.status === 'confirmed'));
    const next = bookings.filter((b) => b.status === 'confirmed' && b.checkIn >= today && b.id !== cur?.id).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
    if (cur) ops.currentBooking = { ...cur, guestName: name(cur.guestId) };
    if (next) ops.nextBooking = { ...next, guestName: name(next.guestId) };
  }
  if (can(s, 'lease.read', { propertyId: id })) {
    const lease = leases.find((l) => l.status === 'active' && l.start <= today && today <= l.end);
    if (lease) ops.activeLease = { ...lease, tenantName: name(lease.tenantId) };
  }
  const visibleCleanings = allowed(s, 'cleaning.read', cleanings, (c) => ({ propertyId: c.propertyId, assigneeId: c.assigneeId }));
  ops.pendingCleanings = visibleCleanings.filter((c) => c.status === 'pending' || c.status === 'in_progress').sort((a, b) => a.date.localeCompare(b.date));
  ops.lastCleaning = visibleCleanings.filter((c) => c.status === 'done').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
  ops.openOrders = allowed(s, 'maintenance.read', orders, (o) => ({ propertyId: o.propertyId, assigneeId: o.assigneeUserId })).filter(
    (o) => o.status !== 'resolved' && o.status !== 'cancelled',
  );
  return ops;
}

// ───────────────────────── Altas y cambios ─────────────────────────

const PropertyInput = PropertySchema.omit({ id: true, createdAt: true, archived: true });
export type PropertyInput = z.input<typeof PropertyInput>;

export async function createProperty(actor: Actor, raw: PropertyInput): Promise<Property> {
  await authorize(actor, 'property.create');
  const input = parse(PropertyInput, raw);
  const p: Property = { ...input, id: newId('p'), archived: false, createdAt: nowIso() };
  await data().properties.put(p);
  await data().checklists.put({
    id: newId('cl'),
    propertyId: p.id,
    rooms: [
      { name: 'General', items: ['Aspirar y trapear', 'Cambiar sábanas y toallas', 'Desinfectar baños', 'Sacar la basura'] },
    ],
  });
  await audit(actor, 'property.create', 'property', p.id, `Creó la propiedad «${p.name}».`);
  return p;
}

const PropertyPatch = PropertySchema.omit({ id: true, createdAt: true }).partial();
export type PropertyPatch = z.input<typeof PropertyPatch>;

export async function updateProperty(actor: Actor, id: string, raw: PropertyPatch): Promise<Property> {
  const s = await authorize(actor, 'property.update', { propertyId: id });
  const patch = parse(PropertyPatch, raw);
  const p = await data().properties.get(id);
  if (!p) throw new NotFoundError('la propiedad');
  if (patch.ownerPrivate && !can(s, 'property.readPrivate', { propertyId: id }))
    throw new ForbiddenError('Solo el propietario cambia los datos privados (compra, hipoteca, seguro).');
  const next: Property = { ...p, ...patch };
  await data().properties.put(next);
  await audit(actor, 'property.update', 'property', id, `Editó «${next.name}».`);
  return next;
}

const STATUS_TEXT: Record<StatusOverride, string> = { none: 'Disponible (automático)', maintenance: 'En mantenimiento', blocked: 'Bloqueada' };

export async function setPropertyStatus(actor: Actor, id: string, status: StatusOverride): Promise<Property> {
  await authorize(actor, 'property.update', { propertyId: id });
  const p = await data().properties.get(id);
  if (!p) throw new NotFoundError('la propiedad');
  const next = { ...p, statusOverride: status };
  await data().properties.put(next);
  await audit(actor, 'property.status', 'property', id, `Cambió el estado de «${p.name}» a ${STATUS_TEXT[status]}.`);
  return next;
}

export async function addPropertyPhoto(actor: Actor, id: string, file: Blob, name = 'foto.webp'): Promise<Property> {
  await authorize(actor, 'property.update', { propertyId: id });
  const p = await data().properties.get(id);
  if (!p) throw new NotFoundError('la propiedad');
  const fileId = await storeFile(file, name);
  const next = { ...p, photos: [{ id: newId('ph'), src: '', fileId, caption: name }, ...p.photos] };
  await data().properties.put(next);
  await audit(actor, 'property.photo', 'property', id, `Agregó una foto a «${p.name}».`);
  return next;
}

// ───────────────────────── Códigos de acceso ─────────────────────────

/**
 * Códigos de la propiedad, tapados. El equipo (propietario y administración) puede destaparlos con
 * revealAccessCode, que queda en la auditoría. Los huéspedes los ven en bookings.guestHome solo
 * durante su estadía.
 */
export async function listAccessCodes(actor: Actor, propertyId: string): Promise<AccessCodeView[]> {
  await authorize(actor, 'property.update', { propertyId });
  const codes = await data().accessCodes.find((c) => c.propertyId === propertyId);
  return codes.map((c) => ({ id: c.id, kind: c.kind, label: c.label, value: null, masked: maskCode(c.value) }));
}

export async function revealAccessCode(actor: Actor, codeId: string): Promise<string> {
  const code = await data().accessCodes.get(codeId);
  if (!code) throw new NotFoundError('el código');
  await authorize(actor, 'property.revealCode', { propertyId: code.propertyId });
  if (actor.user.role !== 'owner' && actor.user.role !== 'admin') throw new ForbiddenError('Solo propietario y administración destapan códigos.');
  await audit(actor, 'property.revealCode', 'accessCode', codeId, `Mostró el código «${ACCESS_KIND_LABEL[code.kind]}» de la propiedad.`);
  return code.value;
}

export async function updateAccessCode(actor: Actor, codeId: string, value: string): Promise<void> {
  const code = await data().accessCodes.get(codeId);
  if (!code) throw new NotFoundError('el código');
  await authorize(actor, 'property.update', { propertyId: code.propertyId });
  if (value.trim().length < 4) throw new ForbiddenError('El código debe tener al menos 4 caracteres.');
  await data().accessCodes.put({ ...code, value: value.trim() });
  await audit(actor, 'property.code', 'accessCode', codeId, `Cambió el código «${ACCESS_KIND_LABEL[code.kind]}».`);
}

/** Códigos para un huésped: valores solo durante su estadía; si no, tapados. */
export function codesForStay(codes: { id: string; kind: AccessCodeView['kind']; label: string; value: string }[], booking: Pick<Booking, 'checkIn' | 'checkOut' | 'status'>, today: string): AccessCodeView[] {
  const visible = codesVisibleForStay(booking, today);
  return codes.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.kind === 'wifi' && !visible ? 'Wifi' : c.label,
    value: visible ? c.value : null,
    masked: maskCode(c.value),
  }));
}

// ───────────────────────── Checklist ─────────────────────────

export async function getChecklist(actor: Actor, propertyId: string) {
  await authorize(actor, 'property.read', { propertyId });
  return (await data().checklists.find((c) => c.propertyId === propertyId))[0] ?? { id: newId('cl'), propertyId, rooms: [] };
}

export async function saveChecklist(actor: Actor, raw: z.input<typeof ChecklistSchema>) {
  const input = parse(ChecklistSchema, raw);
  await authorize(actor, 'property.update', { propertyId: input.propertyId });
  await data().checklists.put(input);
  await audit(actor, 'property.checklist', 'checklist', input.id, 'Editó la checklist de limpieza.');
  return input;
}
