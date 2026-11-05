/**
 * Alquileres largos: contratos, libro de pagos (registrados, nunca cobrados), recargos por atraso,
 * avisos de atraso y de renovación, y la app del inquilino.
 */
import { data } from '@/data';
import { daysToLeaseEnd, dueDateFor, lateFeeFor, leaseLedger, rangesOverlap, type LedgerRow } from '@/domain/rules';
import {
  LeaseSchema,
  PAYMENT_METHODS,
  isoDate,
  monthKey,
  type DocumentRecord,
  type Lease,
  type LeasePayment,
  type Person,
  type Property,
} from '@/domain/types';
import { nowIso, todayIn } from '@/lib/clock';
import { addDays } from '@/lib/dates';
import { newId } from '@/lib/ids';
import { round2 } from '@/lib/money';
import { z } from 'zod';
import {
  allowed,
  audit,
  authorize,
  can,
  ConflictError,
  NotFoundError,
  parse,
  pushNotification,
  RuleError,
  subjectFor,
  type Actor,
} from './core';
import { postTransaction } from './finance';

/** Días antes del fin del contrato para avisar la renovación. */
export const RENEWAL_WINDOW_DAYS = 60;

export interface LeaseView extends Lease {
  tenantName: string;
  tenantLanguage: 'es' | 'en';
  propertyName: string;
  propertyCity: string;
  heroSrc: string;
  timezone: string;
  today: string;
  ledger: LedgerRow[];
  overdue: { count: number; amount: number; lateFees: number };
  nextDue?: LedgerRow;
  daysToEnd: number;
  renewalDue: boolean;
  threadId?: string;
}

function toLeaseView(l: Lease, p: Property | undefined, person: Person | undefined, payments: LeasePayment[], threadId?: string): LeaseView {
  const today = todayIn(p?.timezone ?? 'America/New_York');
  const ledger = l.status === 'active' ? leaseLedger(l, payments, today) : leaseLedger(l, payments, l.end);
  const overdueRows = ledger.filter((r) => r.status === 'overdue');
  const daysToEnd = daysToLeaseEnd(l, today);
  return {
    ...l,
    tenantName: person?.name ?? '—',
    tenantLanguage: person?.language ?? 'es',
    propertyName: p?.name ?? '—',
    propertyCity: p?.city ?? '',
    heroSrc: p?.photos[0]?.src ?? '',
    timezone: p?.timezone ?? 'America/New_York',
    today,
    ledger,
    overdue: {
      count: overdueRows.length,
      amount: round2(overdueRows.reduce((s, r) => s + r.rent, 0)),
      lateFees: round2(overdueRows.reduce((s, r) => s + r.lateFee, 0)),
    },
    nextDue: ledger.find((r) => r.status === 'due' || r.status === 'upcoming' || r.status === 'overdue'),
    daysToEnd,
    renewalDue: l.status === 'active' && daysToEnd >= 0 && daysToEnd <= RENEWAL_WINDOW_DAYS,
    threadId,
  };
}

export async function listLeases(actor: Actor): Promise<LeaseView[]> {
  const s = await subjectFor(actor);
  const db = data();
  const [leases, props, people, payments, threads] = await Promise.all([db.leases.all(), db.properties.all(), db.people.all(), db.leasePayments.all(), db.threads.all()]);
  return allowed(s, 'lease.read', leases, (l) => ({ propertyId: l.propertyId, personId: l.tenantId }))
    .map((l) =>
      toLeaseView(
        l,
        props.find((p) => p.id === l.propertyId),
        people.find((p) => p.id === l.tenantId),
        payments.filter((p) => p.leaseId === l.id),
        threads.find((t) => t.leaseId === l.id)?.id,
      ),
    )
    .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.end.localeCompare(b.end));
}

export async function getLease(actor: Actor, id: string): Promise<LeaseView & { documents: DocumentRecord[]; payments: LeasePayment[] }> {
  const db = data();
  const l = await db.leases.get(id);
  if (!l) throw new NotFoundError('el contrato');
  const s = await authorize(actor, 'lease.read', { propertyId: l.propertyId, personId: l.tenantId });
  const [p, person, payments, threads, docs] = await Promise.all([
    db.properties.get(l.propertyId),
    db.people.get(l.tenantId),
    db.leasePayments.find((x) => x.leaseId === id),
    db.threads.find((t) => t.leaseId === id),
    db.documents.find((d) => d.leaseId === id || (d.propertyId === l.propertyId && d.visibility === 'tenant' && !d.personId)),
  ]);
  return {
    ...toLeaseView(l, p, person, payments, threads[0]?.id),
    payments: payments.sort((a, b) => b.period.localeCompare(a.period)),
    documents: docs.filter((d) => can(s, 'document.read', { propertyId: d.propertyId, personId: d.personId, visibility: d.visibility })),
  };
}

