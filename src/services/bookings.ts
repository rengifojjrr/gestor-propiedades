/**
 * Reservas por noches: alta sin cruces, estados (confirmada → en curso → terminada, o cancelada),
 * salida que crea sola la limpieza, bloqueos, calendario, importación de .ics y la app del huésped.
 */
import { data } from '@/data';
import { bookingMoney, findConflict, nights, rangesOverlap } from '@/domain/rules';
import {
  CHANNELS,
  LangSchema,
  isoDate,
  type AccessCodeView,
  type Block,
  type Booking,
  type Channel,
  type CleaningTask,
  type Lang,
  type Lease,
  type Person,
  type Property,
} from '@/domain/types';
import { nowIso, todayIn } from '@/lib/clock';
import { addDays } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { z } from 'zod';
import {
  allowed,
  audit,
  authorize,
  ConflictError,
  getSystemActor,
  NotFoundError,
  parse,
  pushNotification,
  RuleError,
  subjectFor,
  type Actor,
} from './core';
import { postTransaction } from './finance';
import { createCheckoutCleaning } from './operations';
import { codesForStay, effectiveStatus, toView, type PropertyView } from './properties';

export interface BookingView extends Booking {
  guestName: string;
  guestLanguage: Lang;
  guestDoNotRent: boolean;
  propertyName: string;
  propertyCity: string;
  timezone: string;
  checkInTime: string;
  checkOutTime: string;
  nights: number;
  threadId?: string;
  /** Fecha de hoy en la zona de la propiedad. */
  today: string;
}

function toBookingView(b: Booking, p: Property | undefined, person: Person | undefined, threadId?: string): BookingView {
  return {
    ...b,
    guestName: person?.name ?? 'Huésped',
    guestLanguage: person?.language ?? 'es',
    guestDoNotRent: person?.doNotRent ?? false,
    propertyName: p?.name ?? '—',
    propertyCity: p?.city ?? '',
    timezone: p?.timezone ?? 'America/New_York',
    checkInTime: p?.checkInTime ?? '16:00',
    checkOutTime: p?.checkOutTime ?? '11:00',
    nights: nights(b.checkIn, b.checkOut),
    threadId,
    today: todayIn(p?.timezone ?? 'America/New_York'),
  };
}

export interface BookingFilter {
  propertyId?: string;
  status?: Booking['status'][];
  from?: string;
  to?: string;
  guestId?: string;
}

