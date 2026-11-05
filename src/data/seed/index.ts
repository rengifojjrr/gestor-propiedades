/**
 * Semilla de la demo, calculada a partir de «hoy» para que siempre haya:
 * 6 meses de historia, 3 reservas en curso (una termina hoy), 10 próximas, 2 contratos (uno atrasado),
 * 2 órdenes urgentes, 3 limpiezas pendientes hoy y 2 documentos por vencer.
 * Es determinista: misma fecha → mismos datos.
 */
import { DateTime } from 'luxon';
import { bookingMoney, dueDateFor, nights } from '@/domain/rules';
import type {
  AppNotification,
  AuditEntry,
  Booking,
  Channel,
  CleaningTask,
  DocumentRecord,
  Incident,
  Lease,
  LeasePayment,
  MaintenanceCategory,
  MaintenanceOrder,
  Message,
  Person,
  PreventiveSchedule,
  Priority,
  Property,
  Thread,
  Transaction,
  User,
} from '@/domain/types';
import { clock } from '@/lib/clock';
import { addDays, addMonthsToKey, monthEndExclusive, monthKeyOf, monthStart } from '@/lib/dates';
import { round2 } from '@/lib/money';
import type { Tables } from '../store';
import {
  DEMO_EMAIL_DOMAIN,
  SEED_ACCESS_CODES,
  SEED_CHECKLISTS,
  SEED_GUEST_POOL,
  SEED_KEY_GUESTS,
  SEED_PROPERTIES,
  SEED_TEMPLATES,
  SEED_TENANTS,
  SEED_USERS,
  SEED_VENDORS,
} from './catalog';

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '');

export const HISTORY_DAYS = 182;

