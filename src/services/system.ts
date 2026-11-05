/**
 * Sistema: avisos (campana), calendario general, ajustes, equipo, auditoría, cuentas de ejemplo,
 * tareas automáticas (tick) y herramientas de la demo (restablecer, exportar e importar JSON).
 */
import { data } from '@/data';
import { buildSeed } from '@/data/seed';
import { TABLE_NAMES, type Snapshot, type Tables } from '@/data/store';
import { ROLE_LABEL } from '@/domain/labels';
import { dueDateFor } from '@/domain/rules';
import {
  AccessCodeSchema,
  AuditEntrySchema,
  BlockSchema,
  BookingSchema,
  BudgetSchema,
  ChecklistSchema,
  CleaningTaskSchema,
  CustomCategorySchema,
  DocumentSchema,
  ExportedFileSchema,
  FxRateSchema,
  IncidentSchema,
  LeasePaymentSchema,
  LeaseSchema,
  MaintenanceOrderSchema,
  MessageSchema,
  NotificationReadSchema,
  NotificationSchema,
  PersonSchema,
  PreventiveSchema,
  PropertySchema,
  RoleSchema,
  SettingsSchema,
  TemplateSchema,
  ThreadSchema,
  TransactionSchema,
  UserSchema,
  VendorSchema,
  type AppNotification,
  type FileRecord,
  type NotificationKind,
  type Role,
  type Settings,
  type User,
} from '@/domain/types';
import { clock, nowIso, todayIn, todayLocal } from '@/lib/clock';
import { addDays, addMonthsToKey, monthKeyOf } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { z } from 'zod';
import { autoProgressBookings } from './bookings';
import {
  actorFor,
  allowed,
  audit,
  authorize,
  can,
  ForbiddenError,
  getSettings,
  NotFoundError,
  parse,
  RuleError,
  subjectFor,
  type Actor,
} from './core';
import { listDocuments } from './documents';
import { listLeases } from './leases';
import { listCleaning, listOrders, runPreventive } from './operations';
import { storeFile } from './files';

// ───────────────────────── Cuentas de ejemplo («Entrar como…») ─────────────────────────

export interface DemoAccount {
  user: User;
  roleLabel: string;
}

/** Cuentas para «Entrar como…» (sin contraseñas: es una demo). */
export async function demoAccounts(): Promise<DemoAccount[]> {
  const order: Role[] = ['owner', 'admin', 'support', 'cleaner', 'technician', 'guest', 'tenant', 'accountant'];
  const users = (await data().users.all()).filter((u) => u.active);
  return users
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name))
    .map((user) => ({ user, roleLabel: ROLE_LABEL[user.role] }));
}

export async function getUser(id: string): Promise<User | undefined> {
  return data().users.get(id);
}

// ───────────────────────── Avisos ─────────────────────────

export interface NotificationView {
  id: string;
  at: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  propertyId?: string;
  read: boolean;
  /** Calculado del estado actual (no guardado). */
  derived: boolean;
  tone: 'urgent' | 'warn' | 'good' | 'info';
}

const toneOf = (kind: NotificationKind): NotificationView['tone'] =>
  kind === 'urgent' ? 'urgent' : kind === 'payment' || kind === 'document' || kind === 'approval' || kind === 'renewal' || kind === 'cleaning' ? 'warn' : 'info';