const LeaseInput = LeaseSchema.omit({ id: true, code: true, status: true, createdAt: true }).refine((l) => l.end > l.start, {
  message: 'El fin debe ser después del inicio',
  path: ['end'],
});
export type LeaseInput = z.input<typeof LeaseInput>;

export async function createLease(actor: Actor, raw: LeaseInput): Promise<Lease> {
  const input = parse(LeaseInput, raw);
  await authorize(actor, 'lease.write', { propertyId: input.propertyId });
  const db = data();
  const p = await db.properties.get(input.propertyId);
  if (!p) throw new NotFoundError('la propiedad');
  if (p.rentalMode === 'nightly') throw new RuleError(`${p.name} se alquila solo por noches. Cambia el modo a «Mixto» o «Por meses».`);
  const [leases, bookings] = await Promise.all([
    db.leases.find((l) => l.propertyId === p.id && l.status === 'active'),
    db.bookings.find((b) => b.propertyId === p.id && b.status !== 'cancelled' && b.status !== 'completed'),
  ]);
  const endEx = addDays(input.end, 1);
  const clash = leases.find((l) => rangesOverlap(input.start, endEx, l.start, addDays(l.end, 1)));
  if (clash) throw new ConflictError(`Se cruza con el contrato ${clash.code}.`);
  const b = bookings.find((x) => rangesOverlap(input.start, endEx, x.checkIn, x.checkOut));
  if (b) throw new ConflictError(`Se cruza con la reserva ${b.code}.`);
  const tenant = await db.people.get(input.tenantId);
  if (!tenant) throw new NotFoundError('el inquilino');
  const count = (await db.leases.all()).length;
  const lease: Lease = { ...input, id: newId('ls'), code: `C-${201 + count}`, status: 'active', createdAt: nowIso() };
  await db.leases.put(lease);
  if (tenant.kind !== 'tenant') await db.people.put({ ...tenant, kind: 'tenant' });
  await db.threads.put({
    id: newId('th'),
    kind: 'lease',
    propertyId: p.id,
    leaseId: lease.id,
    personId: tenant.id,
    subject: `Contrato ${lease.code}`,
    lastMessageAt: nowIso(),
    lastMessagePreview: 'Contrato creado',
    unreadTeam: 0,
    unreadPerson: 0,
    createdAt: nowIso(),
  });
  await audit(actor, 'lease.create', 'lease', lease.id, `Creó el contrato ${lease.code} (${tenant.name}, ${p.name}).`);
  return lease;
}

export async function updateLeaseStatus(actor: Actor, id: string, status: Lease['status']): Promise<Lease> {
  const db = data();
  const l = await db.leases.get(id);
  if (!l) throw new NotFoundError('el contrato');
  await authorize(actor, 'lease.write', { propertyId: l.propertyId });
  const next = { ...l, status };
  await db.leases.put(next);
  await audit(actor, 'lease.status', 'lease', id, `Cambió el contrato ${l.code} a ${status}.`);
  return next;
}

/** Renovar: extiende el fin (y opcionalmente la renta). */
export async function renewLease(actor: Actor, id: string, newEnd: string, newRent?: number): Promise<Lease> {
  const db = data();
  const l = await db.leases.get(id);
  if (!l) throw new NotFoundError('el contrato');
  await authorize(actor, 'lease.write', { propertyId: l.propertyId });
  parse(isoDate, newEnd);
  if (newEnd <= l.end) throw new RuleError('La nueva fecha de fin debe ser después de la actual.');
  const next = { ...l, end: newEnd, rent: newRent ?? l.rent, status: 'active' as const };
  await db.leases.put(next);
  await audit(actor, 'lease.renew', 'lease', id, `Renovó el contrato ${l.code} hasta ${newEnd}${newRent ? ` con renta ${newRent}` : ''}.`);
  return next;
}

