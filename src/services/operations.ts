/**
 * Operación: limpieza (checklist con fotos obligatorias, faltantes y daños), mantenimiento
 * (órdenes, costos, aprobación por umbral), incidencias, preventivo y proveedores.
 */
import { DEFAULT_VENDOR_FOR } from '@/domain/config';
import { data } from '@/data';
import { needsOwnerApproval, nextDueDate, rateFor } from '@/domain/rules';
import { MAINTENANCE_CATEGORY_LABEL, PRIORITY_LABEL } from '@/domain/labels';
import {
  CLEANING_TYPES,
  MAINTENANCE_CATEGORIES,
  PRIORITIES,
  VendorSchema,
  isoDate,
  timeHM,
  type Booking,
  type CleaningTask,
  type Incident,
  type MaintenanceOrder,
  type PreventiveSchedule,
  type Priority,
  type Property,
  type User,
  type Vendor,
} from '@/domain/types';
import { nowIso, todayIn } from '@/lib/clock';
import { addDays, diffDays } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { round2 } from '@/lib/money';
import { z } from 'zod';
import {
  allowed,
  audit,
  authorize,
  can,
  ForbiddenError,
  getSettings,
  getSystemActor,
  NotFoundError,
  parse,
  pushNotification,
  RuleError,
  subjectFor,
  type Actor,
} from './core';
import { postTransaction } from './finance';
import { storeFile } from './files';

// ───────────────────────── Vistas ─────────────────────────

export interface CleaningTaskView extends CleaningTask {
  propertyName: string;
  propertyCity: string;
  propertyAddress: string;
  propertyLat: number;
  propertyLng: number;
  heroSrc: string;
  timezone: string;
  assigneeName?: string;
  overdue: boolean;
  beforeCount: number;
  afterCount: number;
  doneCount: number;
}

export interface OrderView extends MaintenanceOrder {
  propertyName: string;
  propertyCity: string;
  propertyAddress: string;
  heroSrc: string;
  timezone: string;
  assigneeName?: string;
  vendorName?: string;
  overdue: boolean;
  /** Si el que mira puede ver costos (si no, vienen vacíos). */
  canSeeCost: boolean;
}

export interface IncidentView extends Incident {
  propertyName: string;
  orderCode?: string;
}

function cleaningView(t: CleaningTask, p: Property | undefined, users: User[]): CleaningTaskView {
  const today = todayIn(p?.timezone ?? 'America/New_York');
  return {
    ...t,
    propertyName: p?.name ?? '—',
    propertyCity: p?.city ?? '',
    propertyAddress: p?.address ?? '',
    propertyLat: p?.lat ?? 0,
    propertyLng: p?.lng ?? 0,
    heroSrc: p?.photos[0]?.src ?? '',
    timezone: p?.timezone ?? 'America/New_York',
    assigneeName: users.find((u) => u.id === t.assigneeId)?.name,
    overdue: t.status === 'pending' && t.date < today,
    beforeCount: t.photos.filter((x) => x.phase === 'before').length,
    afterCount: t.photos.filter((x) => x.phase === 'after').length,
    doneCount: t.items.filter((i) => i.done).length,
  };
}

// ───────────────────────── Limpieza ─────────────────────────

export interface CleaningFilter {
  date?: string;
  from?: string;
  to?: string;
  status?: CleaningTask['status'][];
  propertyId?: string;
  assigneeId?: string;
}