/** Avisos del usuario: los guardados (eventos) más los que salen del estado actual. */
export async function listNotifications(actor: Actor): Promise<NotificationView[]> {
  const s = await authorize(actor, 'notification.read');
  const db = data();
  const user = actor.user;
  const [stored, reads] = await Promise.all([db.notifications.all(), db.notificationReads.find((r) => r.userId === actor.realUser.id)]);
  const readIds = new Set(reads.map((r) => r.notificationId));
  const out: NotificationView[] = [];
  const add = (n: Omit<NotificationView, 'read' | 'tone'> & { tone?: NotificationView['tone'] }) =>
    out.push({ ...n, tone: n.tone ?? toneOf(n.kind), read: readIds.has(n.id) });

  for (const n of stored) {
    const forMe = n.userIds?.includes(user.id) || n.roles.includes(user.role);
    if (!forMe) continue;
    if (n.propertyId && user.role !== 'owner' && !n.userIds?.includes(user.id) && !can(s, 'property.read', { propertyId: n.propertyId }) && s.propertyIds !== 'all')
      continue;
    add({ id: n.id, at: n.at, kind: n.kind, title: n.title, body: n.body, link: n.link, propertyId: n.propertyId, derived: false });
  }

  const now = nowIso();
  const team = user.role === 'owner' || user.role === 'admin';
  // Urgencias abiertas
  if (team || user.role === 'support' || user.role === 'technician') {
    for (const o of await listOrders(actor, { status: ['open', 'scheduled', 'in_progress'] })) {
      if (o.priority !== 'urgent') continue;
      add({ id: `d:urgent:${o.id}`, at: o.createdAt, kind: 'urgent', title: 'Urgente', body: `${o.code} · ${o.title} · ${o.propertyName}`, link: user.role === 'technician' ? `/tecnico/orden/${o.id}` : `/operacion/mantenimiento/${o.id}`, propertyId: o.propertyId, derived: true });
    }
  }
  // Aprobaciones pendientes (propietario)
  if (user.role === 'owner') {
    for (const o of await listOrders(actor)) {
      if (o.approval.status !== 'pending') continue;
      add({ id: `d:approval:${o.id}`, at: o.createdAt, kind: 'approval', title: 'Gasto por aprobar', body: `${o.code} · ${o.title} · ${o.approval.amount ?? o.estimate ?? ''} ${o.currency}`, link: `/operacion/mantenimiento/${o.id}`, propertyId: o.propertyId, derived: true });
    }
  }
  // Rentas atrasadas y renovaciones
  if (team || user.role === 'accountant' || user.role === 'tenant') {
    for (const l of await listLeases(actor)) {
      if (l.status !== 'active') continue;
      for (const r of l.ledger.filter((x) => x.status === 'overdue'))
        add({
          id: `d:rent:${l.id}:${r.period}`,
          at: `${r.dueDate}T12:00:00.000Z`,
          kind: 'payment',
          title: user.role === 'tenant' ? 'Tu pago está atrasado' : 'Renta atrasada',
          body: user.role === 'tenant' ? `Renta de ${r.period}: ${r.rent} ${l.currency} + recargo ${r.lateFee}.` : `${l.tenantName} · ${l.propertyName} · ${r.period} (${r.daysLate} días)`,
          link: user.role === 'tenant' ? '/inquilino' : `/contratos/${l.id}`,
          propertyId: l.propertyId,
          derived: true,
          tone: 'urgent',
        });
      if (l.renewalDue && user.role !== 'accountant')
        add({ id: `d:renew:${l.id}`, at: now, kind: 'renewal', title: user.role === 'tenant' ? 'Tu contrato termina pronto' : 'Renovación de contrato', body: `${l.code} termina en ${l.daysToEnd} días (${l.end}).`, link: user.role === 'tenant' ? '/inquilino' : `/contratos/${l.id}`, propertyId: l.propertyId, derived: true });
    }
  }
  // Documentos por vencer o vencidos
  if (team || user.role === 'accountant') {
    for (const d of await listDocuments(actor)) {
      if (d.status !== 'expiring' && d.status !== 'expired') continue;
      add({
        id: `d:doc:${d.id}:${d.status}`,
        at: now,
        kind: 'document',
        title: d.status === 'expired' ? 'Documento vencido' : 'Documento por vencer',
        body: `${d.name}${d.daysToExpiry != null ? (d.daysToExpiry < 0 ? ` · venció hace ${-d.daysToExpiry} días` : ` · vence en ${d.daysToExpiry} días`) : ''}`,
        link: '/documentos',
        propertyId: d.propertyId,
        derived: true,
        tone: d.status === 'expired' ? 'urgent' : 'warn',
      });
    }
  }
  // Limpiezas sin hacer (y las de hoy para la limpieza)
  if (team || user.role === 'cleaner') {
    for (const t of await listCleaning(actor, { status: ['pending', 'in_progress'] })) {
      const today = todayIn(t.timezone);
      if (t.date < today)
        add({ id: `d:clean:${t.id}`, at: `${t.date}T12:00:00.000Z`, kind: 'cleaning', title: 'Limpieza sin hacer', body: `${t.propertyName} · era para ${t.date}`, link: user.role === 'cleaner' ? `/limpieza/tarea/${t.id}` : `/operacion/limpieza/${t.id}`, propertyId: t.propertyId, derived: true, tone: 'urgent' });
      else if (t.date === today && user.role === 'cleaner')
        add({ id: `d:cleantoday:${t.id}`, at: now, kind: 'cleaning', title: 'Limpieza de hoy', body: `${t.propertyName} · ${t.time}`, link: `/limpieza/tarea/${t.id}`, propertyId: t.propertyId, derived: true });
    }
  }
  return out.sort((a, b) => Number(a.read) - Number(b.read) || b.at.localeCompare(a.at));
}

