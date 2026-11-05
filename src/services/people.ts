/**
 * Huéspedes e inquilinos (registro sin documentos reales), bandeja única de mensajes por reserva o
 * contrato, plantillas ES/EN con variables y «Enviar a todos». Nada sale por WhatsApp ni correo.
 */
import { TEMPLATE_VARIABLES } from '@/domain/config';
import { data } from '@/data';
import { dueDateFor, renderTemplate } from '@/domain/rules';
import {
  LangSchema,
  TemplateSchema,
  type Booking,
  type Lang,
  type Lease,
  type Message,
  type Person,
  type Template,
  type Thread,
} from '@/domain/types';
import { clock, nowIso, todayIn } from '@/lib/clock';
import { addDays, formatDate, formatTime } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { formatMoney } from '@/lib/money';
import { DateTime } from 'luxon';
import { z } from 'zod';
import {
  allowed,
  audit,
  authorize,
  can,
  ForbiddenError,
  getSettings,
  NotFoundError,
  parse,
  pushNotification,
  RuleError,
  subjectFor,
  type Actor,
} from './core';

// ───────────────────────── Personas ─────────────────────────

export interface PersonView extends Person {
  stays: number;
  lastStay?: string;
  currentBooking?: { id: string; propertyId: string; propertyName: string; checkIn: string; checkOut: string; status: Booking['status'] };
  nextBooking?: { id: string; propertyId: string; propertyName: string; checkIn: string; checkOut: string };
  lease?: { id: string; propertyName: string; end: string };
}