export async function listBookings(actor: Actor, filter: BookingFilter = {}): Promise<BookingView[]> {
  const s = await subjectFor(actor);
  const db = data();
  const [bookings, props, people, threads] = await Promise.all([db.bookings.all(), db.properties.all(), db.people.all(), db.threads.all()]);
  return allowed(s, 'booking.read', bookings, (b) => ({ propertyId: b.propertyId, personId: b.guestId }))
    .filter(
      (b) =>
        (!filter.propertyId || b.propertyId === filter.propertyId) &&
        (!filter.status || filter.status.includes(b.status)) &&
        (!filter.guestId || b.guestId === filter.guestId) &&
        (!filter.from || b.checkOut > filter.from) &&
        (!filter.to || b.checkIn < filter.to),
    )
    .map((b) =>
      toBookingView(
        b,
        props.find((p) => p.id === b.propertyId),
        people.find((p) => p.id === b.guestId),
        threads.find((t) => t.bookingId === b.id)?.id,
      ),
    )
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

export async function getBooking(actor: Actor, id: string): Promise<BookingView> {
  const db = data();
  const b = await db.bookings.get(id);
  if (!b) throw new NotFoundError('la reserva');
  await authorize(actor, 'booking.read', { propertyId: b.propertyId, personId: b.guestId });
  const [p, person, threads] = await Promise.all([db.properties.get(b.propertyId), db.people.get(b.guestId), db.threads.find((t) => t.bookingId === id)]);
  return toBookingView(b, p, person, threads[0]?.id);
}

// ───────────────────────── Alta y cambios ─────────────────────────

const NewGuestSchema = z.object({
  name: z.string().min(2, 'Escribe el nombre del huésped'),
  email: z.string().optional(),
  phone: z.string().optional(),
  language: LangSchema,
});

const BookingInputSchema = z
  .object({
    propertyId: z.string().min(1, 'Elige una propiedad'),
    guestId: z.string().optional(),
    newGuest: NewGuestSchema.optional(),
    channel: z.enum(CHANNELS),
    checkIn: isoDate,
    checkOut: isoDate,
    guests: z.number().int().min(1, 'Al menos 1 persona'),
    nightlyRate: z.number().positive().optional(),
    cleaningFee: z.number().min(0).optional(),
    note: z.string().optional(),
    /** Confirmar aunque la persona esté marcada «no volver a alquilar». */
    allowDoNotRent: z.boolean().optional(),
  })
  .refine((i) => i.checkOut > i.checkIn, { message: 'La salida debe ser después de la entrada', path: ['checkOut'] })
  .refine((i) => !!i.guestId || !!i.newGuest, { message: 'Elige un huésped o crea uno nuevo', path: ['guestId'] });
export type BookingInput = z.input<typeof BookingInputSchema>;

async function assertNoConflict(propertyId: string, checkIn: string, checkOut: string, ignoreId?: string) {
  const db = data();
  const [bookings, blocks, leases] = await Promise.all([
    db.bookings.find((b) => b.propertyId === propertyId),
    db.blocks.find((b) => b.propertyId === propertyId),
    db.leases.find((l) => l.propertyId === propertyId && l.status === 'active'),
  ]);
  const conflict = findConflict(propertyId, checkIn, checkOut, bookings, blocks, ignoreId);
  if (conflict?.kind === 'booking')
    throw new ConflictError(`Se cruza con la reserva ${conflict.booking.code} (${conflict.booking.checkIn} → ${conflict.booking.checkOut}).`);
  if (conflict?.kind === 'block') throw new ConflictError(`Se cruza con un bloqueo (${conflict.block.start} → ${conflict.block.end}).`);
  const lease = leases.find((l) => rangesOverlap(checkIn, checkOut, l.start, addDays(l.end, 1)));
  if (lease) throw new ConflictError(`Se cruza con el contrato ${lease.code} (${lease.start} → ${lease.end}).`);
}

export async function createBooking(actor: Actor, raw: BookingInput): Promise<Booking> {
  const input = parse(BookingInputSchema, raw);
  await authorize(actor, 'booking.write', { propertyId: input.propertyId });
  const db = data();
  const p = await db.properties.get(input.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  if (p.rentalMode === 'monthly') throw new RuleError(`${p.name} se alquila solo por meses: usa un contrato.`);
  if (input.guests > p.capacity) throw new RuleError(`${p.name} recibe máximo ${p.capacity} personas.`);
  await assertNoConflict(p.id, input.checkIn, input.checkOut);

  let guest: Person | undefined;
  if (input.guestId) {
    guest = await db.people.get(input.guestId);
    if (!guest) throw new NotFoundError('el huésped');
    if (guest.doNotRent && !input.allowDoNotRent)
      throw new RuleError(`${guest.name} está marcado «no volver a alquilar». Confirma si igual quieres reservar.`);
  } else if (input.newGuest) {
    guest = {
      id: newId('g'),
      kind: 'guest',
      name: input.newGuest.name,
      email: input.newGuest.email,
      phone: input.newGuest.phone,
      language: input.newGuest.language,
      notes: '',
      doNotRent: false,
      idVerified: false,
      tags: [],
      createdAt: nowIso(),
    };
    await db.people.put(guest);
  }
  const m = bookingMoney({
    nightlyRate: input.nightlyRate ?? p.nightlyRate,
    nights: nights(input.checkIn, input.checkOut),
    cleaningFee: input.cleaningFee ?? p.cleaningFee,
    channel: input.channel,
    taxRate: p.taxRate,
  });
  const count = (await db.bookings.all()).length;
  const at = nowIso();
  const b: Booking = {
    id: newId('bk'),
    code: `R-${1001 + count}`,
    propertyId: p.id,
    guestId: guest!.id,
    channel: input.channel,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    guests: input.guests,
    nightlyRate: input.nightlyRate ?? p.nightlyRate,
    cleaningFee: m.cleaningFee,
    commission: m.commission,
    taxes: m.taxes,
    taxRemittedByChannel: m.taxRemittedByChannel,
    netPayout: m.netPayout,
    currency: p.currency,
    status: 'confirmed',
    statusHistory: [{ status: 'confirmed', at, by: actor.realUser.id }],
    notes: input.note ? [{ id: newId('nt'), at, by: actor.realUser.id, byName: actor.realUser.name, text: input.note }] : [],
    source: 'manual',
    needsDetails: false,
    createdAt: at,
  };
  await db.bookings.put(b);
  await db.threads.put({
    id: newId('th'),
    kind: 'booking',
    propertyId: p.id,
    bookingId: b.id,
    personId: guest!.id,
    subject: `Reserva ${b.code}`,
    lastMessageAt: at,
    lastMessagePreview: 'Reserva creada',
    unreadTeam: 0,
    unreadPerson: 0,
    createdAt: at,
  });
  await audit(actor, 'booking.create', 'booking', b.id, `Creó la reserva ${b.code} (${guest!.name}, ${p.name}, ${b.checkIn} → ${b.checkOut}).`);
  await pushNotification({
    kind: 'booking',
    title: 'Nueva reserva',
    body: `${guest!.name} · ${p.name} · ${b.checkIn} → ${b.checkOut}`,
    link: `/reservas/${b.id}`,
    propertyId: p.id,
    roles: ['owner', 'admin', 'support'],
  });
  return b;
}

const BookingPatchSchema = z
  .object({
    checkIn: isoDate,
    checkOut: isoDate,
    guests: z.number().int().min(1),
    channel: z.enum(CHANNELS),
    nightlyRate: z.number().positive(),
    cleaningFee: z.number().min(0),
  })
  .partial();
export type BookingPatch = z.input<typeof BookingPatchSchema>;

export async function updateBooking(actor: Actor, id: string, raw: BookingPatch): Promise<Booking> {
  const patch = parse(BookingPatchSchema, raw);
  const db = data();
  const b = await db.bookings.get(id);
  if (!b) throw new NotFoundError('la reserva');
  await authorize(actor, 'booking.write', { propertyId: b.propertyId });
  if (b.status === 'completed' || b.status === 'cancelled') throw new RuleError('Esta reserva ya está cerrada.');
  const p = await db.properties.get(b.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const next = { ...b, ...patch };
  if (next.checkOut <= next.checkIn) throw new RuleError('La salida debe ser después de la entrada.');
  if (next.guests > p.capacity) throw new RuleError(`${p.name} recibe máximo ${p.capacity} personas.`);
  await assertNoConflict(b.propertyId, next.checkIn, next.checkOut, b.id);
  const m = bookingMoney({ nightlyRate: next.nightlyRate, nights: nights(next.checkIn, next.checkOut), cleaningFee: next.cleaningFee, channel: next.channel, taxRate: p.taxRate });
  Object.assign(next, { commission: m.commission, taxes: m.taxes, taxRemittedByChannel: m.taxRemittedByChannel, netPayout: m.netPayout, needsDetails: false });
  await db.bookings.put(next);
  await audit(actor, 'booking.update', 'booking', id, `Editó la reserva ${b.code}.`);
  return next;
}

export async function addBookingNote(actor: Actor, id: string, text: string): Promise<Booking> {
  const db = data();
  const b = await db.bookings.get(id);
  if (!b) throw new NotFoundError('la reserva');
  await authorize(actor, 'booking.note', { propertyId: b.propertyId });
  const clean = parse(z.string().trim().min(2, 'Escribe la nota'), text);
  const next = { ...b, notes: [...b.notes, { id: newId('nt'), at: nowIso(), by: actor.realUser.id, byName: actor.realUser.name, text: clean }] };
  await db.bookings.put(next);
  await audit(actor, 'booking.note', 'booking', id, `Anotó en la reserva ${b.code}.`);
  return next;
}

export async function cancelBooking(actor: Actor, id: string, reason = ''): Promise<Booking> {
  const db = data();
  const b = await db.bookings.get(id);
  if (!b) throw new NotFoundError('la reserva');
  await authorize(actor, 'booking.write', { propertyId: b.propertyId });
  if (b.status !== 'confirmed') throw new RuleError('Solo se cancelan reservas confirmadas que no han empezado.');
  const at = nowIso();
  const next: Booking = {
    ...b,
    status: 'cancelled',
    statusHistory: [...b.statusHistory, { status: 'cancelled', at, by: actor.realUser.id }],
    notes: reason ? [...b.notes, { id: newId('nt'), at, by: actor.realUser.id, byName: actor.realUser.name, text: `Cancelada: ${reason}` }] : b.notes,
  };
  await db.bookings.put(next);
  await audit(actor, 'booking.cancel', 'booking', id, `Canceló la reserva ${b.code}.`);
  return next;
}

export async function checkInBooking(actor: Actor, id: string): Promise<Booking> {
  const db = data();
  const b = await db.bookings.get(id);
  if (!b) throw new NotFoundError('la reserva');
  await authorize(actor, 'booking.write', { propertyId: b.propertyId });
  const p = await db.properties.get(b.propertyId);
  if (b.status !== 'confirmed') throw new RuleError('La reserva no está confirmada.');
  if (p && b.checkIn > todayIn(p.timezone)) throw new RuleError('La entrada todavía no ha llegado.');
  const next: Booking = { ...b, status: 'in_progress', statusHistory: [...b.statusHistory, { status: 'in_progress', at: nowIso(), by: actor.realUser.id }] };
  await db.bookings.put(next);
  await audit(actor, 'booking.checkin', 'booking', id, `Registró la entrada de la reserva ${b.code}.`);
  return next;
}

/**
 * Registra la salida: la reserva queda «terminada», se registran el ingreso y la comisión, y se crea
 * sola la limpieza de salida (asignada a la persona de limpieza de la propiedad). Es idempotente.
 */
export async function checkOutBooking(actor: Actor, id: string): Promise<{ booking: Booking; cleaningTask: CleaningTask }> {
  const db = data();
  const b = await db.bookings.get(id);
  if (!b) throw new NotFoundError('la reserva');
  await authorize(actor, 'booking.write', { propertyId: b.propertyId });
  const p = await db.properties.get(b.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  if (b.status === 'cancelled') throw new RuleError('La reserva está cancelada.');
  if (b.status === 'confirmed' && b.checkIn > todayIn(p.timezone)) throw new RuleError('La estadía todavía no empieza.');
  let booking = b;
  if (b.status !== 'completed') {
    booking = { ...b, status: 'completed', statusHistory: [...b.statusHistory, { status: 'completed', at: nowIso(), by: actor.realUser.id }] };
    await db.bookings.put(booking);
    const already = await db.transactions.find((t) => t.source.kind === 'booking' && t.source.id === b.id);
    if (!already.length) {
      const m = bookingMoney({ nightlyRate: b.nightlyRate, nights: nights(b.checkIn, b.checkOut), cleaningFee: b.cleaningFee, channel: b.channel, taxRate: p.taxRate, commission: b.commission });
      const date = todayIn(p.timezone) < b.checkOut ? todayIn(p.timezone) : b.checkOut;
      await postTransaction({ propertyId: p.id, type: 'income', category: 'booking', amount: m.grossIncome, date, description: `Reserva ${b.code} · ${nights(b.checkIn, b.checkOut)} noches`, method: b.channel === 'direct' ? 'transfer' : 'channel', reference: b.code, source: { kind: 'booking', id: b.id }, createdBy: actor.realUser.id });
      if (m.commission > 0)
        await postTransaction({ propertyId: p.id, type: 'expense', category: 'commissions', amount: m.commission, date, description: `Comisión ${b.channel} · ${b.code}`, source: { kind: 'booking', id: b.id }, createdBy: actor.realUser.id });
      if (!m.taxRemittedByChannel && m.taxes > 0)
        await postTransaction({ propertyId: p.id, type: 'expense', category: 'lodging_tax', amount: m.taxes, date, description: `Impuesto de hospedaje · ${b.code}`, source: { kind: 'booking', id: b.id }, createdBy: actor.realUser.id });
    }
    await audit(actor, 'booking.checkout', 'booking', id, `Registró la salida de la reserva ${b.code}.`);
  }
  const cleaningTask = await createCheckoutCleaning(actor, booking);
  return { booking, cleaningTask };
}

/** Avance automático: confirmadas que ya empezaron → en curso; las que terminaron ayer o antes → salida. */
export async function autoProgressBookings(): Promise<number> {
  const db = data();
  const [bookings, props] = await Promise.all([db.bookings.find((b) => b.status === 'confirmed' || b.status === 'in_progress'), db.properties.all()]);
  let changed = 0;
  const system = await getSystemActor();
  for (const b of bookings) {
    const p = props.find((x) => x.id === b.propertyId);
    if (!p) continue;
    const today = todayIn(p.timezone);
    if (b.checkOut < today) {
      await checkOutBooking(system, b.id);
      changed++;
    } else if (b.status === 'confirmed' && b.checkIn <= today) {
      await db.bookings.put({ ...b, status: 'in_progress', statusHistory: [...b.statusHistory, { status: 'in_progress', at: nowIso(), by: 'system' }] });
      changed++;
    }
  }
  return changed;
}

// ───────────────────────── Bloqueos ─────────────────────────

const BlockInput = z
  .object({ propertyId: z.string().min(1), start: isoDate, end: isoDate, reason: z.enum(['owner', 'maintenance', 'other']), note: z.string() })
  .refine((b) => b.end > b.start, { message: 'El fin debe ser después del inicio', path: ['end'] });

export async function listBlocks(actor: Actor, propertyId?: string): Promise<Block[]> {
  const s = await subjectFor(actor);
  const blocks = await data().blocks.all();
  return allowed(s, 'booking.read', blocks, (b) => ({ propertyId: b.propertyId })).filter((b) => !propertyId || b.propertyId === propertyId);
}

export async function createBlock(actor: Actor, raw: z.input<typeof BlockInput>): Promise<Block> {
  const input = parse(BlockInput, raw);
  await authorize(actor, 'booking.write', { propertyId: input.propertyId });
  await assertNoConflict(input.propertyId, input.start, input.end);
  const block: Block = { id: newId('blk'), ...input };
  await data().blocks.put(block);
  await audit(actor, 'booking.block', 'block', block.id, `Bloqueó fechas ${block.start} → ${block.end}.`);
  return block;
}

export async function removeBlock(actor: Actor, id: string): Promise<void> {
  const block = await data().blocks.get(id);
  if (!block) throw new NotFoundError('el bloqueo');
  await authorize(actor, 'booking.write', { propertyId: block.propertyId });
  await data().blocks.remove(id);
  await audit(actor, 'booking.unblock', 'block', id, `Quitó el bloqueo ${block.start} → ${block.end}.`);
}

// ───────────────────────── Calendario ─────────────────────────

export interface CalendarData {
  properties: PropertyView[];
  bookings: BookingView[];
  blocks: Block[];
  leases: (Lease & { tenantName: string })[];
}

/** Todo lo que ocupa el calendario en [from, to) para la línea de tiempo y la vista por mes. */
export async function calendarData(actor: Actor, from: string, to: string): Promise<CalendarData> {
  const s = await subjectFor(actor);
  const db = data();
  const [props, allBookings, leases, people] = await Promise.all([db.properties.all(), db.bookings.all(), db.leases.all(), db.people.all()]);
  const visibleProps = allowed(s, 'property.read', props.filter((p) => !p.archived), (p) => ({ propertyId: p.id }));
  const bookings = await listBookings(actor, { from, to, status: ['confirmed', 'in_progress', 'completed'] });
  const blocks = (await listBlocks(actor)).filter((b) => b.end > from && b.start < to);
  const visibleLeases = allowed(s, 'lease.read', leases, (l) => ({ propertyId: l.propertyId, personId: l.tenantId }))
    .filter((l) => l.status !== 'terminated' && addDays(l.end, 1) > from && l.start < to)
    .map((l) => ({ ...l, tenantName: people.find((p) => p.id === l.tenantId)?.name ?? '—' }));
  return {
    properties: visibleProps.map((p) => toView(p, s, effectiveStatus(p, allBookings, leases))).sort((a, b) => a.name.localeCompare(b.name)),
    bookings,
    blocks,
    leases: visibleLeases,
  };
}

// ───────────────────────── Importar .ics ─────────────────────────

export interface IcsImportResult {
  created: Booking[];
  blocks: Block[];
  skipped: { summary: string; reason: string }[];
}

function channelFrom(text: string): Channel {
  const t = text.toLowerCase();
  if (t.includes('airbnb')) return 'airbnb';
  if (t.includes('vrbo') || t.includes('homeaway')) return 'vrbo';
  if (t.includes('booking.com')) return 'booking';
  return 'direct';
}

/**
 * Importa un archivo .ics (como el que exportan Airbnb o Vrbo). Cada evento se vuelve una reserva
 * «por completar» (el .ics no trae huésped ni montos) o un bloqueo si dice «Not available».
 * Los que se cruzan o ya se importaron se saltan con su motivo.
 */
export async function importIcs(actor: Actor, propertyId: string, text: string): Promise<IcsImportResult> {
  await authorize(actor, 'booking.import', { propertyId });
  const db = data();
  const p = await db.properties.get(propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  if (p.rentalMode === 'monthly') throw new RuleError(`${p.name} se alquila solo por meses.`);
  const ICAL = (await import('ical.js')).default;
  let events: InstanceType<typeof ICAL.Event>[];
  try {
    const comp = new ICAL.Component(ICAL.parse(text));
    events = comp.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v));
  } catch {
    throw new RuleError('El archivo no es un calendario .ics válido.');
  }
  const result: IcsImportResult = { created: [], blocks: [], skipped: [] };
  const existing = await db.bookings.all();
  const existingBlocks = await db.blocks.find((b) => b.propertyId === p.id);
  let count = existing.length;
  const toDate = (t: InstanceType<typeof ICAL.Time>) =>
    t.isDate
      ? `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
      : t.toJSDate().toLocaleDateString('en-CA', { timeZone: p.timezone });
  let placeholder: Person | undefined;
  for (const ev of events) {
    const summary = ev.summary || 'Reserva';
    if (!ev.startDate || !ev.endDate) {
      result.skipped.push({ summary, reason: 'Sin fechas' });
      continue;
    }
    const start = toDate(ev.startDate);
    const end = toDate(ev.endDate);
    if (!(end > start)) {
      result.skipped.push({ summary, reason: 'Fechas inválidas' });
      continue;
    }
    const uid = ev.uid || `${summary}-${start}`;
    if (
      existing.some((b) => b.externalUid === uid) ||
      existingBlocks.some((b) => b.externalUid === uid) ||
      result.created.some((b) => b.externalUid === uid) ||
      result.blocks.some((b) => b.externalUid === uid)
    ) {
      result.skipped.push({ summary, reason: 'Ya estaba importada' });
      continue;
    }
    if (end <= todayIn(p.timezone)) {
      result.skipped.push({ summary, reason: 'Ya pasó' });
      continue;
    }
    const isBlock = /not available|blocked|bloquead|no disponible/i.test(summary);
    try {
      await assertNoConflict(p.id, start, end);
    } catch (err) {
      result.skipped.push({ summary: `${summary} (${start} → ${end})`, reason: err instanceof Error ? err.message : 'Se cruza' });
      continue;
    }
    if (isBlock) {
      const block: Block = { id: newId('blk'), propertyId: p.id, start, end, reason: 'other', note: `Importado del .ics: ${summary}`, externalUid: uid };
      await db.blocks.put(block);
      result.blocks.push(block);
      continue;
    }
    if (!placeholder) {
      placeholder = {
        id: newId('g'),
        kind: 'guest',
        name: 'Huésped por confirmar (importado)',
        language: 'es',
        notes: 'Creado al importar un .ics: completa los datos.',
        doNotRent: false,
        idVerified: false,
        tags: ['Importado'],
        createdAt: nowIso(),
      };
      await db.people.put(placeholder);
    }
    const channel = channelFrom(`${ev.uid ?? ''} ${ev.description ?? ''} ${summary}`);
    const m = bookingMoney({ nightlyRate: p.nightlyRate, nights: nights(start, end), cleaningFee: p.cleaningFee, channel, taxRate: p.taxRate });
    const at = nowIso();
    const b: Booking = {
      id: newId('bk'),
      code: `R-${1001 + count++}`,
      propertyId: p.id,
      guestId: placeholder.id,
      channel,
      checkIn: start,
      checkOut: end,
      guests: 1,
      nightlyRate: p.nightlyRate,
      cleaningFee: m.cleaningFee,
      commission: m.commission,
      taxes: m.taxes,
      taxRemittedByChannel: m.taxRemittedByChannel,
      netPayout: m.netPayout,
      currency: p.currency,
      status: 'confirmed',
      statusHistory: [{ status: 'confirmed', at, by: actor.realUser.id }],
      notes: [{ id: newId('nt'), at, by: actor.realUser.id, byName: actor.realUser.name, text: `Importada del .ics: «${summary}». Montos estimados con la tarifa de la propiedad.` }],
      source: 'ics',
      externalUid: uid,
      needsDetails: true,
      createdAt: at,
    };
    await db.bookings.put(b);
    result.created.push(b);
  }
  await audit(actor, 'booking.import', 'property', p.id, `Importó un .ics en ${p.name}: ${result.created.length} reservas, ${result.blocks.length} bloqueos, ${result.skipped.length} saltadas.`);
  return result;
}

// ───────────────────────── App del huésped ─────────────────────────

export interface PublicProperty {
  id: string;
  name: string;
  city: string;
  region: string;
  country: string;
  address: string;
  neighborhood: string;
  lat: number;
  lng: number;
  timezone: string;
  photos: Property['photos'];
  bedrooms: number;
  bathrooms: number;
  capacity: number;
  amenities: string[];
  checkInTime: string;
  checkOutTime: string;
  houseManual: Property['houseManual'];
  checkInInstructions: Property['checkInInstructions'];
  directions: Property['directions'];
}

export interface GuestHome {
  person: Person;
  booking: BookingView | null;
  property: PublicProperty | null;
  stay: 'upcoming' | 'during' | 'past' | 'none';
  /** Códigos: con valor solo durante la estadía. */
  codes: AccessCodeView[];
  threadId?: string;
  bookings: BookingView[];
}

function publicProperty(p: Property): PublicProperty {
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    region: p.region,
    country: p.country,
    address: p.address,
    neighborhood: p.neighborhood,
    lat: p.lat,
    lng: p.lng,
    timezone: p.timezone,
    photos: p.photos,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    capacity: p.capacity,
    amenities: p.amenities,
    checkInTime: p.checkInTime,
    checkOutTime: p.checkOutTime,
    houseManual: p.houseManual,
    checkInInstructions: p.checkInInstructions,
    directions: p.directions,
  };
}

/** Lo que ve el huésped: SU reserva (la actual, o la próxima, o la última). */
export async function guestHome(actor: Actor): Promise<GuestHome> {
  if (actor.user.role !== 'guest' || !actor.user.personId) throw new RuleError('Esta vista es para huéspedes.');
  const db = data();
  const person = await db.people.get(actor.user.personId);
  if (!person) throw new NotFoundError('tu ficha');
  const bookings = (await listBookings(actor, { guestId: person.id })).filter((b) => b.status !== 'cancelled');
  const during = bookings.find((b) => b.status === 'in_progress' || (b.status === 'confirmed' && b.checkIn <= b.today && b.today <= b.checkOut));
  const upcoming = bookings.filter((b) => b.status === 'confirmed' && b.checkIn > b.today).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
  const past = bookings.filter((b) => b.status === 'completed').sort((a, b) => b.checkOut.localeCompare(a.checkOut))[0];
  const booking = during ?? upcoming ?? past ?? null;
  if (!booking) return { person, booking: null, property: null, stay: 'none', codes: [], bookings };
  const p = await db.properties.get(booking.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  const codes = codesForStay(await db.accessCodes.find((c) => c.propertyId === p.id), booking, todayIn(p.timezone));
  const stay = booking === during ? 'during' : booking === upcoming ? 'upcoming' : 'past';
  return { person, booking, property: publicProperty(p), stay, codes, threadId: booking.threadId, bookings };
}