export async function unreadCount(actor: Actor): Promise<number> {
  return (await listNotifications(actor)).filter((n) => !n.read).length;
}

export async function markNotificationRead(actor: Actor, id: string): Promise<void> {
  if (actor.readOnly) return;
  await data().notificationReads.put({ id: `${actor.realUser.id}|${id}`, userId: actor.realUser.id, notificationId: id, at: nowIso() });
}

export async function markAllNotificationsRead(actor: Actor): Promise<void> {
  if (actor.readOnly) return;
  const list = await listNotifications(actor);
  await data().notificationReads.bulkPut(
    list.filter((n) => !n.read).map((n) => ({ id: `${actor.realUser.id}|${n.id}`, userId: actor.realUser.id, notificationId: n.id, at: nowIso() })),
  );
}

// ───────────────────────── Calendario general ─────────────────────────

export type CalendarEventKind = 'checkin' | 'checkout' | 'cleaning' | 'maintenance' | 'expiry' | 'rent' | 'lease_end';

export interface CalendarEvent {
  id: string;
  date: string;
  time?: string;
  kind: CalendarEventKind;
  title: string;
  subtitle: string;
  propertyId?: string;
  propertyName?: string;
  link?: string;
  tone: 'good' | 'warn' | 'urgent' | 'info' | 'neutral';
}

