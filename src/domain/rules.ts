/**
 * Reglas de negocio puras (sin base de datos): se prueban directo en tests/unit.
 */
import { addDays, addMonthsToKey, daysInMonth, diffDays, maxDate, minDate, monthKeyOf, parseDate } from '@/lib/dates';
import { round2 } from '@/lib/money';
import type { Block, Booking, Channel, FxRate, Lease, LeasePayment } from './types';

// ───────────────────────── Reservas ─────────────────────────

/** Rangos [aStart, aEnd) y [bStart, bEnd): la salida de uno puede ser la entrada del otro. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function nights(checkIn: string, checkOut: string): number {
  return Math.max(0, diffDays(checkIn, checkOut));
}

/** Noches de [checkIn, checkOut) que caen dentro de [start, endExclusive). */
export function nightsInPeriod(checkIn: string, checkOut: string, start: string, endExclusive: string): number {
  const s = maxDate(checkIn, start);
  const e = minDate(checkOut, endExclusive);
  return s < e ? diffDays(s, e) : 0;
}

/** Reservas que bloquean el calendario (las canceladas no). */
export function isActiveBooking(b: Pick<Booking, 'status'>): boolean {
  return b.status !== 'cancelled';
}

/** Primera reserva o bloqueo que choca con el rango propuesto, si hay. */
export function findConflict(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  bookings: Booking[],
  blocks: Block[],
  ignoreBookingId?: string,
): { kind: 'booking'; booking: Booking } | { kind: 'block'; block: Block } | null {
  for (const b of bookings) {
    if (b.propertyId !== propertyId || b.id === ignoreBookingId || !isActiveBooking(b)) continue;
    if (rangesOverlap(checkIn, checkOut, b.checkIn, b.checkOut)) return { kind: 'booking', booking: b };
  }
  for (const bl of blocks) {
    if (bl.propertyId !== propertyId) continue;
    if (rangesOverlap(checkIn, checkOut, bl.start, bl.end)) return { kind: 'block', block: bl };
  }
  return null;
}

export const CHANNEL_COMMISSION: Record<Channel, number> = {
  airbnb: 0.03,
  booking: 0.15,
  vrbo: 0.05,
  direct: 0,
};

/** Airbnb y Vrbo cobran y pagan el impuesto de hospedaje por su cuenta. */
export const CHANNEL_REMITS_TAX: Record<Channel, boolean> = {
  airbnb: true,
  booking: false,
  vrbo: true,
  direct: false,
};

export interface BookingMoney {
  accommodation: number;
  cleaningFee: number;
  commission: number;
  taxes: number;
  taxRemittedByChannel: boolean;
  /** Lo que recibe el propietario. */
  netPayout: number;
  /** Ingreso que se registra en las finanzas al terminar la estadía. */
  grossIncome: number;
}

/**
 * Montos de una reserva. El impuesto lo paga el huésped: si el canal lo remite, no pasa por el
 * propietario; si no, entra en el pago y sale como gasto «Impuestos de hospedaje».
 */
export function bookingMoney(input: {
  nightlyRate: number;
  nights: number;
  cleaningFee: number;
  channel: Channel;
  taxRate: number;
  commission?: number;
}): BookingMoney {
  const accommodation = round2(input.nightlyRate * input.nights);
  const base = accommodation + input.cleaningFee;
  const commission = round2(input.commission ?? base * CHANNEL_COMMISSION[input.channel]);
  const taxes = round2(base * input.taxRate);
  const remitted = CHANNEL_REMITS_TAX[input.channel];
  const grossIncome = round2(base + (remitted ? 0 : taxes));
  return {
    accommodation,
    cleaningFee: round2(input.cleaningFee),
    commission,
    taxes,
    taxRemittedByChannel: remitted,
    netPayout: round2(grossIncome - commission),
    grossIncome,
  };
}

// ───────────────────────── Códigos de acceso ─────────────────────────

/**
 * El huésped ve los códigos solo durante su estadía: desde el día de entrada hasta el de salida
 * (incluidos, en la zona horaria de la propiedad) y si la reserva no está cancelada ni terminada.
 */
export function codesVisibleForStay(booking: Pick<Booking, 'checkIn' | 'checkOut' | 'status'>, todayAtProperty: string): boolean {
  if (booking.status === 'cancelled' || booking.status === 'completed') return false;
  return todayAtProperty >= booking.checkIn && todayAtProperty <= booking.checkOut;
}

export function maskCode(value: string): string {
  return '•'.repeat(Math.max(4, Math.min(8, value.length)));
}

// ───────────────────────── Ocupación, ADR y RevPAR ─────────────────────────

export interface OccupancyStats {
  availableNights: number;
  nightsSold: number;
  roomRevenue: number;
  occupancy: number;
  adr: number;
  revpar: number;
}