const PaymentInput = z.object({
  period: monthKey,
  amount: z.number({ error: 'Escribe el monto' }).positive('El monto debe ser mayor que cero'),
  paidOn: isoDate,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string(),
  /** Cobrar el recargo por atraso si corresponde. */
  includeLateFee: z.boolean(),
});
export type PaymentInput = z.input<typeof PaymentInput>;

/** Registra un pago de renta (no se procesa: solo se anota método y referencia) y su ingreso. */
export async function recordLeasePayment(actor: Actor, leaseId: string, raw: PaymentInput): Promise<LeasePayment> {
  const input = parse(PaymentInput, raw);
  const db = data();
  const l = await db.leases.get(leaseId);
  if (!l) throw new NotFoundError('el contrato');
  await authorize(actor, 'lease.recordPayment', { propertyId: l.propertyId });
  const existing = await db.leasePayments.find((p) => p.leaseId === leaseId && p.period === input.period);
  if (existing.length) throw new ConflictError(`El mes ${input.period} ya tiene un pago registrado.`);
  const dueDate = dueDateFor(l, input.period);
  const lateFee = input.includeLateFee ? lateFeeFor(l, dueDate, input.paidOn) : 0;
  const payment: LeasePayment = {
    id: newId('lp'),
    leaseId,
    period: input.period,
    amount: round2(input.amount),
    lateFee,
    paidOn: input.paidOn,
    method: input.method,
    reference: input.reference,
    recordedBy: actor.realUser.id,
    createdAt: nowIso(),
  };
  await db.leasePayments.put(payment);
  await postTransaction({ propertyId: l.propertyId, type: 'income', category: 'rent', amount: payment.amount, date: input.paidOn, description: `Renta ${input.period} · ${l.code}`, method: input.method, reference: input.reference, source: { kind: 'lease_payment', id: payment.id }, createdBy: actor.realUser.id });
  if (lateFee > 0)
    await postTransaction({ propertyId: l.propertyId, type: 'income', category: 'late_fee', amount: lateFee, date: input.paidOn, description: `Recargo por atraso ${input.period} · ${l.code}`, method: input.method, reference: input.reference, source: { kind: 'lease_payment', id: payment.id }, createdBy: actor.realUser.id });
  const tenant = await db.people.get(l.tenantId);
  await audit(actor, 'lease.payment', 'lease', leaseId, `Registró el pago de ${input.period} de ${tenant?.name ?? 'inquilino'}: ${payment.amount}${lateFee ? ` + recargo ${lateFee}` : ''}.`);
  await pushNotification({ kind: 'payment', title: 'Pago registrado', body: `${tenant?.name ?? 'Inquilino'} · ${input.period} · ${payment.amount + lateFee} ${l.currency}`, link: `/contratos/${leaseId}`, propertyId: l.propertyId, roles: ['owner', 'admin', 'accountant'] });
  return payment;
}

// ───────────────────────── App del inquilino ─────────────────────────

export interface TenantHome {
  person: Person;
  lease: LeaseView | null;
  property: { id: string; name: string; address: string; city: string; photos: Property['photos']; houseManual: Property['houseManual']; directions: Property['directions']; lat: number; lng: number } | null;
  documents: DocumentRecord[];
  payments: LeasePayment[];
  threadId?: string;
}

/** Lo que ve el inquilino: SU contrato, su próximo pago y su historial. */
export async function tenantHome(actor: Actor): Promise<TenantHome> {
  if (actor.user.role !== 'tenant' || !actor.user.personId) throw new RuleError('Esta vista es para inquilinos.');
  const db = data();
  const person = await db.people.get(actor.user.personId);
  if (!person) throw new NotFoundError('tu ficha');
  const leases = (await listLeases(actor)).filter((l) => l.tenantId === person.id);
  const lease = leases.find((l) => l.status === 'active') ?? leases[0] ?? null;
  if (!lease) return { person, lease: null, property: null, documents: [], payments: [] };
  const full = await getLease(actor, lease.id);
  const p = await db.properties.get(lease.propertyId);
  return {
    person,
    lease,
    property: p ? { id: p.id, name: p.name, address: p.address, city: p.city, photos: p.photos, houseManual: p.houseManual, directions: p.directions, lat: p.lat, lng: p.lng } : null,
    documents: full.documents,
    payments: full.payments,
    threadId: full.threadId,
  };
}