/** Entradas, salidas, limpiezas, mantenimiento, vencimientos y pagos en [from, to). */
export async function calendarEvents(actor: Actor, from: string, to: string): Promise<CalendarEvent[]> {
  const s = await authorize(actor, 'calendar.read');
  const db = data();
  const [bookings, props, people] = await Promise.all([db.bookings.all(), db.properties.all(), db.people.all()]);
  const pname = (id?: string) => props.find((p) => p.id === id)?.name;
  const events: CalendarEvent[] = [];
  const inRange = (d: string) => d >= from && d < to;

  for (const b of allowed(s, 'booking.read', bookings, (x) => ({ propertyId: x.propertyId, personId: x.guestId }))) {
    if (b.status === 'cancelled') continue;
    const p = props.find((x) => x.id === b.propertyId);
    const guest = people.find((x) => x.id === b.guestId)?.name ?? 'Huésped';
    if (inRange(b.checkIn)) events.push({ id: `ci-${b.id}`, date: b.checkIn, time: p?.checkInTime, kind: 'checkin', title: `Entrada · ${guest}`, subtitle: `${b.code} · ${b.guests} personas`, propertyId: b.propertyId, propertyName: p?.name, link: `/reservas/${b.id}`, tone: 'good' });
    if (inRange(b.checkOut)) events.push({ id: `co-${b.id}`, date: b.checkOut, time: p?.checkOutTime, kind: 'checkout', title: `Salida · ${guest}`, subtitle: b.code, propertyId: b.propertyId, propertyName: p?.name, link: `/reservas/${b.id}`, tone: 'info' });
  }
  const cleanerLink = actor.user.role === 'cleaner';
  for (const t of await listCleaning(actor, { from, to })) {
    if (t.status === 'cancelled') continue;
    events.push({ id: `cl-${t.id}`, date: t.date, time: t.time, kind: 'cleaning', title: t.type === 'checkout' ? 'Limpieza de salida' : t.type === 'deep' ? 'Limpieza profunda' : 'Inspección', subtitle: `${t.assigneeName ?? 'Sin asignar'} · ${t.status === 'done' ? 'hecha' : 'pendiente'}`, propertyId: t.propertyId, propertyName: t.propertyName, link: cleanerLink ? `/limpieza/tarea/${t.id}` : `/operacion/limpieza/${t.id}`, tone: t.status === 'done' ? 'neutral' : t.overdue ? 'urgent' : 'warn' });
  }
  if (can(s, 'maintenance.write') || actor.user.role === 'support') {
    for (const o of await listOrders(actor)) {
      if (!o.scheduledDate || !inRange(o.scheduledDate) || o.status === 'cancelled') continue;
      events.push({ id: `mo-${o.id}`, date: o.scheduledDate, kind: 'maintenance', title: o.title, subtitle: `${o.code} · ${o.vendorName ?? o.assigneeName ?? 'Sin asignar'}`, propertyId: o.propertyId, propertyName: o.propertyName, link: `/operacion/mantenimiento/${o.id}`, tone: o.priority === 'urgent' ? 'urgent' : o.status === 'resolved' ? 'neutral' : 'warn' });
    }
  }
  if (actor.user.role !== 'cleaner' && actor.user.role !== 'technician') {
    for (const d of await listDocuments(actor)) {
      if (!d.expiresOn || !inRange(d.expiresOn)) continue;
      events.push({ id: `ex-${d.id}`, date: d.expiresOn, kind: 'expiry', title: `Vence: ${d.name}`, subtitle: d.categoryLabel, propertyId: d.propertyId, propertyName: d.propertyName, link: '/documentos', tone: d.status === 'expired' ? 'urgent' : 'warn' });
    }
  }
  if (can(s, 'lease.read')) {
    for (const l of await listLeases(actor)) {
      if (l.status !== 'active') continue;
      for (let m = monthKeyOf(from); m <= monthKeyOf(to); m = addMonthsToKey(m, 1)) {
        const due = dueDateFor(l, m);
        if (!inRange(due) || due < l.start || due > l.end) continue;
        const row = l.ledger.find((r) => r.period === m);
        events.push({ id: `rent-${l.id}-${m}`, date: due, kind: 'rent', title: `Renta · ${l.tenantName}`, subtitle: `${l.code} · ${row?.status === 'paid' || row?.status === 'paid_late' ? 'pagada' : row?.status === 'overdue' ? 'atrasada' : 'por pagar'}`, propertyId: l.propertyId, propertyName: l.propertyName, link: `/contratos/${l.id}`, tone: row?.status === 'overdue' ? 'urgent' : row?.status === 'paid' || row?.status === 'paid_late' ? 'neutral' : 'warn' });
      }
      if (inRange(l.end)) events.push({ id: `le-${l.id}`, date: l.end, kind: 'lease_end', title: `Fin de contrato · ${l.tenantName}`, subtitle: l.code, propertyId: l.propertyId, propertyName: l.propertyName, link: `/contratos/${l.id}`, tone: 'warn' });
    }
  }
  return events
    .map((e) => ({ ...e, propertyName: e.propertyName ?? pname(e.propertyId) }))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '99').localeCompare(b.time ?? '99'));
}

// ───────────────────────── Ajustes ─────────────────────────

export async function getAppSettings(actor: Actor): Promise<Settings> {
  await authorize(actor, 'settings.read');
  return getSettings();
}

/** Nombre de la empresa (lo ven todos, por ejemplo en la entrada). */
export async function getCompanyName(): Promise<{ companyName: string; logoFileId?: string }> {
  const s = await data().settings.get('app');
  return { companyName: s?.companyName ?? 'Gestor de Propiedades', logoFileId: s?.logoFileId };
}

const SettingsPatch = SettingsSchema.pick({ companyName: true, baseCurrency: true, approvalThreshold: true, shareOwnerFinancials: true, guestLanguages: true, theme: true }).partial();

export async function updateSettings(actor: Actor, raw: z.input<typeof SettingsPatch>): Promise<Settings> {
  await authorize(actor, 'settings.write');
  const patch = parse(SettingsPatch, raw);
  const prev = await getSettings();
  const next = { ...prev, ...patch };
  await data().settings.put(next);
  const changes = Object.keys(patch).join(', ');
  await audit(actor, 'settings.update', 'settings', 'app', `Cambió ajustes: ${changes}.`);
  return next;
}

export async function saveCustomCategories(actor: Actor, categories: { key: string; label: string }[]): Promise<Settings> {
  await authorize(actor, 'finance.write');
  const list = parse(z.array(CustomCategorySchema), categories);
  const next = { ...(await getSettings()), customExpenseCategories: list };
  await data().settings.put(next);
  await audit(actor, 'settings.categories', 'settings', 'app', `Actualizó las categorías de gasto (${list.length} propias).`);
  return next;
}