/**
 * Para una propiedad por noches en [start, endExclusive):
 * - noches disponibles = días del período − noches bloqueadas;
 * - ocupación = noches vendidas / disponibles;
 * - ADR = ingreso por alojamiento / noches vendidas (sin limpieza ni impuestos);
 * - RevPAR = ingreso por alojamiento / noches disponibles (= ADR × ocupación).
 */
export function occupancyStats(
  bookings: Pick<Booking, 'checkIn' | 'checkOut' | 'nightlyRate' | 'status'>[],
  blocks: Pick<Block, 'start' | 'end'>[],
  start: string,
  endExclusive: string,
): OccupancyStats {
  const periodDays = diffDays(start, endExclusive);
  const blocked = blocks.reduce((sum, b) => sum + nightsInPeriod(b.start, b.end, start, endExclusive), 0);
  const availableNights = Math.max(0, periodDays - blocked);
  let nightsSold = 0;
  let roomRevenue = 0;
  for (const b of bookings) {
    if (!isActiveBooking(b)) continue;
    const n = nightsInPeriod(b.checkIn, b.checkOut, start, endExclusive);
    nightsSold += n;
    roomRevenue += n * b.nightlyRate;
  }
  nightsSold = Math.min(nightsSold, availableNights);
  roomRevenue = round2(roomRevenue);
  return {
    availableNights,
    nightsSold,
    roomRevenue,
    occupancy: availableNights ? nightsSold / availableNights : 0,
    adr: nightsSold ? round2(roomRevenue / nightsSold) : 0,
    revpar: availableNights ? round2(roomRevenue / availableNights) : 0,
  };
}

/** Días de [start, endExclusive) cubiertos por un contrato (fin inclusivo). */
export function leaseDaysInPeriod(lease: Pick<Lease, 'start' | 'end' | 'status'>, start: string, endExclusive: string): number {
  if (lease.status === 'terminated') return 0;
  return nightsInPeriod(lease.start, addDays(lease.end, 1), start, endExclusive);
}

// ───────────────────────── Alquileres largos ─────────────────────────

/** Fecha de pago de un mes (el día de pago se recorta al último día del mes). */
export function dueDateFor(lease: Pick<Lease, 'dueDay'>, period: string): string {
  const day = Math.min(lease.dueDay, daysInMonth(period));
  return `${period}-${String(day).padStart(2, '0')}`;
}

/** Recargo por atraso: se cobra si se paga (o sigue sin pagar) después de la gracia. */
export function lateFeeFor(lease: Pick<Lease, 'rent' | 'lateFee'>, dueDate: string, paidOnOrToday: string): number {
  const daysLate = diffDays(dueDate, paidOnOrToday);
  if (daysLate <= lease.lateFee.graceDays) return 0;
  return lease.lateFee.kind === 'percent' ? round2((lease.rent * lease.lateFee.value) / 100) : round2(lease.lateFee.value);
}

export type LedgerStatus = 'paid' | 'paid_late' | 'due' | 'overdue' | 'upcoming';

export interface LedgerRow {
  period: string;
  dueDate: string;
  rent: number;
  lateFee: number;
  status: LedgerStatus;
  daysLate: number;
  payment?: LeasePayment;
}

/** Libro de pagos del contrato hasta `today` (más el próximo pago). */
export function leaseLedger(lease: Lease, payments: LeasePayment[], today: string): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const lastPeriod = monthKeyOf(minDate(lease.end, addDays(today, 31)));
  for (let period = monthKeyOf(lease.start); period <= lastPeriod; period = addMonthsToKey(period, 1)) {
    const dueDate = maxDate(dueDateFor(lease, period), lease.start);
    if (dueDate > lease.end) break;
    const payment = payments.find((p) => p.leaseId === lease.id && p.period === period);
    if (payment) {
      const late = diffDays(dueDate, payment.paidOn);
      rows.push({
        period,
        dueDate,
        rent: lease.rent,
        lateFee: payment.lateFee,
        status: late > lease.lateFee.graceDays ? 'paid_late' : 'paid',
        daysLate: Math.max(0, late),
        payment,
      });
      continue;
    }
    const daysLate = diffDays(dueDate, today);
    let status: LedgerStatus;
    if (dueDate > today) status = 'upcoming';
    else if (daysLate > lease.lateFee.graceDays) status = 'overdue';
    else status = 'due';
    if (status === 'upcoming' && rows.some((r) => r.status === 'upcoming')) break;
    rows.push({
      period,
      dueDate,
      rent: lease.rent,
      lateFee: status === 'overdue' ? lateFeeFor(lease, dueDate, today) : 0,
      status,
      daysLate: Math.max(0, daysLate),
    });
  }
  return rows;
}

/** Días que faltan para que termine el contrato (negativo si ya terminó). */
export function daysToLeaseEnd(lease: Pick<Lease, 'end'>, today: string): number {
  return diffDays(today, lease.end);
}