export async function listPeople(actor: Actor, filter: { kind?: Person['kind']; q?: string } = {}): Promise<PersonView[]> {
  await authorize(actor, 'person.read');
  const db = data();
  const [people, bookings, leases, props] = await Promise.all([db.people.all(), db.bookings.all(), db.leases.all(), db.properties.all()]);
  const q = filter.q?.trim().toLowerCase();
  const pname = (id: string) => props.find((p) => p.id === id)?.name ?? '—';
  return people
    .filter((p) => (!filter.kind || p.kind === filter.kind) && (!q || `${p.name} ${p.email ?? ''} ${p.phone ?? ''}`.toLowerCase().includes(q)))
    .map((p) => {
      const mine = bookings.filter((b) => b.guestId === p.id && b.status !== 'cancelled');
      const today = clock.now().toISODate()!;
      const cur = mine.find((b) => b.status === 'in_progress');
      const next = mine.filter((b) => b.status === 'confirmed' && b.checkIn >= today).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
      const last = mine.filter((b) => b.status === 'completed').sort((a, b) => b.checkOut.localeCompare(a.checkOut))[0];
      const lease = leases.find((l) => l.tenantId === p.id && l.status === 'active');
      return {
        ...p,
        stays: mine.filter((b) => b.status === 'completed').length,
        lastStay: last?.checkOut,
        currentBooking: cur ? { id: cur.id, propertyId: cur.propertyId, propertyName: pname(cur.propertyId), checkIn: cur.checkIn, checkOut: cur.checkOut, status: cur.status } : undefined,
        nextBooking: next ? { id: next.id, propertyId: next.propertyId, propertyName: pname(next.propertyId), checkIn: next.checkIn, checkOut: next.checkOut } : undefined,
        lease: lease ? { id: lease.id, propertyName: pname(lease.propertyId), end: lease.end } : undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getPerson(actor: Actor, id: string): Promise<PersonView & { bookings: (Booking & { propertyName: string })[]; leases: (Lease & { propertyName: string })[]; threadIds: string[] }> {
  const list = await listPeople(actor);
  const p = list.find((x) => x.id === id);
  if (!p) throw new NotFoundError('la persona');
  const db = data();
  const [bookings, leases, props, threads] = await Promise.all([
    db.bookings.find((b) => b.guestId === id),
    db.leases.find((l) => l.tenantId === id),
    db.properties.all(),
    db.threads.find((t) => t.personId === id),
  ]);
  const pname = (pid: string) => props.find((x) => x.id === pid)?.name ?? '—';
  return {
    ...p,
    bookings: bookings.map((b) => ({ ...b, propertyName: pname(b.propertyId) })).sort((a, b) => b.checkIn.localeCompare(a.checkIn)),
    leases: leases.map((l) => ({ ...l, propertyName: pname(l.propertyId) })),
    threadIds: threads.map((t) => t.id),
  };
}

const PersonInput = z.object({
  id: z.string().optional(),
  kind: z.enum(['guest', 'tenant']),
  name: z.string().trim().min(2, 'Escribe el nombre'),
  email: z.string().optional(),
  phone: z.string().optional(),
  language: LangSchema,
  country: z.string().optional(),
  notes: z.string(),
  doNotRent: z.boolean(),
  idVerified: z.boolean(),
  tags: z.array(z.string()),
});
export type PersonInput = z.input<typeof PersonInput>;

export async function savePerson(actor: Actor, raw: PersonInput): Promise<Person> {
  await authorize(actor, 'person.write');
  const input = parse(PersonInput, raw);
  if (input.email && !z.email().safeParse(input.email).success) throw new RuleError('El correo no es válido.');
  const db = data();
  const prev = input.id ? await db.people.get(input.id) : undefined;
  const person: Person = { ...prev, ...input, id: prev?.id ?? newId(input.kind === 'tenant' ? 't' : 'g'), createdAt: prev?.createdAt ?? nowIso() };
  await db.people.put(person);
  await audit(actor, 'person.save', 'person', person.id, `${prev ? 'Editó' : 'Creó'} la ficha de ${person.name}.`);
  return person;
}

export async function setDoNotRent(actor: Actor, id: string, flag: boolean, note = ''): Promise<Person> {
  await authorize(actor, 'person.write');
  const db = data();
  const p = await db.people.get(id);
  if (!p) throw new NotFoundError('la persona');
  const next = { ...p, doNotRent: flag, notes: note ? `${p.notes}${p.notes ? '\n' : ''}${note}` : p.notes };
  await db.people.put(next);
  await audit(actor, 'person.doNotRent', 'person', id, `${flag ? 'Marcó' : 'Quitó'} «no volver a alquilar» a ${p.name}.`);
  return next;
}

// ───────────────────────── Registro de huéspedes (pantalla de Stitch) ─────────────────────────

export interface GuestRegistryRow {
  personId: string;
  name: string;
  language: Lang;
  bookingId: string;
  bookingCode: string;
  propertyId: string;
  propertyName: string;
  propertyCity: string;
  checkIn: string;
  checkOut: string;
  stage: 'active' | 'upcoming' | 'past';
  doNotRent: boolean;
  threadId?: string;
  lastMessage?: string;
  unreadTeam: number;
}

/** Huéspedes en casa, por llegar y recientes (para la bandeja de atención). */
export async function guestRegistry(actor: Actor, q = ''): Promise<GuestRegistryRow[]> {
  const s = await authorize(actor, 'person.read');
  const db = data();
  const [bookings, people, props, threads] = await Promise.all([db.bookings.all(), db.people.all(), db.properties.all(), db.threads.all()]);
  const query = q.trim().toLowerCase();
  const rows: GuestRegistryRow[] = [];
  for (const b of allowed(s, 'booking.read', bookings, (x) => ({ propertyId: x.propertyId }))) {
    if (b.status === 'cancelled') continue;
    const p = props.find((x) => x.id === b.propertyId);
    const person = people.find((x) => x.id === b.guestId);
    if (!p || !person) continue;
    const today = todayIn(p.timezone);
    const stage = b.status === 'in_progress' ? 'active' : b.status === 'confirmed' ? 'upcoming' : 'past';
    if (stage === 'past' && b.checkOut < addDays(today, -14)) continue;
    if (stage === 'upcoming' && b.checkIn > addDays(today, 30)) continue;
    if (query && !`${person.name} ${p.name} ${p.city} ${b.code}`.toLowerCase().includes(query)) continue;
    const th = threads.find((t) => t.bookingId === b.id);
    rows.push({
      personId: person.id,
      name: person.name,
      language: person.language,
      bookingId: b.id,
      bookingCode: b.code,
      propertyId: p.id,
      propertyName: p.name,
      propertyCity: p.city,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      stage,
      doNotRent: person.doNotRent,
      threadId: th?.id,
      lastMessage: th?.lastMessagePreview,
      unreadTeam: th?.unreadTeam ?? 0,
    });
  }
  const order = { active: 0, upcoming: 1, past: 2 } as const;
  return rows.sort((a, b) => order[a.stage] - order[b.stage] || (a.stage === 'past' ? b.checkOut.localeCompare(a.checkOut) : a.checkIn.localeCompare(b.checkIn)));
}

// ───────────────────────── Mensajes ─────────────────────────

export interface ThreadView extends Thread {
  personName: string;
  personLanguage: Lang;
  propertyName: string;
  propertyCity: string;
  bookingCode?: string;
  leaseCode?: string;
  stage?: 'active' | 'upcoming' | 'past';
}

async function threadContext() {
  const db = data();
  const [threads, people, props, bookings, leases] = await Promise.all([db.threads.all(), db.people.all(), db.properties.all(), db.bookings.all(), db.leases.all()]);
  return { threads, people, props, bookings, leases };
}

function threadView(t: Thread, ctx: Awaited<ReturnType<typeof threadContext>>): ThreadView {
  const person = ctx.people.find((p) => p.id === t.personId);
  const p = ctx.props.find((x) => x.id === t.propertyId);
  const b = ctx.bookings.find((x) => x.id === t.bookingId);
  const l = ctx.leases.find((x) => x.id === t.leaseId);
  return {
    ...t,
    personName: person?.name ?? '—',
    personLanguage: person?.language ?? 'es',
    propertyName: p?.name ?? '—',
    propertyCity: p?.city ?? '',
    bookingCode: b?.code,
    leaseCode: l?.code,
    stage: b ? (b.status === 'in_progress' ? 'active' : b.status === 'confirmed' ? 'upcoming' : 'past') : l ? 'active' : undefined,
  };
}

export async function listThreads(actor: Actor, filter: { q?: string; unreadOnly?: boolean } = {}): Promise<ThreadView[]> {
  const s = await subjectFor(actor);
  const ctx = await threadContext();
  const q = filter.q?.trim().toLowerCase();
  return allowed(s, 'thread.read', ctx.threads, (t) => ({ propertyId: t.propertyId, personId: t.personId }))
    .map((t) => threadView(t, ctx))
    .filter((t) => (!filter.unreadOnly || t.unreadTeam > 0) && (!q || `${t.personName} ${t.propertyName} ${t.subject} ${t.lastMessagePreview}`.toLowerCase().includes(q)))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export async function getThread(actor: Actor, id: string): Promise<{ thread: ThreadView; messages: Message[] }> {
  const ctx = await threadContext();
  const t = ctx.threads.find((x) => x.id === id);
  if (!t) throw new NotFoundError('la conversación');
  await authorize(actor, 'thread.read', { propertyId: t.propertyId, personId: t.personId });
  const messages = (await data().messages.find((m) => m.threadId === id)).sort((a, b) => a.at.localeCompare(b.at));
  return { thread: threadView(t, ctx), messages };
}

const isPerson = (actor: Actor) => actor.user.role === 'guest' || actor.user.role === 'tenant';

/** Enviar un mensaje (queda dentro de la app; enviar por WhatsApp o correo es «Próximamente»). */
export async function sendMessage(actor: Actor, threadId: string, body: string, templateKey?: string): Promise<Message> {
  const db = data();
  const t = await db.threads.get(threadId);
  if (!t) throw new NotFoundError('la conversación');
  await authorize(actor, 'message.send', { propertyId: t.propertyId, personId: t.personId });
  const text = parse(z.string().trim().min(1, 'Escribe un mensaje').max(4000), body);
  const person = isPerson(actor);
  const msg: Message = {
    id: newId('msg'),
    threadId,
    at: nowIso(),
    author: person
      ? { kind: 'person', personId: actor.user.personId, name: actor.user.name }
      : { kind: 'team', userId: actor.realUser.id, name: actor.realUser.name },
    body: text,
    templateKey,
    attachments: [],
  };
  await db.messages.put(msg);
  await db.threads.put({
    ...t,
    lastMessageAt: msg.at,
    lastMessagePreview: text.slice(0, 90),
    unreadTeam: person ? t.unreadTeam + 1 : 0,
    unreadPerson: person ? 0 : t.unreadPerson + 1,
  });
  if (person)
    await pushNotification({ kind: 'message', title: 'Mensaje nuevo', body: `${actor.user.name}: ${text.slice(0, 80)}`, link: `/mensajes/${threadId}`, propertyId: t.propertyId, roles: ['admin', 'support'] });
  else await audit(actor, 'message.send', 'thread', threadId, `Envió un mensaje a la conversación ${t.subject}.`);
  return msg;
}

export async function markThreadRead(actor: Actor, threadId: string): Promise<void> {
  const db = data();
  const t = await db.threads.get(threadId);
  if (!t) return;
  const s = await subjectFor(actor);
  if (!can(s, 'thread.read', { propertyId: t.propertyId, personId: t.personId })) return;
  if (s.readOnly) return;
  if (isPerson(actor)) {
    if (t.unreadPerson) await db.threads.put({ ...t, unreadPerson: 0 });
  } else if (t.unreadTeam) await db.threads.put({ ...t, unreadTeam: 0 });
}

/** Enviar a todos los huéspedes que están ahora en una propiedad. Devuelve a cuántos llegó. */
export async function broadcast(actor: Actor, propertyId: string, body: string): Promise<number> {
  await authorize(actor, 'message.broadcast', { propertyId });
  const text = parse(z.string().trim().min(2, 'Escribe el mensaje'), body);
  const db = data();
  const p = await db.properties.get(propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const today = todayIn(p.timezone);
  const current = await db.bookings.find(
    (b) => b.propertyId === propertyId && (b.status === 'in_progress' || (b.status === 'confirmed' && b.checkIn <= today && today <= b.checkOut)),
  );
  const leases = await db.leases.find((l) => l.propertyId === propertyId && l.status === 'active' && l.start <= today && today <= l.end);
  const threads = await db.threads.find((t) => current.some((b) => b.id === t.bookingId) || leases.some((l) => l.id === t.leaseId));
  if (!threads.length) throw new RuleError(`No hay huéspedes ni inquilinos en ${p.name} ahora.`);
  const broadcastId = newId('bc');
  for (const t of threads) {
    const msg: Message = {
      id: newId('msg'),
      threadId: t.id,
      at: nowIso(),
      author: { kind: 'team', userId: actor.realUser.id, name: actor.realUser.name },
      body: text,
      broadcastId,
      attachments: [],
    };
    await db.messages.put(msg);
    await db.threads.put({ ...t, lastMessageAt: msg.at, lastMessagePreview: text.slice(0, 90), unreadPerson: t.unreadPerson + 1 });
  }
  await audit(actor, 'message.broadcast', 'property', propertyId, `Envió un mensaje a todos en ${p.name} (${threads.length}).`);
  return threads.length;
}

/** La conversación del huésped o inquilino con atención al cliente (se crea si no existe). */
export async function myThread(actor: Actor): Promise<{ thread: ThreadView; messages: Message[] } | null> {
  if (!isPerson(actor) || !actor.user.personId) throw new ForbiddenError('Solo para huéspedes e inquilinos.');
  const db = data();
  const personId = actor.user.personId;
  const threads = (await db.threads.find((t) => t.personId === personId)).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  let thread = threads[0];
  if (!thread) {
    const booking = (await db.bookings.find((b) => b.guestId === personId && b.status !== 'cancelled'))[0];
    const lease = (await db.leases.find((l) => l.tenantId === personId))[0];
    const propertyId = booking?.propertyId ?? lease?.propertyId;
    if (!propertyId) return null;
    thread = {
      id: newId('th'),
      kind: booking ? 'booking' : 'lease',
      propertyId,
      bookingId: booking?.id,
      leaseId: lease?.id,
      personId,
      subject: booking ? `Reserva ${booking.code}` : `Contrato ${lease?.code}`,
      lastMessageAt: nowIso(),
      lastMessagePreview: '',
      unreadTeam: 0,
      unreadPerson: 0,
      createdAt: nowIso(),
    };
    await db.threads.put(thread);
  }
  return getThread(actor, thread.id);
}

// ───────────────────────── Plantillas ─────────────────────────

export async function listTemplates(actor: Actor): Promise<Template[]> {
  await authorize(actor, 'template.read');
  return (await data().templates.all()).sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name));
}

export async function saveTemplate(actor: Actor, raw: z.input<typeof TemplateSchema>): Promise<Template> {
  await authorize(actor, 'template.write');
  const input = parse(TemplateSchema, raw);
  await data().templates.put(input);
  await audit(actor, 'template.save', 'template', input.id, `Guardó la plantilla «${input.name}».`);
  return input;
}

export async function deleteTemplate(actor: Actor, id: string): Promise<void> {
  await authorize(actor, 'template.write');
  const t = await data().templates.get(id);
  if (!t) return;
  if (t.builtIn) throw new RuleError('Las plantillas básicas no se borran; puedes editarlas.');
  await data().templates.remove(id);
  await audit(actor, 'template.delete', 'template', id, `Borró la plantilla «${t.name}».`);
}

export function newTemplateId(): string {
  return newId('tpl');
}

export { TEMPLATE_VARIABLES };

/** Rellena una plantilla con los datos de la conversación, en el idioma de la persona (o el pedido). */
export async function renderForThread(actor: Actor, templateId: string, threadId: string, lang?: Lang): Promise<string> {
  await authorize(actor, 'template.read');
  const db = data();
  const [tpl, thread, settings] = await Promise.all([db.templates.get(templateId), db.threads.get(threadId), getSettings()]);
  if (!tpl || !thread) throw new NotFoundError('la plantilla o la conversación');
  const [person, p, booking, lease] = await Promise.all([
    db.people.get(thread.personId),
    db.properties.get(thread.propertyId),
    thread.bookingId ? db.bookings.get(thread.bookingId) : Promise.resolve(undefined),
    thread.leaseId ? db.leases.get(thread.leaseId) : Promise.resolve(undefined),
  ]);
  const language = lang ?? person?.language ?? 'es';
  let dueDate: string | undefined;
  if (lease) {
    const today = todayIn(p?.timezone ?? 'America/New_York');
    const thisMonth = dueDateFor(lease, today.slice(0, 7));
    dueDate = formatDate(thisMonth);
  }
  const appLink = typeof window !== 'undefined' ? `${window.location.origin}${import.meta.env.BASE_URL}` : '';
  return renderTemplate(tpl.body[language], {
    guest_name: person?.name.split(' ')[0],
    property_name: p?.name,
    city: p?.city,
    check_in: booking ? formatDate(booking.checkIn) : undefined,
    check_out: booking ? formatDate(booking.checkOut) : undefined,
    check_in_time: p ? formatTime(p.checkInTime) : undefined,
    check_out_time: p ? formatTime(p.checkOutTime) : undefined,
    amount: lease ? formatMoney(lease.rent, lease.currency) : undefined,
    due_date: dueDate,
    company: settings.companyName,
    app_link: appLink,
  });
}

// ───────────────────────── Indicadores de atención ─────────────────────────

export interface EngagementStats {
  responseRate: number;
  avgWaitMinutes: number;
  activeChats: number;
  unread: number;
}

/** Tasa de respuesta y espera promedio: cada mensaje de la persona vs. la siguiente respuesta del equipo. */
export async function engagementStats(actor: Actor): Promise<EngagementStats> {
  const threads = await listThreads(actor);
  const ids = new Set(threads.map((t) => t.id));
  const messages = (await data().messages.find((m) => ids.has(m.threadId))).sort((a, b) => a.at.localeCompare(b.at));
  let asked = 0;
  let answered = 0;
  let waitTotal = 0;
  for (const t of threads) {
    const list = messages.filter((m) => m.threadId === t.id);
    list.forEach((m, i) => {
      if (m.author.kind !== 'person') return;
      if (list[i - 1]?.author.kind === 'person') return;
      asked++;
      const reply = list.slice(i + 1).find((x) => x.author.kind === 'team');
      if (reply) {
        answered++;
        waitTotal += DateTime.fromISO(reply.at).diff(DateTime.fromISO(m.at), 'minutes').minutes;
      }
    });
  }
  const weekAgo = clock.now().minus({ days: 7 }).toUTC().toISO()!;
  return {
    responseRate: asked ? answered / asked : 1,
    avgWaitMinutes: answered ? Math.round(waitTotal / answered) : 0,
    activeChats: threads.filter((t) => t.lastMessageAt >= weekAgo).length,
    unread: threads.reduce((s, t) => s + t.unreadTeam, 0),
  };
}