export async function setCompanyLogo(actor: Actor, file: Blob): Promise<Settings> {
  await authorize(actor, 'settings.write');
  const fileId = await storeFile(file, 'logo.webp');
  const next = { ...(await getSettings()), logoFileId: fileId };
  await data().settings.put(next);
  await audit(actor, 'settings.logo', 'settings', 'app', 'Cambió el logo.');
  return next;
}

// ───────────────────────── Equipo ─────────────────────────

export interface TeamMember extends User {
  roleLabel: string;
  propertyNames: string[];
}

export async function listTeam(actor: Actor): Promise<TeamMember[]> {
  await authorize(actor, 'team.read');
  const db = data();
  const [users, props] = await Promise.all([db.users.all(), db.properties.all()]);
  const order: Role[] = ['owner', 'admin', 'support', 'cleaner', 'technician', 'accountant', 'guest', 'tenant'];
  return users
    .map((u) => ({
      ...u,
      roleLabel: ROLE_LABEL[u.role],
      propertyNames: u.propertyIds === 'all' ? ['Todas'] : u.propertyIds.map((id) => props.find((p) => p.id === id)?.name ?? id),
    }))
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
}

const UserInput = z.object({
  name: z.string().trim().min(2, 'Escribe el nombre'),
  role: RoleSchema,
  title: z.string().optional(),
  email: z.email('Correo no válido'),
  phone: z.string().optional(),
  propertyIds: z.union([z.literal('all'), z.array(z.string())]),
  personId: z.string().optional(),
  vendorId: z.string().optional(),
});
export type UserInput = z.input<typeof UserInput>;

export async function createUser(actor: Actor, raw: UserInput): Promise<User> {
  await authorize(actor, 'team.write');
  const input = parse(UserInput, raw);
  if (input.role === 'owner') throw new RuleError('Solo hay un propietario.');
  if (input.role === 'admin' && actor.user.role !== 'owner') throw new ForbiddenError('Solo el propietario da acceso de administración.');
  if ((input.role === 'guest' || input.role === 'tenant') && !input.personId) throw new RuleError('Vincula la cuenta con la ficha del huésped o inquilino.');
  const user: User = { ...input, id: newId('u'), active: true, createdAt: nowIso() };
  await data().users.put(user);
  await audit(actor, 'team.create', 'user', user.id, `Dio de alta a ${user.name} como ${ROLE_LABEL[user.role]}.`);
  return user;
}

const UserPatch = UserInput.partial().extend({ active: z.boolean().optional() });

export async function updateUser(actor: Actor, id: string, raw: z.input<typeof UserPatch>): Promise<User> {
  await authorize(actor, 'team.write');
  const patch = parse(UserPatch, raw);
  const db = data();
  const u = await db.users.get(id);
  if (!u) throw new NotFoundError('el usuario');
  if (u.role === 'owner' && (patch.role || patch.active === false)) throw new RuleError('El propietario no se puede cambiar ni desactivar.');
  if (patch.role === 'owner') throw new RuleError('Solo hay un propietario.');
  if ((patch.role === 'admin' || u.role === 'admin') && actor.user.role !== 'owner') throw new ForbiddenError('Solo el propietario cambia cuentas de administración.');
  const next = { ...u, ...patch };
  await db.users.put(next);
  await audit(actor, 'team.update', 'user', id, `Editó la cuenta de ${u.name}${patch.active === false ? ' (desactivada)' : ''}.`);
  return next;
}

// ───────────────────────── Auditoría ─────────────────────────

export async function listAudit(actor: Actor, filter: { q?: string; entity?: string } = {}) {
  await authorize(actor, 'audit.read');
  const q = filter.q?.trim().toLowerCase();
  return (await data().audit.all()).filter(
    (e) => (!filter.entity || e.entity === filter.entity) && (!q || `${e.actorName} ${e.summary} ${e.action}`.toLowerCase().includes(q)),
  );
}

// ───────────────────────── Tareas automáticas ─────────────────────────

let ticking: Promise<{ bookings: number; preventive: number }> | null = null;