// ───────────────────────── Monedas ─────────────────────────

export class MissingRateError extends Error {
  constructor(public currency: string) {
    super(`Falta la tasa de cambio de ${currency}. Agrégala en Ajustes → Monedas.`);
    this.name = 'MissingRateError';
  }
}

export class MixedCurrencyError extends Error {
  constructor(currencies: string[]) {
    super(`No se suman monedas distintas sin convertir (${currencies.join(', ')}).`);
    this.name = 'MixedCurrencyError';
  }
}

/** Tasa vigente (la más reciente con fecha ≤ `date`); si no hay, la más vieja disponible. */
export function rateFor(currency: string, base: string, rates: FxRate[], date: string): number {
  if (currency === base) return 1;
  const candidates = rates.filter((r) => r.currency === currency).sort((a, b) => a.date.localeCompare(b.date));
  if (candidates.length === 0) throw new MissingRateError(currency);
  const valid = candidates.filter((r) => r.date <= date);
  return (valid.length ? valid[valid.length - 1] : candidates[0]).rate;
}

/** Convierte entre dos monedas pasando por la moneda base. */
export function convert(amount: number, from: string, to: string, base: string, rates: FxRate[], date: string): number {
  if (from === to) return round2(amount);
  const inBase = amount * rateFor(from, base, rates, date);
  return round2(inBase / rateFor(to, base, rates, date));
}

/** Suma montos de una sola moneda; si hay monedas distintas, falla. */
export function sumSameCurrency(items: { amount: number; currency: string }[]): { amount: number; currency: string | null } {
  const currencies = [...new Set(items.map((i) => i.currency))];
  if (currencies.length > 1) throw new MixedCurrencyError(currencies);
  return { amount: round2(items.reduce((s, i) => s + i.amount, 0)), currency: currencies[0] ?? null };
}

// ───────────────────────── Gastos ─────────────────────────

export function needsOwnerApproval(amountBase: number, threshold: number): boolean {
  return amountBase > threshold;
}

// ───────────────────────── Salud de la propiedad ─────────────────────────

export interface HealthInput {
  openIncidents: { severity: 'urgent' | 'high' | 'medium' | 'low' }[];
  overdueOrders: number;
  overdueCleanings: number;
  expiringDocs: number;
  expiredDocs: number;
}

export interface HealthResult {
  score: number;
  label: 'Buena' | 'Atención' | 'Crítica';
  tone: 'good' | 'warn' | 'bad';
  reasons: string[];
}

/** Nota de 0 a 100 que sale de incidencias abiertas, mantenimiento atrasado y documentos por vencer. */
export function propertyHealth(input: HealthInput): HealthResult {
  let score = 100;
  const reasons: string[] = [];
  for (const inc of input.openIncidents) score -= inc.severity === 'urgent' ? 25 : inc.severity === 'high' ? 15 : 8;
  if (input.openIncidents.length)
    reasons.push(`${input.openIncidents.length} incidencia${input.openIncidents.length > 1 ? 's' : ''} abierta${input.openIncidents.length > 1 ? 's' : ''}`);
  score -= input.overdueOrders * 12;
  if (input.overdueOrders) reasons.push(`${input.overdueOrders} orden${input.overdueOrders > 1 ? 'es' : ''} de mantenimiento atrasada${input.overdueOrders > 1 ? 's' : ''}`);
  score -= input.overdueCleanings * 10;
  if (input.overdueCleanings) reasons.push(`${input.overdueCleanings} limpieza${input.overdueCleanings > 1 ? 's' : ''} sin hacer`);
  score -= input.expiringDocs * 8 + input.expiredDocs * 20;
  if (input.expiringDocs) reasons.push(`${input.expiringDocs} documento${input.expiringDocs > 1 ? 's' : ''} por vencer`);
  if (input.expiredDocs) reasons.push(`${input.expiredDocs} documento${input.expiredDocs > 1 ? 's' : ''} vencido${input.expiredDocs > 1 ? 's' : ''}`);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const tone = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';
  return { score, tone, label: tone === 'good' ? 'Buena' : tone === 'warn' ? 'Atención' : 'Crítica', reasons };
}

// ───────────────────────── Plantillas ─────────────────────────

/** Reemplaza {{variable}} por su valor; las que no existen quedan a la vista entre corchetes. */
export function renderTemplate(body: string, vars: Record<string, string | undefined>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => vars[key] ?? `[${key}]`);
}

/** Próxima fecha de un calendario preventivo. */
export function nextDueDate(from: string, every: { unit: 'week' | 'month'; count: number }): string {
  const d = parseDate(from);
  return (every.unit === 'week' ? d.plus({ weeks: every.count }) : d.plus({ months: every.count })).toISODate()!;
}