export async function listCleaning(actor: Actor, filter: CleaningFilter = {}): Promise<CleaningTaskView[]> {
  const s = await subjectFor(actor);
  const db = data();
  const [tasks, props, users] = await Promise.all([db.cleaningTasks.all(), db.properties.all(), db.users.all()]);
  return allowed(s, 'cleaning.read', tasks, (t) => ({ propertyId: t.propertyId, assigneeId: t.assigneeId }))
    .filter(
      (t) =>
        (!filter.date || t.date === filter.date) &&
        (!filter.from || t.date >= filter.from) &&
        (!filter.to || t.date < filter.to) &&
        (!filter.status || filter.status.includes(t.status)) &&
        (!filter.propertyId || t.propertyId === filter.propertyId) &&
        (!filter.assigneeId || t.assigneeId === filter.assigneeId),
    )
    .map((t) => cleaningView(t, props.find((p) => p.id === t.propertyId), users))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export async function getCleaning(actor: Actor, id: string): Promise<CleaningTaskView> {
  const db = data();
  const t = await db.cleaningTasks.get(id);
  if (!t) throw new NotFoundError('la tarea');
  await authorize(actor, 'cleaning.read', { propertyId: t.propertyId, assigneeId: t.assigneeId });
  const [p, users] = await Promise.all([db.properties.get(t.propertyId), db.users.all()]);
  return cleaningView(t, p, users);
}

async function checklistItemsFor(propertyId: string) {
  const cl = (await data().checklists.find((c) => c.propertyId === propertyId))[0];
  return (cl?.rooms ?? []).flatMap((r) => r.items.map((label) => ({ room: r.name, label, done: false })));
}

/** Crea la limpieza de salida de una reserva (una sola vez por reserva). */
export async function createCheckoutCleaning(actor: Actor, booking: Booking): Promise<CleaningTask> {
  const db = data();
  const existing = (await db.cleaningTasks.find((t) => t.bookingId === booking.id && t.type === 'checkout'))[0];
  if (existing) return existing;
  const p = await db.properties.get(booking.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const [guest, nextBooking] = await Promise.all([
    db.people.get(booking.guestId),
    db.bookings
      .find((b) => b.propertyId === p.id && b.id !== booking.id && b.status !== 'cancelled' && b.checkIn >= booking.checkOut)
      .then((list) => list.sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0]),
  ]);
  const today = todayIn(p.timezone);
  const task: CleaningTask = {
    id: newId('ct'),
    propertyId: p.id,
    bookingId: booking.id,
    type: 'checkout',
    status: 'pending',
    assigneeId: p.defaultCleanerId,
    date: booking.checkOut < today ? today : booking.checkOut,
    time: p.checkOutTime,
    priority: nextBooking && nextBooking.checkIn <= addDays(booking.checkOut, 1) ? 'high' : 'normal',
    fee: p.cleaningPay,
    currency: p.currency,
    items: await checklistItemsFor(p.id),
    photos: [],
    supplies: [],
    incidentIds: [],
    notes: '',
    guestName: guest?.name,
    nextCheckIn: nextBooking ? { date: nextBooking.checkIn, time: p.checkInTime } : undefined,
    createdAt: nowIso(),
    createdBy: 'system',
  };
  await db.cleaningTasks.put(task);
  await audit(actor, 'cleaning.create', 'cleaning', task.id, `Se creó sola la limpieza de salida de ${p.name} (reserva ${booking.code}).`);
  await pushNotification({
    kind: 'cleaning',
    title: 'Nueva limpieza de salida',
    body: `${p.name} · ${task.date} ${task.time}${nextBooking ? ` · próxima entrada ${nextBooking.checkIn}` : ''}`,
    link: `/limpieza/tarea/${task.id}`,
    propertyId: p.id,
    roles: ['owner', 'admin'],
    userIds: task.assigneeId ? [task.assigneeId] : undefined,
  });
  return task;
}

const CleaningInput = z.object({
  propertyId: z.string().min(1, 'Elige una propiedad'),
  type: z.enum(CLEANING_TYPES),
  date: isoDate,
  time: timeHM,
  assigneeId: z.string().optional(),
  priority: z.enum(['high', 'normal']),
  notes: z.string(),
});
export type CleaningInput = z.input<typeof CleaningInput>;

export async function createCleaning(actor: Actor, raw: CleaningInput): Promise<CleaningTask> {
  const input = parse(CleaningInput, raw);
  await authorize(actor, 'cleaning.write', { propertyId: input.propertyId });
  const p = await data().properties.get(input.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const task: CleaningTask = {
    id: newId('ct'),
    ...input,
    assigneeId: input.assigneeId || p.defaultCleanerId,
    status: 'pending',
    fee: p.cleaningPay,
    currency: p.currency,
    items: await checklistItemsFor(p.id),
    photos: [],
    supplies: [],
    incidentIds: [],
    createdAt: nowIso(),
    createdBy: actor.realUser.id,
  };
  await data().cleaningTasks.put(task);
  await audit(actor, 'cleaning.create', 'cleaning', task.id, `Creó una tarea de limpieza en ${p.name} para ${task.date}.`);
  return task;
}

export async function assignCleaning(actor: Actor, id: string, assigneeId: string): Promise<CleaningTask> {
  const db = data();
  const t = await db.cleaningTasks.get(id);
  if (!t) throw new NotFoundError('la tarea');
  await authorize(actor, 'cleaning.write', { propertyId: t.propertyId });
  const user = await db.users.get(assigneeId);
  if (!user || user.role !== 'cleaner') throw new RuleError('Asigna la tarea a una persona de limpieza.');
  const next = { ...t, assigneeId };
  await db.cleaningTasks.put(next);
  await audit(actor, 'cleaning.assign', 'cleaning', id, `Asignó la limpieza a ${user.name}.`);
  await pushNotification({ kind: 'cleaning', title: 'Te asignaron una limpieza', body: `${t.date} ${t.time}`, link: `/limpieza/tarea/${id}`, propertyId: t.propertyId, roles: [], userIds: [assigneeId] });
  return next;
}

/** Carga la tarea verificando que quien trabaja sea la persona asignada (o el equipo que la gestiona). */
async function workTask(actor: Actor, id: string): Promise<CleaningTask> {
  const t = await data().cleaningTasks.get(id);
  if (!t) throw new NotFoundError('la tarea');
  const s = await subjectFor(actor);
  if (!can(s, 'cleaning.work', { propertyId: t.propertyId, assigneeId: t.assigneeId }) && !can(s, 'cleaning.write', { propertyId: t.propertyId }))
    throw new ForbiddenError(s.readOnly ? 'Modo «Ver como…»: solo mirar.' : 'Esta tarea no es tuya.');
  if (t.status === 'done' || t.status === 'cancelled') throw new RuleError('La tarea ya está cerrada.');
  return t;
}

export async function startCleaning(actor: Actor, id: string): Promise<CleaningTask> {
  const t = await workTask(actor, id);
  const next: CleaningTask = { ...t, status: 'in_progress', startedAt: t.startedAt ?? nowIso() };
  await data().cleaningTasks.put(next);
  await audit(actor, 'cleaning.start', 'cleaning', id, 'Empezó la limpieza.');
  return next;
}

export async function setCleaningItem(actor: Actor, id: string, index: number, done: boolean): Promise<CleaningTask> {
  const t = await workTask(actor, id);
  if (!t.items[index]) throw new NotFoundError('el punto de la checklist');
  const items = t.items.map((it, i) => (i === index ? { ...it, done } : it));
  const next: CleaningTask = { ...t, items, status: t.status === 'pending' ? 'in_progress' : t.status, startedAt: t.startedAt ?? nowIso() };
  await data().cleaningTasks.put(next);
  return next;
}

export async function addCleaningPhoto(actor: Actor, id: string, phase: 'before' | 'after', file: Blob): Promise<CleaningTask> {
  const t = await workTask(actor, id);
  const fileId = await storeFile(file, `${phase}-${t.id}.webp`);
  const next: CleaningTask = {
    ...t,
    photos: [...t.photos, { fileId, phase, at: nowIso() }],
    status: t.status === 'pending' ? 'in_progress' : t.status,
    startedAt: t.startedAt ?? nowIso(),
  };
  await data().cleaningTasks.put(next);
  return next;
}

export async function removeCleaningPhoto(actor: Actor, id: string, fileId: string): Promise<CleaningTask> {
  const t = await workTask(actor, id);
  const next = { ...t, photos: t.photos.filter((p) => p.fileId !== fileId) };
  await data().cleaningTasks.put(next);
  await data().files.remove(fileId);
  return next;
}

export async function reportSupply(actor: Actor, id: string, item: string): Promise<CleaningTask> {
  const t = await workTask(actor, id);
  const clean = parse(z.string().trim().min(2, 'Escribe qué falta'), item);
  const next = { ...t, supplies: [...t.supplies, { id: newId('sp'), item: clean, at: nowIso() }] };
  await data().cleaningTasks.put(next);
  await audit(actor, 'cleaning.supply', 'cleaning', id, `Reportó faltante: ${clean}.`);
  await pushNotification({ kind: 'cleaning', title: 'Faltan insumos', body: clean, link: `/operacion/limpieza/${id}`, propertyId: t.propertyId, roles: ['owner', 'admin'] });
  return next;
}

export async function setCleaningNotes(actor: Actor, id: string, notes: string): Promise<CleaningTask> {
  const t = await workTask(actor, id);
  const next = { ...t, notes };
  await data().cleaningTasks.put(next);
  return next;
}

const DamageInput = z.object({
  title: z.string().trim().min(3, 'Describe el daño en pocas palabras'),
  description: z.string(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  severity: z.enum(PRIORITIES),
  kind: z.enum(['damage', 'missing']),
});
export type DamageInput = z.input<typeof DamageInput>;

/** La limpieza reporta un daño o faltante: se vuelve incidencia (y orden si es urgente o alta). */
export async function reportDamage(actor: Actor, taskId: string, raw: DamageInput, photo?: Blob): Promise<{ incident: Incident; order?: MaintenanceOrder }> {
  const t = await workTask(actor, taskId);
  const input = parse(DamageInput, raw);
  const result = await createIncident(actor, {
    propertyId: t.propertyId,
    title: input.title,
    description: input.description,
    category: input.category,
    severity: input.severity,
    source: 'cleaning',
    kind: input.kind,
    cleaningTaskId: t.id,
    photo,
  });
  await data().cleaningTasks.put({ ...t, incidentIds: [...t.incidentIds, result.incident.id] });
  return result;
}

/**
 * Cerrar la limpieza: exige la checklist completa y al menos una foto de antes y una de después.
 * El pago de la tarea se registra como gasto de la propiedad.
 */
export async function completeCleaning(actor: Actor, id: string): Promise<CleaningTask> {
  const t = await workTask(actor, id);
  const before = t.photos.filter((p) => p.phase === 'before').length;
  const after = t.photos.filter((p) => p.phase === 'after').length;
  const missing: string[] = [];
  if (!before) missing.push('al menos una foto de «antes»');
  if (!after) missing.push('al menos una foto de «después»');
  const pendingItems = t.items.filter((i) => !i.done).length;
  if (pendingItems) missing.push(`${pendingItems} punto${pendingItems > 1 ? 's' : ''} de la checklist`);
  if (missing.length) throw new RuleError(`Para cerrar la limpieza falta: ${missing.join(', ')}.`);
  const p = await data().properties.get(t.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const exp = await postTransaction({
    propertyId: p.id,
    type: 'expense',
    category: 'cleaning',
    amount: t.fee,
    date: todayIn(p.timezone),
    description: `Limpieza (${t.type === 'checkout' ? 'salida' : t.type === 'deep' ? 'profunda' : 'inspección'}) · ${p.name}`,
    method: 'transfer',
    source: { kind: 'cleaning', id: t.id },
    createdBy: actor.realUser.id,
  });
  const next: CleaningTask = { ...t, status: 'done', completedAt: nowIso(), expenseId: exp.id };
  await data().cleaningTasks.put(next);
  await audit(actor, 'cleaning.complete', 'cleaning', id, `Terminó la limpieza de ${p.name} (${before} fotos antes, ${after} después).`);
  await pushNotification({ kind: 'cleaning', title: 'Limpieza terminada', body: `${p.name} quedó lista.`, link: `/operacion/limpieza/${id}`, propertyId: p.id, roles: ['owner', 'admin'] });
  return next;
}

export async function cancelCleaning(actor: Actor, id: string): Promise<CleaningTask> {
  const t = await data().cleaningTasks.get(id);
  if (!t) throw new NotFoundError('la tarea');
  await authorize(actor, 'cleaning.write', { propertyId: t.propertyId });
  const next = { ...t, status: 'cancelled' as const };
  await data().cleaningTasks.put(next);
  await audit(actor, 'cleaning.cancel', 'cleaning', id, 'Canceló una limpieza.');
  return next;
}

export interface ProjectedCheckout {
  bookingCode: string;
  propertyId: string;
  propertyName: string;
  date: string;
  time: string;
  /** Solo el nombre del huésped (lo único que ve la limpieza). */
  guestName: string;
  nextCheckIn?: { date: string; time: string };
}

/** Próximas salidas en las propiedades de la persona de limpieza (la tarea se crea al terminar la estadía). */
export async function projectedCheckouts(actor: Actor, days = 7): Promise<ProjectedCheckout[]> {
  const db = data();
  const props = (await db.properties.all()).filter((p) =>
    actor.user.role === 'cleaner' ? p.defaultCleanerId === actor.user.id : actor.user.role === 'owner' || actor.user.role === 'admin',
  );
  if (!props.length) return [];
  const [bookings, people] = await Promise.all([db.bookings.find((b) => b.status === 'confirmed' || b.status === 'in_progress'), db.people.all()]);
  const out: ProjectedCheckout[] = [];
  for (const p of props) {
    const today = todayIn(p.timezone);
    for (const b of bookings.filter((x) => x.propertyId === p.id && x.checkOut >= today && x.checkOut <= addDays(today, days))) {
      const next = bookings.filter((x) => x.propertyId === p.id && x.checkIn >= b.checkOut && x.id !== b.id).sort((a, c) => a.checkIn.localeCompare(c.checkIn))[0];
      out.push({
        bookingCode: b.code,
        propertyId: p.id,
        propertyName: p.name,
        date: b.checkOut,
        time: p.checkOutTime,
        guestName: people.find((x) => x.id === b.guestId)?.name.split(' ')[0] ?? 'Huésped',
        nextCheckIn: next ? { date: next.checkIn, time: p.checkInTime } : undefined,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

// ───────────────────────── Mantenimiento ─────────────────────────

function orderView(o: MaintenanceOrder, p: Property | undefined, users: User[], vendors: Vendor[], canSeeCost: boolean): OrderView {
  const today = todayIn(p?.timezone ?? 'America/New_York');
  const view: OrderView = {
    ...o,
    propertyName: p?.name ?? '—',
    propertyCity: p?.city ?? '',
    propertyAddress: p?.address ?? '',
    heroSrc: p?.photos[0]?.src ?? '',
    timezone: p?.timezone ?? 'America/New_York',
    assigneeName: users.find((u) => u.id === o.assigneeUserId)?.name,
    vendorName: vendors.find((v) => v.id === o.vendorId)?.name,
    overdue: !!o.scheduledDate && o.scheduledDate < today && o.status !== 'resolved' && o.status !== 'cancelled',
    canSeeCost,
  };
  if (!canSeeCost) {
    view.estimate = undefined;
    view.actualCost = undefined;
    view.materials = view.materials.map((m) => ({ ...m, cost: 0 }));
    view.approval = { status: o.approval.status };
  }
  return view;
}

export interface OrderFilter {
  propertyId?: string;
  status?: MaintenanceOrder['status'][];
  priority?: Priority[];
  assigneeUserId?: string;
}

export async function listOrders(actor: Actor, filter: OrderFilter = {}): Promise<OrderView[]> {
  const s = await subjectFor(actor);
  const db = data();
  const [orders, props, users, vendors] = await Promise.all([db.maintenanceOrders.all(), db.properties.all(), db.users.all(), db.vendors.all()]);
  const rank: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return allowed(s, 'maintenance.read', orders, (o) => ({ propertyId: o.propertyId, assigneeId: o.assigneeUserId }))
    .filter(
      (o) =>
        (!filter.propertyId || o.propertyId === filter.propertyId) &&
        (!filter.status || filter.status.includes(o.status)) &&
        (!filter.priority || filter.priority.includes(o.priority)) &&
        (!filter.assigneeUserId || o.assigneeUserId === filter.assigneeUserId),
    )
    .map((o) =>
      orderView(
        o,
        props.find((p) => p.id === o.propertyId),
        users,
        vendors,
        can(s, 'maintenance.readCost', { propertyId: o.propertyId, assigneeId: o.assigneeUserId }) || can(s, 'finance.read', { propertyId: o.propertyId }),
      ),
    )
    .sort((a, b) => rank[a.priority] - rank[b.priority] || (a.scheduledDate ?? '9').localeCompare(b.scheduledDate ?? '9') || b.createdAt.localeCompare(a.createdAt));
}

export async function getOrder(actor: Actor, id: string): Promise<OrderView> {
  const db = data();
  const o = await db.maintenanceOrders.get(id);
  if (!o) throw new NotFoundError('la orden');
  const s = await authorize(actor, 'maintenance.read', { propertyId: o.propertyId, assigneeId: o.assigneeUserId });
  const [p, users, vendors] = await Promise.all([db.properties.get(o.propertyId), db.users.all(), db.vendors.all()]);
  const canSeeCost = can(s, 'maintenance.readCost', { propertyId: o.propertyId, assigneeId: o.assigneeUserId }) || can(s, 'finance.read', { propertyId: o.propertyId });
  return orderView(o, p, users, vendors, canSeeCost);
}

const OrderInput = z.object({
  propertyId: z.string().min(1, 'Elige una propiedad'),
  title: z.string().trim().min(3, 'Escribe un título'),
  description: z.string(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  priority: z.enum(PRIORITIES),
  assigneeUserId: z.string().optional(),
  vendorId: z.string().optional(),
  scheduledDate: isoDate.optional(),
  estimate: z.number().min(0).optional(),
  incidentId: z.string().optional(),
  preventiveId: z.string().optional(),
});
export type OrderInput = z.input<typeof OrderInput>;

async function approvalFor(amount: number | undefined, currency: string, date: string): Promise<MaintenanceOrder['approval']> {
  if (amount == null) return { status: 'not_required' };
  const settings = await getSettings();
  const rates = await data().fxRates.all();
  const base = amount * rateFor(currency, settings.baseCurrency, rates, date);
  return needsOwnerApproval(base, settings.approvalThreshold) ? { status: 'pending', amount } : { status: 'not_required' };
}

/** Crea una orden (sin verificar permisos: la usan los servicios que ya verificaron). */
async function insertOrder(actor: Actor, input: z.output<typeof OrderInput>): Promise<MaintenanceOrder> {
  const db = data();
  const p = await db.properties.get(input.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const vendorId = input.vendorId ?? DEFAULT_VENDOR_FOR[input.category];
  let assigneeUserId = input.assigneeUserId;
  if (!assigneeUserId && vendorId) assigneeUserId = (await db.users.find((u) => u.role === 'technician' && u.vendorId === vendorId && u.active))[0]?.id;
  const count = (await db.maintenanceOrders.all()).length;
  const order: MaintenanceOrder = {
    id: newId('mo'),
    code: `OT-${301 + count}`,
    propertyId: p.id,
    incidentId: input.incidentId,
    title: input.title,
    description: input.description,
    category: input.category,
    priority: input.priority,
    status: input.scheduledDate ? 'scheduled' : 'open',
    assigneeUserId,
    vendorId,
    scheduledDate: input.scheduledDate,
    estimate: input.estimate,
    currency: p.currency,
    materials: [],
    photos: [],
    approval: await approvalFor(input.estimate, p.currency, todayIn(p.timezone)),
    preventiveId: input.preventiveId,
    createdAt: nowIso(),
    createdBy: actor.realUser.id,
  };
  await db.maintenanceOrders.put(order);
  const vendor = vendorId ? await db.vendors.get(vendorId) : undefined;
  await audit(actor, 'maintenance.create', 'maintenance', order.id, `Creó la orden ${order.code} «${order.title}» (${PRIORITY_LABEL[order.priority]}) en ${p.name}${vendor ? ` para ${vendor.name}` : ''}.`);
  if (order.priority === 'urgent' || order.priority === 'high')
    await pushNotification({
      kind: 'urgent',
      title: order.priority === 'urgent' ? 'Orden urgente' : 'Orden de prioridad alta',
      body: `${order.code} · ${order.title} · ${p.name}`,
      link: `/operacion/mantenimiento/${order.id}`,
      propertyId: p.id,
      roles: ['owner', 'admin', 'support'],
      userIds: assigneeUserId ? [assigneeUserId] : undefined,
    });
  if (order.approval.status === 'pending')
    await pushNotification({ kind: 'approval', title: 'Gasto por aprobar', body: `${order.code} · ${order.title}: presupuesto ${order.estimate} ${order.currency}.`, link: `/operacion/mantenimiento/${order.id}`, propertyId: p.id, roles: ['owner'] });
  return order;
}

export async function createOrder(actor: Actor, raw: OrderInput): Promise<MaintenanceOrder> {
  const input = parse(OrderInput, raw);
  await authorize(actor, 'maintenance.write', { propertyId: input.propertyId });
  return insertOrder(actor, input);
}

const AssignInput = z.object({ assigneeUserId: z.string().optional(), vendorId: z.string().optional(), scheduledDate: isoDate.optional() });

export async function assignOrder(actor: Actor, id: string, raw: z.input<typeof AssignInput>): Promise<MaintenanceOrder> {
  const input = parse(AssignInput, raw);
  const db = data();
  const o = await db.maintenanceOrders.get(id);
  if (!o) throw new NotFoundError('la orden');
  await authorize(actor, 'maintenance.write', { propertyId: o.propertyId });
  let assigneeUserId = input.assigneeUserId;
  if (assigneeUserId) {
    const u = await db.users.get(assigneeUserId);
    if (!u || u.role !== 'technician') throw new RuleError('Asigna la orden a un técnico.');
  } else if (input.vendorId) {
    assigneeUserId = (await db.users.find((u) => u.role === 'technician' && u.vendorId === input.vendorId))[0]?.id;
  }
  const next: MaintenanceOrder = {
    ...o,
    assigneeUserId,
    vendorId: input.vendorId ?? o.vendorId,
    scheduledDate: input.scheduledDate ?? o.scheduledDate,
    status: o.status === 'open' && (input.scheduledDate ?? o.scheduledDate) ? 'scheduled' : o.status,
  };
  await db.maintenanceOrders.put(next);
  const who = assigneeUserId ? (await db.users.get(assigneeUserId))?.name : (await db.vendors.get(next.vendorId ?? ''))?.name;
  await audit(actor, 'maintenance.assign', 'maintenance', id, `Asignó ${o.code} a ${who ?? 'nadie'}.`);
  if (assigneeUserId)
    await pushNotification({ kind: 'urgent', title: 'Te asignaron una orden', body: `${o.code} · ${o.title}`, link: `/tecnico/orden/${id}`, propertyId: o.propertyId, roles: [], userIds: [assigneeUserId] });
  return next;
}

const OrderPatch = z
  .object({
    status: z.enum(['open', 'scheduled', 'in_progress', 'cancelled']),
    priority: z.enum(PRIORITIES),
    scheduledDate: isoDate,
    estimate: z.number().min(0),
    materials: z.array(z.object({ name: z.string().min(1), qty: z.number().min(0), cost: z.number().min(0) })),
    description: z.string(),
  })
  .partial();
export type OrderPatch = z.input<typeof OrderPatch>;

/** Cambios de la orden: el equipo (maintenance.write) o el técnico asignado (maintenance.work). */
export async function updateOrder(actor: Actor, id: string, raw: OrderPatch): Promise<MaintenanceOrder> {
  const patch = parse(OrderPatch, raw);
  const db = data();
  const o = await db.maintenanceOrders.get(id);
  if (!o) throw new NotFoundError('la orden');
  const s = await subjectFor(actor);
  const res = { propertyId: o.propertyId, assigneeId: o.assigneeUserId };
  const isTeam = can(s, 'maintenance.write', res);
  if (!isTeam && !can(s, 'maintenance.work', res)) throw new ForbiddenError(s.readOnly ? 'Modo «Ver como…»: solo mirar.' : 'Esta orden no es tuya.');
  if (!isTeam && (patch.priority || patch.status === 'cancelled')) throw new ForbiddenError('Solo el equipo cambia la prioridad o cancela.');
  if (o.status === 'resolved' || o.status === 'cancelled') throw new RuleError('La orden ya está cerrada.');
  const next: MaintenanceOrder = { ...o, ...patch };
  if (patch.estimate != null && patch.estimate !== o.estimate && o.approval.status !== 'approved') {
    const p = await db.properties.get(o.propertyId);
    next.approval = await approvalFor(patch.estimate, o.currency, todayIn(p?.timezone ?? 'America/New_York'));
    if (next.approval.status === 'pending')
      await pushNotification({ kind: 'approval', title: 'Gasto por aprobar', body: `${o.code} · ${o.title}: presupuesto ${patch.estimate} ${o.currency}.`, link: `/operacion/mantenimiento/${o.id}`, propertyId: o.propertyId, roles: ['owner'] });
  }
  await db.maintenanceOrders.put(next);
  await audit(actor, 'maintenance.update', 'maintenance', id, `Actualizó ${o.code}.`);
  return next;
}

export async function addOrderPhoto(actor: Actor, id: string, phase: 'report' | 'resolved', file: Blob): Promise<MaintenanceOrder> {
  const db = data();
  const o = await db.maintenanceOrders.get(id);
  if (!o) throw new NotFoundError('la orden');
  const s = await subjectFor(actor);
  const res = { propertyId: o.propertyId, assigneeId: o.assigneeUserId };
  if (!can(s, 'maintenance.work', res) && !can(s, 'maintenance.write', res)) throw new ForbiddenError(s.readOnly ? 'Modo «Ver como…»: solo mirar.' : 'Esta orden no es tuya.');
  const fileId = await storeFile(file, `${phase}-${o.code}.webp`);
  const next = { ...o, photos: [...o.photos, { fileId, phase, at: nowIso() }] };
  await db.maintenanceOrders.put(next);
  return next;
}

const ResolveInput = z.object({
  actualCost: z.number({ error: 'Escribe el costo real' }).min(0, 'El costo no puede ser negativo'),
  materials: z.array(z.object({ name: z.string().min(1), qty: z.number().min(0), cost: z.number().min(0) })),
  note: z.string(),
});
export type ResolveInput = z.input<typeof ResolveInput>;

/**
 * El técnico (o el equipo) resuelve la orden con foto y costo real. El costo se vuelve gasto de la
 * propiedad; si supera el umbral y no estaba aprobado, el gasto queda pendiente de aprobación.
 */
export async function resolveOrder(actor: Actor, id: string, raw: ResolveInput): Promise<{ order: MaintenanceOrder; expenseStatus: 'posted' | 'pending_approval' }> {
  const input = parse(ResolveInput, raw);
  const db = data();
  const o = await db.maintenanceOrders.get(id);
  if (!o) throw new NotFoundError('la orden');
  const s = await subjectFor(actor);
  const res = { propertyId: o.propertyId, assigneeId: o.assigneeUserId };
  if (!can(s, 'maintenance.work', res) && !can(s, 'maintenance.write', res)) throw new ForbiddenError(s.readOnly ? 'Modo «Ver como…»: solo mirar.' : 'Esta orden no es tuya.');
  if (o.status === 'resolved' || o.status === 'cancelled') throw new RuleError('La orden ya está cerrada.');
  if (!o.photos.some((p) => p.phase === 'resolved')) throw new RuleError('Agrega al menos una foto de lo resuelto.');
  if (o.approval.status === 'rejected') throw new RuleError('El propietario rechazó este gasto: habla con administración.');
  const p = await db.properties.get(o.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const settings = await getSettings();
  const costBase = input.actualCost * rateFor(o.currency, settings.baseCurrency, await db.fxRates.all(), todayIn(p.timezone));
  const approvedCovers = o.approval.status === 'approved' && (o.approval.amount == null || input.actualCost <= o.approval.amount * 1.1);
  const needsApproval = needsOwnerApproval(costBase, settings.approvalThreshold) && !approvedCovers;
  let expenseStatus: 'posted' | 'pending_approval' = 'posted';
  let expenseId: string | undefined;
  if (input.actualCost > 0) {
    const tx = await postTransaction({
      propertyId: p.id,
      type: 'expense',
      category: 'maintenance',
      amount: input.actualCost,
      date: todayIn(p.timezone),
      description: `${o.code} · ${o.title}`,
      method: 'transfer',
      status: needsApproval ? 'pending_approval' : 'posted',
      source: { kind: 'maintenance', id: o.id },
      createdBy: actor.realUser.id,
    });
    expenseId = tx.id;
    expenseStatus = tx.status === 'pending_approval' ? 'pending_approval' : 'posted';
  }
  const next: MaintenanceOrder = {
    ...o,
    status: 'resolved',
    actualCost: round2(input.actualCost),
    materials: input.materials.length ? input.materials : o.materials,
    resolutionNote: input.note,
    resolvedAt: nowIso(),
    expenseId,
    approval: needsApproval ? { status: 'pending', amount: input.actualCost } : o.approval,
  };
  await db.maintenanceOrders.put(next);
  if (o.incidentId) {
    const inc = await db.incidents.get(o.incidentId);
    if (inc) await db.incidents.put({ ...inc, status: 'resolved', updatedAt: nowIso() });
  }
  await audit(actor, 'maintenance.resolve', 'maintenance', id, `Resolvió ${o.code} con costo ${input.actualCost} ${o.currency}${needsApproval ? ' (pendiente de aprobación)' : ''}.`);
  await pushNotification({
    kind: needsApproval ? 'approval' : 'incident',
    title: needsApproval ? 'Gasto por aprobar' : 'Orden resuelta',
    body: `${o.code} · ${o.title} · ${input.actualCost} ${o.currency}`,
    link: `/operacion/mantenimiento/${o.id}`,
    propertyId: o.propertyId,
    roles: needsApproval ? ['owner'] : ['owner', 'admin'],
  });
  return { order: next, expenseStatus };
}

/** Solo el propietario aprueba: si ya hay gasto pendiente, entra a las cuentas. */
export async function approveOrder(actor: Actor, id: string, note = ''): Promise<MaintenanceOrder> {
  const db = data();
  const o = await db.maintenanceOrders.get(id);
  if (!o) throw new NotFoundError('la orden');
  await authorize(actor, 'maintenance.approve', { propertyId: o.propertyId });
  if (o.approval.status !== 'pending') throw new RuleError('Esta orden no espera aprobación.');
  const next: MaintenanceOrder = { ...o, approval: { ...o.approval, status: 'approved', decidedBy: actor.realUser.id, decidedAt: nowIso(), note } };
  await db.maintenanceOrders.put(next);
  if (o.expenseId) {
    const tx = await db.transactions.get(o.expenseId);
    if (tx && tx.status === 'pending_approval') await db.transactions.put({ ...tx, status: 'posted' });
  }
  await audit(actor, 'maintenance.approve', 'maintenance', id, `Aprobó el gasto de ${o.code} (${o.approval.amount ?? o.estimate} ${o.currency}).`);
  return next;
}

export async function rejectOrder(actor: Actor, id: string, note: string): Promise<MaintenanceOrder> {
  const db = data();
  const o = await db.maintenanceOrders.get(id);
  if (!o) throw new NotFoundError('la orden');
  await authorize(actor, 'maintenance.approve', { propertyId: o.propertyId });
  if (o.approval.status !== 'pending') throw new RuleError('Esta orden no espera aprobación.');
  const next: MaintenanceOrder = { ...o, approval: { ...o.approval, status: 'rejected', decidedBy: actor.realUser.id, decidedAt: nowIso(), note } };
  await db.maintenanceOrders.put(next);
  if (o.expenseId) {
    const tx = await db.transactions.get(o.expenseId);
    if (tx) await db.transactions.put({ ...tx, status: 'void' });
  }
  await audit(actor, 'maintenance.reject', 'maintenance', id, `Rechazó el gasto de ${o.code}: ${note || 'sin nota'}.`);
  return next;
}

// ───────────────────────── Incidencias ─────────────────────────

const IncidentInput = z.object({
  propertyId: z.string().min(1, 'Elige una propiedad'),
  title: z.string().trim().min(3, 'Describe el problema en pocas palabras'),
  description: z.string(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  severity: z.enum(PRIORITIES),
  source: z.enum(['cleaning', 'guest', 'tenant', 'team']),
  kind: z.enum(['damage', 'missing', 'problem']),
  cleaningTaskId: z.string().optional(),
  bookingId: z.string().optional(),
  leaseId: z.string().optional(),
});
export type IncidentInput = z.input<typeof IncidentInput> & { photo?: Blob };

/**
 * Reportar un problema (huésped, inquilino, limpieza o equipo). Si es urgente o alto,
 * se vuelve sola una orden de mantenimiento con esa prioridad, asignada al proveedor de la categoría.
 */
export async function createIncident(actor: Actor, raw: IncidentInput): Promise<{ incident: Incident; order?: MaintenanceOrder }> {
  const { photo, ...rest } = raw;
  const input = parse(IncidentInput, rest);
  await authorize(actor, 'incident.create', { propertyId: input.propertyId });
  const db = data();
  const p = await db.properties.get(input.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const photos = photo ? [await storeFile(photo, `incidencia-${Date.now()}.webp`)] : [];
  const reporter = actor.user.personId && (actor.user.role === 'guest' || actor.user.role === 'tenant') ? `person:${actor.user.personId}` : actor.user.id;
  let incident: Incident = {
    id: newId('inc'),
    ...input,
    reportedBy: reporter,
    reporterName: actor.user.name,
    photos,
    status: 'open',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await db.incidents.put(incident);
  let order: MaintenanceOrder | undefined;
  if (input.severity === 'urgent' || input.severity === 'high') {
    order = await insertOrder(actor, {
      propertyId: p.id,
      title: input.title,
      description: `${input.description}${input.description ? '\n' : ''}Reportado por ${actor.user.name}.`,
      category: input.category,
      priority: input.severity,
      incidentId: incident.id,
    });
    if (photos.length) {
      order = { ...order, photos: photos.map((fileId) => ({ fileId, phase: 'report' as const, at: nowIso() })) };
      await db.maintenanceOrders.put(order);
    }
    incident = { ...incident, status: 'in_progress', maintenanceOrderId: order.id };
    await db.incidents.put(incident);
  }
  await audit(actor, 'incident.create', 'incident', incident.id, `Reportó «${incident.title}» en ${p.name} (${PRIORITY_LABEL[incident.severity]})${order ? ` → orden ${order.code}` : ''}.`);
  await pushNotification({
    kind: 'incident',
    title: input.kind === 'damage' ? 'Daño reportado' : input.kind === 'missing' ? 'Faltante reportado' : 'Problema reportado',
    body: `${actor.user.name}: ${incident.title} (${p.name})`,
    link: order ? `/operacion/mantenimiento/${order.id}` : '/operacion/incidencias',
    propertyId: p.id,
    roles: ['owner', 'admin', 'support'],
  });
  return { incident, order };
}

export async function listIncidents(actor: Actor, filter: { status?: Incident['status'][]; propertyId?: string } = {}): Promise<IncidentView[]> {
  const s = await subjectFor(actor);
  const db = data();
  const [incidents, props, orders] = await Promise.all([db.incidents.all(), db.properties.all(), db.maintenanceOrders.all()]);
  return allowed(s, 'incident.read', incidents, (i) => ({ propertyId: i.propertyId }))
    .filter((i) => (!filter.status || filter.status.includes(i.status)) && (!filter.propertyId || i.propertyId === filter.propertyId))
    .map((i) => ({ ...i, propertyName: props.find((p) => p.id === i.propertyId)?.name ?? '—', orderCode: orders.find((o) => o.id === i.maintenanceOrderId)?.code }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Atención al cliente o administración convierte la incidencia en orden y la asigna. */
export async function assignIncident(actor: Actor, id: string, raw: { priority: Priority; assigneeUserId?: string; vendorId?: string; scheduledDate?: string }): Promise<MaintenanceOrder> {
  const db = data();
  const inc = await db.incidents.get(id);
  if (!inc) throw new NotFoundError('la incidencia');
  await authorize(actor, 'incident.assign', { propertyId: inc.propertyId });
  if (inc.maintenanceOrderId) throw new RuleError('Esta incidencia ya tiene orden.');
  const order = await insertOrder(actor, {
    propertyId: inc.propertyId,
    title: inc.title,
    description: inc.description,
    category: inc.category,
    priority: raw.priority,
    assigneeUserId: raw.assigneeUserId,
    vendorId: raw.vendorId,
    scheduledDate: raw.scheduledDate,
    incidentId: inc.id,
  });
  if (inc.photos.length) await db.maintenanceOrders.put({ ...order, photos: inc.photos.map((fileId) => ({ fileId, phase: 'report' as const, at: nowIso() })) });
  await db.incidents.put({ ...inc, status: 'in_progress', maintenanceOrderId: order.id, updatedAt: nowIso() });
  return order;
}

export async function dismissIncident(actor: Actor, id: string): Promise<void> {
  const db = data();
  const inc = await db.incidents.get(id);
  if (!inc) throw new NotFoundError('la incidencia');
  await authorize(actor, 'incident.assign', { propertyId: inc.propertyId });
  await db.incidents.put({ ...inc, status: 'dismissed', updatedAt: nowIso() });
  await audit(actor, 'incident.dismiss', 'incident', id, `Descartó la incidencia «${inc.title}».`);
}

/** Incidencias que reportó la persona (huésped o inquilino) o el usuario. */
export async function myIncidents(actor: Actor): Promise<IncidentView[]> {
  const db = data();
  const key = actor.user.personId && (actor.user.role === 'guest' || actor.user.role === 'tenant') ? `person:${actor.user.personId}` : actor.user.id;
  const [incidents, props] = await Promise.all([db.incidents.find((i) => i.reportedBy === key), db.properties.all()]);
  return incidents
    .map((i) => ({ ...i, propertyName: props.find((p) => p.id === i.propertyId)?.name ?? '—' }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ───────────────────────── Preventivo ─────────────────────────

export interface PreventiveView extends PreventiveSchedule {
  propertyName: string;
  vendorName?: string;
  categoryLabel: string;
  dueInDays: number;
}

export async function listPreventive(actor: Actor): Promise<PreventiveView[]> {
  const s = await authorize(actor, 'maintenance.write');
  const db = data();
  const [items, props, vendors] = await Promise.all([db.preventive.all(), db.properties.all(), db.vendors.all()]);
  return allowed(s, 'maintenance.write', items, (x) => ({ propertyId: x.propertyId }))
    .map((x) => {
      const p = props.find((pp) => pp.id === x.propertyId);
      return {
        ...x,
        propertyName: p?.name ?? '—',
        vendorName: vendors.find((v) => v.id === x.vendorId)?.name,
        categoryLabel: MAINTENANCE_CATEGORY_LABEL[x.category],
        dueInDays: diffDays(todayIn(p?.timezone ?? 'America/New_York'), x.nextDue),
      };
    })
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

const PreventiveInput = z.object({
  propertyId: z.string().min(1, 'Elige una propiedad'),
  title: z.string().trim().min(3, 'Escribe un título'),
  category: z.enum(MAINTENANCE_CATEGORIES),
  every: z.object({ unit: z.enum(['week', 'month']), count: z.number().int().min(1) }),
  nextDue: isoDate,
  vendorId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  estimate: z.number().min(0).optional(),
});
export type PreventiveInput = z.input<typeof PreventiveInput>;

export async function savePreventive(actor: Actor, raw: PreventiveInput & { id?: string; active?: boolean }): Promise<PreventiveSchedule> {
  const input = parse(PreventiveInput, raw);
  await authorize(actor, 'maintenance.write', { propertyId: input.propertyId });
  const db = data();
  const prev = raw.id ? await db.preventive.get(raw.id) : undefined;
  const item: PreventiveSchedule = { ...prev, ...input, id: prev?.id ?? newId('pv'), active: raw.active ?? prev?.active ?? true };
  await db.preventive.put(item);
  await audit(actor, 'maintenance.preventive', 'preventive', item.id, `${prev ? 'Editó' : 'Creó'} el preventivo «${item.title}».`);
  return item;
}

/**
 * Preventivo automático: cada calendario vencido crea su orden (una vez por fecha) y avanza
 * la próxima fecha. Corre al abrir la app y cada minuto.
 */
export async function runPreventive(): Promise<MaintenanceOrder[]> {
  const db = data();
  const system = await getSystemActor();
  const created: MaintenanceOrder[] = [];
  for (const sch of await db.preventive.find((x) => x.active)) {
    const p = await db.properties.get(sch.propertyId);
    if (!p) continue;
    const today = todayIn(p.timezone);
    if (sch.nextDue > today || sch.lastCreatedFor === sch.nextDue) continue;
    const order = await insertOrder(system, {
      propertyId: p.id,
      title: sch.title,
      description: `Preventivo automático (cada ${sch.every.count} ${sch.every.unit === 'week' ? (sch.every.count > 1 ? 'semanas' : 'semana') : sch.every.count > 1 ? 'meses' : 'mes'}).`,
      category: sch.category,
      priority: 'low',
      vendorId: sch.vendorId,
      assigneeUserId: sch.assigneeUserId,
      scheduledDate: sch.nextDue,
      estimate: sch.estimate,
      preventiveId: sch.id,
    });
    created.push(order);
    await db.preventive.put({ ...sch, lastCreatedFor: sch.nextDue, nextDue: nextDueDate(sch.nextDue, sch.every) });
  }
  return created;
}

// ───────────────────────── Proveedores ─────────────────────────

export interface VendorView extends Vendor {
  openOrders: number;
  doneOrders: number;
  hasAppUser: boolean;
}

export async function listVendors(actor: Actor): Promise<VendorView[]> {
  await authorize(actor, 'vendor.read');
  const db = data();
  const [vendors, orders, users] = await Promise.all([db.vendors.all(), db.maintenanceOrders.all(), db.users.all()]);
  return vendors
    .map((v) => ({
      ...v,
      openOrders: orders.filter((o) => o.vendorId === v.id && o.status !== 'resolved' && o.status !== 'cancelled').length,
      doneOrders: orders.filter((o) => o.vendorId === v.id && o.status === 'resolved').length,
      hasAppUser: users.some((u) => u.vendorId === v.id),
    }))
    .sort((a, b) => b.rating - a.rating);
}

export async function saveVendor(actor: Actor, raw: z.input<typeof VendorSchema>): Promise<Vendor> {
  await authorize(actor, 'vendor.write');
  const input = parse(VendorSchema, raw);
  await data().vendors.put(input);
  await audit(actor, 'vendor.save', 'vendor', input.id, `Guardó el proveedor «${input.name}».`);
  return input;
}

export function newVendorId(): string {
  return newId('v');
}