/** Avanza reservas (en curso/terminadas con su limpieza) y crea las órdenes preventivas vencidas. */
export function tick(): Promise<{ bookings: number; preventive: number }> {
  ticking ??= (async () => {
    try {
      if (!(await data().settings.get('app'))) return { bookings: 0, preventive: 0 };
      const bookings = await autoProgressBookings();
      const preventive = (await runPreventive()).length;
      return { bookings, preventive };
    } finally {
      ticking = null;
    }
  })();
  return ticking;
}

// ───────────────────────── Demo: semilla, restablecer, exportar, importar ─────────────────────────

export interface DemoInfo {
  seeded: boolean;
  seedDate?: string;
  today: string;
  stale: boolean;
}

export async function demoInfo(): Promise<DemoInfo> {
  const s = await data().settings.get('app');
  const today = todayLocal();
  return { seeded: !!s, seedDate: s?.seedDate, today, stale: !!s && s.seedDate !== today };
}

/** Restablece los datos de ejemplo para «hoy». */
export async function resetDemo(): Promise<void> {
  const tables = buildSeed(clock.now());
  await data().replaceAll(tables, []);
  await tick();
}

/** Si el navegador no tiene datos, carga la semilla. */
export async function ensureSeeded(): Promise<boolean> {
  if (await data().settings.get('app')) return false;
  await resetDemo();
  return true;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  return res.blob();
}

/** Exporta todo el estado de la demo (incluidas fotos y documentos) a JSON. */
export async function exportDemo(actor: Actor): Promise<string> {
  const { tables, files } = await data().dumpAll();
  const snapshot: Snapshot = {
    format: 'gestor-propiedades',
    version: 1,
    exportedAt: nowIso(),
    tables,
    files: await Promise.all(files.map(async (f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, createdAt: f.createdAt, dataUrl: await blobToDataUrl(f.blob) }))),
  };
  await audit(actor, 'demo.export', 'demo', undefined, 'Exportó el estado de la demo.');
  return JSON.stringify(snapshot);
}

const SnapshotSchema = z.object({
  format: z.literal('gestor-propiedades'),
  version: z.literal(1),
  exportedAt: z.string(),
  tables: z.object({
    users: z.array(UserSchema),
    people: z.array(PersonSchema),
    properties: z.array(PropertySchema),
    accessCodes: z.array(AccessCodeSchema),
    checklists: z.array(ChecklistSchema),
    vendors: z.array(VendorSchema),
    bookings: z.array(BookingSchema),
    blocks: z.array(BlockSchema),
    leases: z.array(LeaseSchema),
    leasePayments: z.array(LeasePaymentSchema),
    cleaningTasks: z.array(CleaningTaskSchema),
    maintenanceOrders: z.array(MaintenanceOrderSchema),
    incidents: z.array(IncidentSchema),
    preventive: z.array(PreventiveSchema),
    threads: z.array(ThreadSchema),
    messages: z.array(MessageSchema),
    templates: z.array(TemplateSchema),
    transactions: z.array(TransactionSchema),
    fxRates: z.array(FxRateSchema),
    budgets: z.array(BudgetSchema),
    documents: z.array(DocumentSchema),
    notifications: z.array(NotificationSchema),
    notificationReads: z.array(NotificationReadSchema),
    settings: z.array(SettingsSchema).length(1, 'Falta la configuración'),
    audit: z.array(AuditEntrySchema),
  }),
  files: z.array(ExportedFileSchema),
});

/** Importa un JSON exportado: se valida entero con zod antes de reemplazar nada. */
export async function importDemo(text: string): Promise<{ tables: number; files: number }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new RuleError('El archivo no es un JSON válido.');
  }
  const snap = parse(SnapshotSchema, raw);
  const files: FileRecord[] = await Promise.all(
    snap.files.map(async (f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, createdAt: f.createdAt, blob: await dataUrlToBlob(f.dataUrl) })),
  );
  await data().replaceAll(snap.tables as Tables, files);
  const owner = snap.tables.users.find((u) => u.role === 'owner');
  if (owner) await audit(actorFor(owner), 'demo.import', 'demo', undefined, `Importó un estado de la demo (${snap.exportedAt}).`);
  return { tables: TABLE_NAMES.length, files: files.length };
}

/** Crea una notificación guardada (útil para el recorrido). */
export async function addNotification(n: Omit<AppNotification, 'id' | 'at'>): Promise<void> {
  await data().notifications.put({ id: newId('nt'), at: nowIso(), ...n });
}

export { subjectFor, addDays };