export function buildSeed(now: DateTime = clock.now()): Tables {
  const rnd = mulberry32(20261105);
  const randInt = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const localToday = now.toISODate()!;
  const todayOf = (tz: string) => now.setZone(tz).toISODate()!;
  const at = (date: string, time: string, tz: string) =>
    DateTime.fromISO(`${date}T${time}`, { zone: tz }).toUTC().toISO()!;
  const hoursAgo = (h: number) => now.minus({ hours: h }).toUTC().toISO()!;
  const NY = 'America/New_York';

  const t: Tables = {
    users: [],
    people: [],
    properties: [],
    accessCodes: [...SEED_ACCESS_CODES],
    checklists: [...SEED_CHECKLISTS],
    vendors: [...SEED_VENDORS],
    bookings: [],
    blocks: [],
    leases: [],
    leasePayments: [],
    cleaningTasks: [],
    maintenanceOrders: [],
    incidents: [],
    preventive: [],
    threads: [],
    messages: [],
    templates: [...SEED_TEMPLATES],
    transactions: [],
    fxRates: [],
    budgets: [],
    documents: [],
    notifications: [],
    notificationReads: [],
    settings: [],
    audit: [],
  };

  // ───────── Personas y cuentas ─────────
  let phoneSeq = 100;
  const phone = () => `+1 305 555 0${phoneSeq++}`;
  t.users = SEED_USERS.map(
    (u): User => ({
      id: u.id,
      name: u.name,
      role: u.role,
      title: u.title,
      email: `${slug(u.name)}@${DEMO_EMAIL_DOMAIN}`,
      phone: phone(),
      propertyIds: u.propertyIds,
      personId: u.personId,
      vendorId: u.vendorId,
      active: true,
      createdAt: at(addDays(localToday, -420), '09:00', NY),
    }),
  );
  const allPeople = [...SEED_TENANTS, ...SEED_KEY_GUESTS, ...SEED_GUEST_POOL];
  t.people = allPeople.map(
    (p, i): Person => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      email: `${slug(p.name)}@${DEMO_EMAIL_DOMAIN}`,
      phone: phone(),
      language: p.language,
      country: p.country,
      notes: p.notes ?? '',
      doNotRent: p.doNotRent ?? false,
      idVerified: i % 7 !== 3,
      tags: p.kind === 'tenant' ? ['Contrato'] : i % 5 === 0 ? ['Repite'] : [],
      createdAt: at(addDays(localToday, -HISTORY_DAYS - 30 + i), '10:00', NY),
    }),
  );

  // ───────── Propiedades ─────────
  t.properties = SEED_PROPERTIES.map((sp): Property => {
    const today = todayOf(sp.timezone);
    const { licenseDays, licenseNumber, insuranceDays, ownerPrivate, ...rest } = sp;
    return {
      ...rest,
      license: licenseNumber && licenseDays !== undefined ? { number: licenseNumber, expiresOn: addDays(today, licenseDays) } : undefined,
      ownerPrivate: { ...ownerPrivate, insurance: { ...ownerPrivate.insurance, expiresOn: addDays(today, insuranceDays) } },
      createdAt: at(addDays(localToday, -400), '09:00', NY),
    };
  });
  const prop = (id: string) => t.properties.find((p) => p.id === id)!;
  const P = {
    miami: prop('p-miami'),
    orlando: prop('p-orlando'),
    tampa: prop('p-tampa'),
    houston: prop('p-houston'),
    atlanta: prop('p-atlanta'),
    sanjuan: prop('p-sanjuan'),
  };
  const today = (p: Property) => todayOf(p.timezone);

  // ───────── Contratos (fechas) ─────────
  const curMonth = monthKeyOf(today(P.houston));
  const houstonStart = monthStart(addMonthsToKey(curMonth, -5));
  const atlantaStart = monthStart(addMonthsToKey(monthKeyOf(today(P.atlanta)), -4));
  const atlantaEnd = addDays(monthEndExclusive(addMonthsToKey(monthKeyOf(today(P.atlanta)), 1)), -1);

  // ───────── Reservas ─────────
  const pool = SEED_GUEST_POOL.map((g) => g.id);
  const channelPick = (): Channel => {
    const r = rnd();
    return r < 0.5 ? 'airbnb' : r < 0.7 ? 'booking' : r < 0.85 ? 'vrbo' : 'direct';
  };
  let txSeq = 1;
  const transactions: Transaction[] = [];
  const addTx = (tx: Omit<Transaction, 'id' | 'amountBase' | 'fxRate' | 'status' | 'createdAt' | 'createdBy' | 'currency'> & Partial<Pick<Transaction, 'status' | 'createdBy'>>) => {
    const record: Transaction = {
      id: `tx-${String(txSeq++).padStart(4, '0')}`,
      currency: 'USD',
      amountBase: round2(tx.amount),
      fxRate: 1,
      status: tx.status ?? 'posted',
      createdBy: tx.createdBy ?? 'u-admin',
      createdAt: at(tx.date, '18:00', NY),
      ...tx,
      amount: round2(tx.amount),
    };
    transactions.push(record);
    return record;
  };

  const addBooking = (
    p: Property,
    guestId: string,
    checkIn: string,
    checkOut: string,
    status: Booking['status'],
    channel: Channel,
    opts: { guests?: number; rate?: number; note?: string } = {},
  ): Booking => {
    const rate = opts.rate ?? Math.round((p.nightlyRate * (0.85 + rnd() * 0.3)) / 5) * 5;
    const n = nights(checkIn, checkOut);
    const m = bookingMoney({ nightlyRate: rate, nights: n, cleaningFee: p.cleaningFee, channel, taxRate: p.taxRate });
    const createdAt = at(addDays(checkIn, -randInt(6, 45)), '12:00', p.timezone);
    const history: Booking['statusHistory'] = [{ status: 'confirmed', at: createdAt, by: channel === 'direct' ? 'u-admin' : 'system' }];
    if (status === 'in_progress' || status === 'completed')
      history.push({ status: 'in_progress', at: at(checkIn, p.checkInTime, p.timezone), by: 'system' });
    if (status === 'completed') history.push({ status: 'completed', at: at(checkOut, p.checkOutTime, p.timezone), by: 'system' });
    if (status === 'cancelled') history.push({ status: 'cancelled', at: at(addDays(checkIn, -3), '09:00', p.timezone), by: 'u-support' });
    const b: Booking = {
      id: `bk-${p.id.slice(2)}-${checkIn}`,
      code: '',
      propertyId: p.id,
      guestId,
      channel,
      checkIn,
      checkOut,
      guests: opts.guests ?? Math.max(1, Math.min(p.capacity, randInt(1, p.capacity))),
      nightlyRate: rate,
      cleaningFee: m.cleaningFee,
      commission: m.commission,
      taxes: m.taxes,
      taxRemittedByChannel: m.taxRemittedByChannel,
      netPayout: m.netPayout,
      currency: p.currency,
      status,
      statusHistory: history,
      notes: opts.note ? [{ id: `nt-${checkIn}-${p.id}`, at: createdAt, by: 'u-support', byName: 'Diego Paredes', text: opts.note }] : [],
      source: 'seed',
      needsDetails: false,
      createdAt,
    };
    t.bookings.push(b);
    if (status === 'completed') {
      const method = channel === 'direct' ? 'transfer' : 'channel';
      addTx({ propertyId: p.id, type: 'income', category: 'booking', amount: m.grossIncome, date: checkOut, description: `Reserva · ${n} noches`, method, reference: b.id, source: { kind: 'booking', id: b.id } });
      if (m.commission > 0)
        addTx({ propertyId: p.id, type: 'expense', category: 'commissions', amount: m.commission, date: checkOut, description: `Comisión ${channel}`, source: { kind: 'booking', id: b.id } });
      if (!m.taxRemittedByChannel && m.taxes > 0)
        addTx({ propertyId: p.id, type: 'expense', category: 'lodging_tax', amount: m.taxes, date: checkOut, description: 'Impuesto de hospedaje remitido', source: { kind: 'booking', id: b.id } });
    }
    return b;
  };

  const kevinUsed = { done: false };
  const generateHistory = (p: Property, until: string) => {
    let cursor = addDays(today(p), -HISTORY_DAYS);
    for (;;) {
      const start = addDays(cursor, randInt(0, 3));
      const len = p.type === 'villa' || p.type === 'house' ? randInt(3, 7) : randInt(2, 6);
      const end = addDays(start, len);
      if (end > until) break;
      let guest = pick(pool);
      let note: string | undefined;
      if (!kevinUsed.done && p.id === 'p-orlando' && start > addDays(today(p), -100)) {
        guest = 'g-kevin';
        note = 'Fiesta no autorizada; daños en la sala cubiertos con el depósito.';
        kevinUsed.done = true;
      }
      const cancelled = p.id === 'p-miami' && start > addDays(today(p), -70) && start < addDays(today(p), -62);
      addBooking(p, guest, start, end, cancelled ? 'cancelled' : 'completed', channelPick(), { note });
      cursor = end;
    }
  };

  generateHistory(P.miami, addDays(today(P.miami), -4));
  generateHistory(P.orlando, addDays(today(P.orlando), -2));
  generateHistory(P.tampa, addDays(today(P.tampa), -1));
  generateHistory(P.sanjuan, addDays(today(P.sanjuan), -1));
  generateHistory(P.atlanta, atlantaStart);

  // En curso (una termina hoy: la del recorrido guiado)
  const tm = today(P.miami);
  const tour = addBooking(P.miami, 'g-lucia', addDays(tm, -4), tm, 'in_progress', 'airbnb', { guests: 2, rate: 220 });
  const emily = addBooking(P.orlando, 'g-emily', addDays(today(P.orlando), -2), addDays(today(P.orlando), 3), 'in_progress', 'direct', {
    guests: 4,
    rate: 185,
    note: 'Viene con dos niños pequeños: dejar la cuna armada.',
  });
  const mark = addBooking(P.sanjuan, 'g-mark', addDays(today(P.sanjuan), -1), addDays(today(P.sanjuan), 4), 'in_progress', 'vrbo', { guests: 2, rate: 195 });

  // Próximas (10)
  const g = () => pick(pool);
  const daniel = addBooking(P.miami, 'g-daniel', addDays(tm, 1), addDays(tm, 5), 'confirmed', 'airbnb', { guests: 2 });
  addBooking(P.miami, g(), addDays(tm, 8), addDays(tm, 12), 'confirmed', 'booking');
  addBooking(P.miami, g(), addDays(tm, 15), addDays(tm, 19), 'confirmed', 'direct');
  addBooking(P.orlando, g(), addDays(today(P.orlando), 3), addDays(today(P.orlando), 7), 'confirmed', 'vrbo', { guests: 8 });
  addBooking(P.orlando, g(), addDays(today(P.orlando), 18), addDays(today(P.orlando), 21), 'confirmed', 'airbnb');
  addBooking(P.tampa, g(), addDays(today(P.tampa), 3), addDays(today(P.tampa), 6), 'confirmed', 'airbnb', { guests: 10 });
  addBooking(P.tampa, g(), addDays(today(P.tampa), 9), addDays(today(P.tampa), 13), 'confirmed', 'direct');
  addBooking(P.sanjuan, g(), addDays(today(P.sanjuan), 4), addDays(today(P.sanjuan), 8), 'confirmed', 'airbnb');
  addBooking(P.sanjuan, g(), addDays(today(P.sanjuan), 11), addDays(today(P.sanjuan), 15), 'confirmed', 'booking');
  addBooking(P.atlanta, g(), addDays(atlantaEnd, 2), addDays(atlantaEnd, 5), 'confirmed', 'airbnb', { guests: 2 });

  // Códigos legibles por orden de entrada
  t.bookings.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  t.bookings.forEach((b, i) => (b.code = `R-${1001 + i}`));

  // Bloqueos
  t.blocks.push(
    { id: 'blk-tampa-pump', propertyId: P.tampa.id, start: today(P.tampa), end: addDays(today(P.tampa), 3), reason: 'maintenance', note: 'Cambio de la bomba de la piscina' },
    { id: 'blk-miami-owner', propertyId: P.miami.id, start: addDays(tm, 25), end: addDays(tm, 28), reason: 'owner', note: 'Uso del propietario' },
  );

  // ───────── Limpiezas ─────────
  const checklistItems = (propertyId: string, done: boolean) =>
    SEED_CHECKLISTS.find((c) => c.propertyId === propertyId)!.rooms.flatMap((r) => r.items.map((label) => ({ room: r.name, label, done })));
  const guestName = (id: string) => t.people.find((p) => p.id === id)?.name;
  let taskSeq = 1;
  const addTask = (task: Partial<CleaningTask> & Pick<CleaningTask, 'propertyId' | 'type' | 'status' | 'date' | 'time'>): CleaningTask => {
    const p = prop(task.propertyId);
    const record: CleaningTask = {
      id: `ct-${String(taskSeq++).padStart(4, '0')}`,
      priority: 'normal',
      assigneeId: p.defaultCleanerId,
      fee: p.cleaningPay,
      currency: p.currency,
      items: checklistItems(p.id, task.status === 'done'),
      photos: [],
      supplies: [],
      incidentIds: [],
      notes: '',
      createdAt: at(addDays(task.date, -2), '09:00', p.timezone),
      createdBy: 'system',
      ...task,
    };
    t.cleaningTasks.push(record);
    return record;
  };

  for (const b of t.bookings.filter((x) => x.status === 'completed')) {
    const p = prop(b.propertyId);
    const next = t.bookings
      .filter((x) => x.propertyId === b.propertyId && x.checkIn >= b.checkOut && x.status !== 'cancelled')
      .sort((x, y) => x.checkIn.localeCompare(y.checkIn))[0];
    const task = addTask({
      propertyId: b.propertyId,
      bookingId: b.id,
      type: 'checkout',
      status: 'done',
      date: b.checkOut,
      time: p.checkOutTime,
      guestName: guestName(b.guestId),
      nextCheckIn: next ? { date: next.checkIn, time: p.checkInTime } : undefined,
      startedAt: at(b.checkOut, '11:30', p.timezone),
      completedAt: at(b.checkOut, '14:00', p.timezone),
      createdAt: at(b.checkOut, p.checkOutTime, p.timezone),
      notes: 'Historial de ejemplo: las fotos no se incluyen.',
    });
    const exp = addTx({ propertyId: p.id, type: 'expense', category: 'cleaning', amount: task.fee, date: b.checkOut, description: 'Limpieza de salida', method: 'transfer', source: { kind: 'cleaning', id: task.id } });
    task.expenseId = exp.id;
  }

  // Pendientes de hoy (3) + una atrasada + próximas
  addTask({ propertyId: P.tampa.id, type: 'deep', status: 'pending', date: today(P.tampa), time: '10:00', priority: 'high', notes: 'Antes de la llegada de un grupo de 10 personas.' });
  addTask({ propertyId: P.atlanta.id, type: 'deep', status: 'pending', date: today(P.atlanta), time: '11:00', notes: 'Servicio mensual incluido en el contrato.' });
  addTask({ propertyId: P.houston.id, type: 'inspection', status: 'pending', date: today(P.houston), time: '15:00', notes: 'Inspección trimestral del loft.' });
  addTask({ propertyId: P.sanjuan.id, type: 'inspection', status: 'pending', date: addDays(today(P.sanjuan), -1), time: '16:00', notes: 'Revisar el balcón después de la lluvia.' });
  addTask({ propertyId: P.miami.id, type: 'inspection', status: 'pending', date: addDays(tm, 6), time: '13:00' });
  addTask({ propertyId: P.sanjuan.id, type: 'deep', status: 'pending', date: addDays(today(P.sanjuan), 9), time: '12:00' });

  // ───────── Mantenimiento ─────────
  let orderSeq = 301;
  const addOrder = (o: Partial<MaintenanceOrder> & Pick<MaintenanceOrder, 'propertyId' | 'title' | 'category' | 'priority' | 'status'>): MaintenanceOrder => {
    const p = prop(o.propertyId);
    const record: MaintenanceOrder = {
      id: `mo-${orderSeq}`,
      code: `OT-${orderSeq}`,
      description: '',
      currency: p.currency,
      materials: [],
      photos: [],
      approval: { status: 'not_required' },
      createdAt: hoursAgo(48),
      createdBy: 'u-admin',
      ...o,
    };
    orderSeq++;
    t.maintenanceOrders.push(record);
    return record;
  };
  const resolvedOrder = (p: Property, date: string, title: string, category: MaintenanceCategory, cost: number, who: { vendorId: string; userId?: string }, preventiveId?: string) => {
    const o = addOrder({
      propertyId: p.id,
      title,
      category,
      priority: 'low',
      status: 'resolved',
      vendorId: who.vendorId,
      assigneeUserId: who.userId,
      scheduledDate: date,
      estimate: cost,
      actualCost: cost,
      resolvedAt: at(date, '15:00', p.timezone),
      resolutionNote: 'Trabajo hecho.',
      createdAt: at(addDays(date, -3), '09:00', p.timezone),
      preventiveId,
    });
    const exp = addTx({ propertyId: p.id, type: 'expense', category: 'maintenance', amount: cost, date, description: `${o.code} · ${title}`, method: 'transfer', source: { kind: 'maintenance', id: o.id } });
    o.expenseId = exp.id;
    return o;
  };

  // Historia de mantenimiento
  for (const p of t.properties) {
    resolvedOrder(p, addDays(today(p), -95 + randInt(0, 10)), 'Cambio de filtro del aire acondicionado', 'hvac', 45, { vendorId: 'v-aguilar', userId: 'u-tech' }, `pv-filter-${p.id.slice(2)}`);
  }
  for (let m = 5; m >= 1; m--) {
    resolvedOrder(P.orlando, addDays(today(P.orlando), -m * 30 + 4), 'Fumigación mensual', 'pests', 85, { vendorId: 'v-fumi' }, 'pv-fumi-orlando');
    resolvedOrder(P.tampa, addDays(today(P.tampa), -m * 30 + 9), 'Fumigación mensual', 'pests', 95, { vendorId: 'v-fumi' }, 'pv-fumi-tampa');
  }
  for (let w = 12; w >= 1; w--) resolvedOrder(P.tampa, addDays(today(P.tampa), -w * 14 + 3), 'Limpieza y químicos de la piscina', 'pool', 65, { vendorId: 'v-piscinas' }, 'pv-pool-tampa');
  resolvedOrder(P.miami, addDays(tm, -40), 'Reparar silla del comedor', 'general', 60, { vendorId: 'v-aguilar', userId: 'u-tech' });
  resolvedOrder(P.houston, addDays(today(P.houston), -58), 'Reemplazar cerradura inteligente', 'locks', 289, { vendorId: 'v-aguilar', userId: 'u-tech' });
  resolvedOrder(P.sanjuan, addDays(today(P.sanjuan), -21), 'Destapar desagüe de la ducha', 'plumbing', 120, { vendorId: 'v-aguilar', userId: 'u-tech' });
  resolvedOrder(P.atlanta, addDays(today(P.atlanta), -75), 'Revisión eléctrica', 'electrical', 150, { vendorId: 'v-aguilar', userId: 'u-tech' });

  // Abiertas
  const incAtl: Incident = {
    id: 'inc-atlanta-ac',
    propertyId: P.atlanta.id,
    title: 'El aire acondicionado no enfría',
    description: 'Desde anoche sale aire caliente y el termostato marca 29 °C.',
    category: 'hvac',
    severity: 'urgent',
    source: 'tenant',
    kind: 'problem',
    reportedBy: 'person:t-paula',
    reporterName: 'Paula Restrepo',
    leaseId: 'ls-atlanta',
    photos: [],
    status: 'in_progress',
    createdAt: hoursAgo(20),
    updatedAt: hoursAgo(19),
  };
  const incSju: Incident = {
    id: 'inc-sanjuan-leak',
    propertyId: P.sanjuan.id,
    title: 'Fuga de agua debajo del lavamanos',
    description: 'There is water leaking under the bathroom sink. / Hay agua saliendo debajo del lavamanos del baño principal.',
    category: 'plumbing',
    severity: 'urgent',
    source: 'guest',
    kind: 'problem',
    reportedBy: 'person:g-mark',
    reporterName: 'Mark Thompson',
    bookingId: mark.id,
    photos: [],
    status: 'in_progress',
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(2),
  };
  const oAtl = addOrder({
    propertyId: P.atlanta.id,
    incidentId: incAtl.id,
    title: 'Aire acondicionado no enfría',
    description: incAtl.description,
    category: 'hvac',
    priority: 'urgent',
    status: 'scheduled',
    assigneeUserId: 'u-tech',
    vendorId: 'v-aguilar',
    scheduledDate: today(P.atlanta),
    estimate: 320,
    createdAt: hoursAgo(19),
  });
  incAtl.maintenanceOrderId = oAtl.id;
  const oSju = addOrder({
    propertyId: P.sanjuan.id,
    incidentId: incSju.id,
    title: 'Fuga de agua en el baño principal',
    description: incSju.description,
    category: 'plumbing',
    priority: 'urgent',
    status: 'open',
    assigneeUserId: 'u-tech',
    vendorId: 'v-aguilar',
    createdAt: hoursAgo(2),
  });
  incSju.maintenanceOrderId = oSju.id;
  const oTampa = addOrder({
    propertyId: P.tampa.id,
    title: 'Reemplazar la bomba de la piscina',
    description: 'La bomba hace ruido y pierde presión. Cotización de Piscinas del Sol.',
    category: 'pool',
    priority: 'high',
    status: 'open',
    vendorId: 'v-piscinas',
    estimate: 1250,
    approval: { status: 'pending', amount: 1250 },
    createdAt: hoursAgo(26),
  });
  addOrder({
    propertyId: P.orlando.id,
    title: 'El grifo de la cocina gotea',
    description: 'Gotea aunque esté cerrado.',
    category: 'plumbing',
    priority: 'medium',
    status: 'scheduled',
    vendorId: 'v-plomeria',
    scheduledDate: addDays(today(P.orlando), 2),
    estimate: 140,
    createdAt: hoursAgo(30),
  });
  addOrder({
    propertyId: P.houston.id,
    title: 'Cambiar bombillos del pasillo',
    category: 'electrical',
    priority: 'low',
    status: 'open',
    assigneeUserId: 'u-tech',
    vendorId: 'v-aguilar',
    estimate: 35,
    createdAt: hoursAgo(70),
  });
  addOrder({
    propertyId: P.miami.id,
    title: 'Revisar el sello de la ventana del balcón',
    description: 'Entra agua cuando llueve fuerte.',
    category: 'general',
    priority: 'medium',
    status: 'scheduled',
    assigneeUserId: 'u-tech',
    vendorId: 'v-aguilar',
    scheduledDate: addDays(tm, -3),
    estimate: 180,
    createdAt: hoursAgo(24 * 6),
  });

  t.incidents.push(
    incAtl,
    incSju,
    {
      id: 'inc-orlando-garage',
      propertyId: P.orlando.id,
      title: 'El control del garaje no funciona',
      description: "The garage remote doesn't work. / El control del garaje no abre.",
      category: 'general',
      severity: 'low',
      source: 'guest',
      kind: 'problem',
      reportedBy: 'person:g-emily',
      reporterName: 'Emily Carter',
      bookingId: emily.id,
      photos: [],
      status: 'open',
      createdAt: hoursAgo(5),
      updatedAt: hoursAgo(5),
    },
    {
      id: 'inc-houston-fridge',
      propertyId: P.houston.id,
      title: 'La nevera hace ruido',
      description: 'Hace un zumbido fuerte de noche.',
      category: 'appliances',
      severity: 'medium',
      source: 'tenant',
      kind: 'problem',
      reportedBy: 'person:t-javier',
      reporterName: 'Javier Morales',
      leaseId: 'ls-houston',
      photos: [],
      status: 'open',
      createdAt: hoursAgo(40),
      updatedAt: hoursAgo(40),
    },
    {
      id: 'inc-miami-chair',
      propertyId: P.miami.id,
      title: 'Silla del comedor rota',
      description: 'Una pata floja. Reportado en la limpieza.',
      category: 'general',
      severity: 'low',
      source: 'cleaning',
      kind: 'damage',
      reportedBy: 'u-clean-1',
      reporterName: 'Rosa Jiménez',
      photos: [],
      status: 'resolved',
      createdAt: at(addDays(tm, -42), '13:00', P.miami.timezone),
      updatedAt: at(addDays(tm, -40), '15:00', P.miami.timezone),
    },
  );

  // Preventivo (el filtro de Orlando vence hoy: al abrir la app se crea su orden sola)
  const filterDue: Record<string, number> = { miami: 12, orlando: 0, tampa: 33, houston: 47, atlanta: 61, sanjuan: 80 };
  for (const p of t.properties) {
    const k = p.id.slice(2);
    t.preventive.push({
      id: `pv-filter-${k}`,
      propertyId: p.id,
      title: 'Cambio de filtro del aire acondicionado',
      category: 'hvac',
      every: { unit: 'month', count: 3 },
      nextDue: addDays(today(p), filterDue[k] ?? 30),
      vendorId: 'v-aguilar',
      assigneeUserId: 'u-tech',
      estimate: 45,
      active: true,
    });
  }
  const pv = (x: Omit<PreventiveSchedule, 'active'>) => t.preventive.push({ ...x, active: true });
  pv({ id: 'pv-fumi-orlando', propertyId: P.orlando.id, title: 'Fumigación mensual', category: 'pests', every: { unit: 'month', count: 1 }, nextDue: addDays(today(P.orlando), 4), vendorId: 'v-fumi', estimate: 85 });
  pv({ id: 'pv-fumi-tampa', propertyId: P.tampa.id, title: 'Fumigación mensual', category: 'pests', every: { unit: 'month', count: 1 }, nextDue: addDays(today(P.tampa), 9), vendorId: 'v-fumi', estimate: 95 });
  pv({ id: 'pv-pool-tampa', propertyId: P.tampa.id, title: 'Limpieza y químicos de la piscina', category: 'pool', every: { unit: 'week', count: 1 }, nextDue: addDays(today(P.tampa), 2), vendorId: 'v-piscinas', estimate: 65 });
  pv({ id: 'pv-pool-orlando', propertyId: P.orlando.id, title: 'Limpieza de la piscina', category: 'pool', every: { unit: 'week', count: 1 }, nextDue: addDays(today(P.orlando), 3), vendorId: 'v-piscinas', estimate: 55 });
  pv({ id: 'pv-garden-orlando', propertyId: P.orlando.id, title: 'Jardín', category: 'garden', every: { unit: 'week', count: 2 }, nextDue: addDays(today(P.orlando), 6), vendorId: 'v-jardin', estimate: 70 });

  // ───────── Contratos y pagos ─────────
  const houston: Lease = {
    id: 'ls-houston',
    code: 'C-201',
    propertyId: P.houston.id,
    tenantId: 't-javier',
    start: houstonStart,
    end: addDays(monthStart(addMonthsToKey(monthKeyOf(houstonStart), 12)), -1),
    rent: 2800,
    currency: 'USD',
    dueDay: 1,
    deposit: 2800,
    lateFee: { kind: 'percent', value: 5, graceDays: 3 },
    status: 'active',
    notes: 'Incluye estacionamiento. El inquilino paga luz e internet.',
    createdAt: at(addDays(houstonStart, -15), '10:00', P.houston.timezone),
  };
  const atlanta: Lease = {
    id: 'ls-atlanta',
    code: 'C-202',
    propertyId: P.atlanta.id,
    tenantId: 't-paula',
    start: atlantaStart,
    end: atlantaEnd,
    rent: 1650,
    currency: 'USD',
    dueDay: 5,
    deposit: 1650,
    lateFee: { kind: 'fixed', value: 75, graceDays: 5 },
    status: 'active',
    notes: 'Contrato de 6 meses (propiedad mixta). Incluye limpieza mensual.',
    createdAt: at(addDays(atlantaStart, -10), '10:00', P.atlanta.timezone),
  };
  t.leases.push(houston, atlanta);

  const addPayment = (lease: Lease, period: string, paidOn: string, method: LeasePayment['method']) => {
    const p = prop(lease.propertyId);
    const pay: LeasePayment = {
      id: `lp-${lease.id.slice(3)}-${period}`,
      leaseId: lease.id,
      period,
      amount: lease.rent,
      lateFee: 0,
      paidOn,
      method,
      reference: `${method === 'zelle' ? 'ZL' : 'TR'}-${period.replace('-', '')}`,
      recordedBy: 'u-admin',
      createdAt: at(paidOn, '17:00', p.timezone),
    };
    t.leasePayments.push(pay);
    addTx({ propertyId: p.id, type: 'income', category: 'rent', amount: lease.rent, date: paidOn, description: `Renta ${period} · ${lease.code}`, method, reference: pay.reference, source: { kind: 'lease_payment', id: pay.id } });
  };
  // Houston: paga a tiempo, salvo el último mes que ya pasó la gracia (queda atrasado).
  {
    const th = today(P.houston);
    let overdue: string | null = null;
    for (let period = monthKeyOf(houston.start); period <= monthKeyOf(th); period = addMonthsToKey(period, 1)) {
      if (addDays(dueDateFor(houston, period), houston.lateFee.graceDays) < th) overdue = period;
    }
    for (let period = monthKeyOf(houston.start); overdue && period < overdue; period = addMonthsToKey(period, 1))
      addPayment(houston, period, addDays(dueDateFor(houston, period), randInt(0, 2)), 'transfer');
  }
  // Atlanta: paga antes de la fecha.
  {
    const ta = today(P.atlanta);
    for (let period = monthKeyOf(atlanta.start); dueDateFor(atlanta, period) <= ta; period = addMonthsToKey(period, 1))
      addPayment(atlanta, period, addDays(dueDateFor(atlanta, period), -2), 'zelle');
  }

  // ───────── Gastos fijos del mes ─────────
  for (let m = -6; m <= 0; m++) {
    const key = addMonthsToKey(monthKeyOf(localToday), m);
    for (const p of t.properties) {
      const tp = today(p);
      const on = (day: number) => `${key}-${String(day).padStart(2, '0')}`;
      const add = (day: number, category: string, amount: number, description: string) => {
        const date = on(day);
        if (date > tp || date < addDays(tp, -HISTORY_DAYS)) return;
        addTx({ propertyId: p.id, type: 'expense', category, amount, date, description, method: 'transfer', source: { kind: 'recurring' } });
      };
      const priv = p.ownerPrivate;
      if (priv.hoaMonthly) add(10, 'hoa', priv.hoaMonthly, 'Cuota de condominio / HOA');
      if (priv.mortgage) add(15, 'mortgage', priv.mortgage.monthlyPayment, `Hipoteca · ${priv.mortgage.lender}`);
      if (priv.insurance) add(25, 'insurance', round2(priv.insurance.annualPremium / 12), `Seguro · ${priv.insurance.provider}`);
      if (p.rentalMode !== 'monthly') {
        add(20, 'utilities', randInt(140, 380), 'Luz, agua e internet');
        add(8, 'supplies', randInt(40, 95), 'Insumos (papel, jabón, café)');
      }
    }
    const portfolioDate = `${key}-28`;
    if (portfolioDate <= localToday && portfolioDate >= addDays(localToday, -HISTORY_DAYS))
      addTx({ type: 'expense', category: 'management', amount: 1500, date: portfolioDate, description: 'Administración del portafolio (equipo)', method: 'transfer', source: { kind: 'recurring' } });
    t.budgets.push({ id: `bg-${key}`, month: key, amount: 24000 });
  }
  t.transactions = transactions.sort((a, b) => a.date.localeCompare(b.date));

  // ───────── Mensajes ─────────
  const threads: Thread[] = [];
  const messages: Message[] = [];
  let msgSeq = 1;
  const thread = (th: Omit<Thread, 'lastMessageAt' | 'lastMessagePreview' | 'unreadTeam' | 'unreadPerson' | 'createdAt'>, msgs: { who: 'team' | 'person' | 'system'; text: string; hoursAgo: number; name?: string; templateKey?: string }[], unread: { team?: number; person?: number } = {}) => {
    const person = t.people.find((p) => p.id === th.personId)!;
    const ordered = [...msgs].sort((a, b) => b.hoursAgo - a.hoursAgo);
    for (const m of ordered) {
      messages.push({
        id: `msg-${String(msgSeq++).padStart(4, '0')}`,
        threadId: th.id,
        at: hoursAgo(m.hoursAgo),
        author:
          m.who === 'person'
            ? { kind: 'person', personId: person.id, name: person.name }
            : m.who === 'system'
              ? { kind: 'system', name: 'Sistema' }
              : { kind: 'team', userId: 'u-support', name: m.name ?? 'Diego Paredes' },
        body: m.text,
        templateKey: m.templateKey,
        attachments: [],
      });
    }
    const last = ordered[ordered.length - 1];
    threads.push({
      ...th,
      lastMessageAt: hoursAgo(last.hoursAgo),
      lastMessagePreview: last.text.slice(0, 90),
      unreadTeam: unread.team ?? 0,
      unreadPerson: unread.person ?? 0,
      createdAt: hoursAgo(ordered[0].hoursAgo),
    });
  };
  thread({ id: 'th-tour', kind: 'booking', propertyId: P.miami.id, bookingId: tour.id, personId: 'g-lucia', subject: `Reserva ${tour.code}` }, [
    { who: 'team', text: '¡Hola Lucía! Gracias por reservar Apartamento Moderno Miami. Te esperamos desde las 4:00 p. m.', hoursAgo: 24 * 6, templateKey: 'welcome' },
    { who: 'person', text: '¡Gracias! ¿Hay estacionamiento?', hoursAgo: 24 * 5 },
    { who: 'team', text: 'Sí, en el nivel P2, puesto 2405. ¡Buen viaje!', hoursAgo: 24 * 5 - 1 },
    { who: 'person', text: '¿A qué hora es la salida hoy?', hoursAgo: 4 },
    { who: 'team', text: 'A las 11:00 a. m. Deja las llaves en la recepción, por favor. ¡Gracias por todo!', hoursAgo: 3 },
  ]);
  thread({ id: 'th-emily', kind: 'booking', propertyId: P.orlando.id, bookingId: emily.id, personId: 'g-emily', subject: `Booking ${emily.code}` }, [
    { who: 'team', text: 'Hi Emily! Thanks for booking Casa Familiar Orlando. We look forward to seeing you from 4:00 pm.', hoursAgo: 24 * 8, templateKey: 'welcome' },
    { who: 'team', text: 'Hi Emily, check-in is today from 4:00 pm. Your door and wifi codes are in your app during your stay.', hoursAgo: 52, templateKey: 'checkin' },
    { who: 'person', text: 'We arrived, the house is lovely! The crib is ready, thank you.', hoursAgo: 46 },
    { who: 'person', text: "Hi! The garage remote isn't working. Is there another way to park inside?", hoursAgo: 5 },
  ], { team: 1 });
  thread({ id: 'th-mark', kind: 'booking', propertyId: P.sanjuan.id, bookingId: mark.id, personId: 'g-mark', subject: `Booking ${mark.code}` }, [
    { who: 'team', text: 'Hi Mark! Welcome to Apartamento Condado San Juan. Enjoy the beach!', hoursAgo: 26, templateKey: 'welcome' },
    { who: 'person', text: 'There is water leaking under the bathroom sink. Can someone come today?', hoursAgo: 3 },
    { who: 'team', text: 'So sorry, Mark. Our technician Tomás will contact you today. Please close the valve under the sink.', hoursAgo: 2, name: 'Mariana Ortiz' },
  ], { team: 0 });
  thread({ id: 'th-daniel', kind: 'booking', propertyId: P.miami.id, bookingId: daniel.id, personId: 'g-daniel', subject: `Booking ${daniel.code}` }, [
    { who: 'team', text: 'Hi Daniel! Thanks for booking Apartamento Moderno Miami. See you tomorrow from 4:00 pm.', hoursAgo: 30, templateKey: 'welcome' },
    { who: 'person', text: 'Thanks! Could we check in a bit earlier, around 2 pm?', hoursAgo: 8 },
  ], { team: 1 });
  thread({ id: 'th-javier', kind: 'lease', propertyId: P.houston.id, leaseId: houston.id, personId: 't-javier', subject: `Contrato ${houston.code}` }, [
    { who: 'team', text: 'Hola Javier, te recordamos que la renta del Loft Ejecutivo Houston ($2,800) venció el día 1. Si ya pagaste, ignora este mensaje.', hoursAgo: 30, templateKey: 'rent_due', name: 'Mariana Ortiz' },
    { who: 'person', text: 'Disculpa la demora, la pago este viernes.', hoursAgo: 20 },
    { who: 'person', text: 'Otra cosa: la nevera hace un ruido fuerte de noche.', hoursAgo: 19 },
  ], { team: 1 });
  thread({ id: 'th-paula', kind: 'lease', propertyId: P.atlanta.id, leaseId: atlanta.id, personId: 't-paula', subject: `Contrato ${atlanta.code}` }, [
    { who: 'person', text: 'Hola, el aire acondicionado no enfría desde anoche.', hoursAgo: 20 },
    { who: 'team', text: 'Gracias por avisar, Paula. Tomás va hoy a revisarlo.', hoursAgo: 19, name: 'Mariana Ortiz' },
  ]);
  t.threads = threads;
  t.messages = messages;

  // ───────── Documentos ─────────
  let docSeq = 1;
  const doc = (d: Omit<DocumentRecord, 'id' | 'tags' | 'uploadedBy' | 'createdAt' | 'sample'> & { tags?: string[] }) =>
    t.documents.push({
      id: `doc-${String(docSeq++).padStart(3, '0')}`,
      tags: d.tags ?? [],
      uploadedBy: 'u-admin',
      createdAt: at(addDays(localToday, -randInt(20, 200)), '10:00', NY),
      sample: true,
      ...d,
    });
  for (const p of t.properties) {
    doc({ name: `Póliza de seguro · ${p.name}`, category: 'insurance', propertyId: p.id, expiresOn: p.ownerPrivate.insurance?.expiresOn, visibility: 'finance', tags: ['seguro', p.city] });
    doc({ name: `Escritura · ${p.name}`, category: 'deed', propertyId: p.id, visibility: 'owner', tags: ['escritura'] });
    if (p.license) doc({ name: `Licencia de alquiler vacacional ${p.license.number}`, category: 'license', propertyId: p.id, expiresOn: p.license.expiresOn, visibility: 'team', tags: ['licencia', p.city] });
  }
  doc({ name: `Contrato de arrendamiento ${houston.code}`, category: 'contract', propertyId: P.houston.id, personId: 't-javier', leaseId: houston.id, expiresOn: houston.end, visibility: 'tenant', tags: ['contrato'] });
  doc({ name: `Contrato de arrendamiento ${atlanta.code}`, category: 'contract', propertyId: P.atlanta.id, personId: 't-paula', leaseId: atlanta.id, expiresOn: atlanta.end, visibility: 'tenant', tags: ['contrato'] });
  doc({ name: 'Manual del loft y reglas del edificio', category: 'other', propertyId: P.houston.id, visibility: 'tenant', tags: ['casa'] });
  doc({ name: 'Manual del estudio', category: 'other', propertyId: P.atlanta.id, visibility: 'tenant', tags: ['casa'] });
  doc({ name: 'Reglamento del edificio', category: 'other', propertyId: P.miami.id, visibility: 'guest', tags: ['casa'] });
  doc({ name: 'Cotización bomba de piscina', category: 'invoice', propertyId: P.tampa.id, visibility: 'finance', tags: ['cotización', 'piscina'] });
  doc({ name: 'Factura cerradura inteligente', category: 'invoice', propertyId: P.houston.id, visibility: 'finance', tags: ['factura'] });
  doc({ name: 'Inspección de seguridad de la piscina', category: 'inspection', propertyId: P.tampa.id, expiresOn: addDays(today(P.tampa), -10), visibility: 'team', tags: ['inspección', 'piscina'] });
  doc({ name: 'Inspección anual de extintores', category: 'inspection', propertyId: P.orlando.id, expiresOn: addDays(today(P.orlando), 160), visibility: 'team', tags: ['inspección'] });

  // ───────── Avisos, tasas, auditoría y ajustes ─────────
  const note = (n: Omit<AppNotification, 'id'>, i: number) => t.notifications.push({ id: `nt-seed-${i}`, ...n });
  note({ at: hoursAgo(30), kind: 'booking', title: 'Nueva reserva', body: `Daniel Kim llega mañana a ${P.miami.name}.`, link: `/reservas/${daniel.id}`, propertyId: P.miami.id, roles: ['owner', 'admin', 'support'] }, 1);
  note({ at: hoursAgo(26), kind: 'approval', title: 'Gasto por aprobar', body: 'Reemplazar la bomba de la piscina (Villa con Piscina Tampa): $1,250.', link: `/operacion/mantenimiento/${oTampa.id}`, propertyId: P.tampa.id, roles: ['owner'] }, 2);
  note({ at: hoursAgo(3), kind: 'incident', title: 'Problema reportado por huésped', body: `Mark Thompson: fuga de agua en el baño (${P.sanjuan.name}).`, link: `/operacion/mantenimiento/${oSju.id}`, propertyId: P.sanjuan.id, roles: ['owner', 'admin', 'support'], userIds: ['u-tech'] }, 3);
  note({ at: hoursAgo(5), kind: 'message', title: 'Mensaje nuevo', body: "Emily Carter: The garage remote isn't working…", link: '/mensajes/th-emily', propertyId: P.orlando.id, roles: ['admin', 'support'] }, 4);

  const fxDate = addDays(localToday, -7);
  t.fxRates.push(
    { id: 'fx-eur', currency: 'EUR', rate: 1.08, date: fxDate },
    { id: 'fx-cad', currency: 'CAD', rate: 0.73, date: fxDate },
    { id: 'fx-mxn', currency: 'MXN', rate: 0.054, date: fxDate },
    { id: 'fx-cop', currency: 'COP', rate: 0.00025, date: fxDate },
  );

  const audit = (hours: number, actorId: string, action: string, entity: string, entityId: string, summary: string) => {
    const u = t.users.find((x) => x.id === actorId)!;
    const e: AuditEntry = { id: `au-seed-${t.audit.length + 1}`, at: hoursAgo(hours), actorId, actorName: u.name, actorRole: u.role, action, entity, entityId, summary };
    t.audit.push(e);
  };
  audit(24 * 3, 'u-admin', 'booking.create', 'booking', daniel.id, `Creó la reserva ${daniel.code} (Daniel Kim, Miami).`);
  audit(26, 'u-admin', 'maintenance.create', 'maintenance', oTampa.id, 'Creó la orden «Reemplazar la bomba de la piscina» (Tampa), pendiente de aprobación.');
  audit(19, 'u-admin', 'maintenance.assign', 'maintenance', oAtl.id, `Asignó ${oAtl.code} a Tomás Aguilar.`);
  audit(2, 'u-admin', 'maintenance.assign', 'maintenance', oSju.id, `Asignó ${oSju.code} a Tomás Aguilar.`);
  audit(30, 'u-admin', 'message.send', 'thread', 'th-javier', 'Envió recordatorio de renta a Javier Morales.');
  audit(24 * 2, 'u-owner', 'settings.update', 'settings', 'app', 'Cambió el umbral de aprobación de gastos a $500.');

  const lastPaid = t.leasePayments.filter((p) => p.leaseId === atlanta.id).sort((a, b) => b.paidOn.localeCompare(a.paidOn))[0];
  if (lastPaid)
    note({ at: at(lastPaid.paidOn, '17:00', P.atlanta.timezone), kind: 'payment', title: 'Pago registrado', body: `Paula Restrepo pagó la renta de ${lastPaid.period}: $1,650.`, link: `/contratos/${atlanta.id}`, propertyId: P.atlanta.id, roles: ['owner', 'admin', 'accountant'] }, 5);

  t.settings.push({
    id: 'app',
    companyName: 'Gestor de Propiedades',
    baseCurrency: 'USD',
    approvalThreshold: 500,
    shareOwnerFinancials: false,
    guestLanguages: ['es', 'en'],
    customExpenseCategories: [],
    customMaintenanceNotes: '',
    theme: 'system',
    seedDate: localToday,
    seededAt: now.toUTC().toISO()!,
  });

  // Prioridad del pendiente de hoy en Tampa (para que se vea arriba)
  const priorityOrder: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  t.maintenanceOrders.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  return t;
}
