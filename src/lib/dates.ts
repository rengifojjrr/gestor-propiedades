/** Utilidades de fechas de calendario (AAAA-MM-DD) con luxon. Interfaz en español. */
import { DateTime, Interval } from 'luxon';

const LOCALE = 'es';

export function parseDate(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' });
}

export function addDays(iso: string, days: number): string {
  return parseDate(iso).plus({ days }).toISODate()!;
}

export function addMonths(iso: string, months: number): string {
  return parseDate(iso).plus({ months }).toISODate()!;
}

/** Días desde `from` hasta `to` (to − from). */
export function diffDays(from: string, to: string): number {
  return Math.round(parseDate(to).diff(parseDate(from), 'days').days);
}

export function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a > b ? a : b;
}

/** Lista de fechas en [start, endExclusive). */
export function eachDay(start: string, endExclusive: string): string[] {
  const out: string[] = [];
  for (let d = start; d < endExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export function monthStart(key: string): string {
  return `${key}-01`;
}

/** Primer día del mes siguiente (fin exclusivo). */
export function monthEndExclusive(key: string): string {
  return parseDate(`${key}-01`).plus({ months: 1 }).toISODate()!;
}

export function addMonthsToKey(key: string, months: number): string {
  return parseDate(`${key}-01`).plus({ months }).toFormat('yyyy-MM');
}

/** Los últimos `count` meses terminando en `endKey` (incluido), del más viejo al más nuevo. */
export function lastMonths(endKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addMonthsToKey(endKey, i - count + 1));
}

export function daysInMonth(key: string): number {
  return parseDate(`${key}-01`).daysInMonth ?? 30;
}

export function monthLabel(key: string, style: 'long' | 'short' = 'long'): string {
  const d = parseDate(`${key}-01`).setLocale(LOCALE);
  const text = style === 'long' ? d.toFormat('LLLL yyyy') : d.toFormat('LLL');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «12 nov» o «12 nov 2026» si el año no es el actual. */
export function formatDate(iso: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const d = parseDate(iso).setLocale(LOCALE);
  const fmt = `${opts.weekday ? 'ccc ' : ''}d LLL${opts.year ? ' yyyy' : ''}`;
  return d.toFormat(fmt).replace('.', '');
}

/** «jueves, 12 de noviembre». */
export function formatDateLong(iso: string): string {
  return parseDate(iso).setLocale(LOCALE).toFormat("cccc, d 'de' LLLL");
}

/** «10–15 nov» o «28 oct – 2 nov». */
export function formatRange(start: string, end: string): string {
  const a = parseDate(start).setLocale(LOCALE);
  const b = parseDate(end).setLocale(LOCALE);
  if (a.month === b.month && a.year === b.year) return `${a.day}–${b.day} ${b.toFormat('LLL').replace('.', '')}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** Fecha y hora de un ISO con zona: «12 nov, 3:05 p. m.» en la zona dada (o la del navegador). */
export function formatDateTime(isoTimestamp: string, timezone?: string): string {
  let d = DateTime.fromISO(isoTimestamp);
  if (timezone) d = d.setZone(timezone);
  return d.setLocale(LOCALE).toFormat('d LLL, h:mm a').replace(/\.(?=,)/, '');
}

export function formatTime(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  return DateTime.fromObject({ hour: h, minute: m }).setLocale(LOCALE).toFormat('h:mm a');
}

/** «Hoy», «Mañana», «Ayer», «en 3 días», «hace 2 días». */
export function relativeDay(iso: string, today: string): string {
  const d = diffDays(today, iso);
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  if (d === -1) return 'Ayer';
  return d > 0 ? `en ${d} días` : `hace ${-d} días`;
}

/** Hace cuánto (para mensajes y avisos). */
export function timeAgo(isoTimestamp: string, now: DateTime): string {
  const minutes = Math.round(now.diff(DateTime.fromISO(isoTimestamp), 'minutes').minutes);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

export function isWithin(iso: string, start: string, endExclusive: string): boolean {
  return iso >= start && iso < endExclusive;
}

export function intervalDays(start: string, endExclusive: string): number {
  return Math.max(0, Math.round(Interval.fromDateTimes(parseDate(start), parseDate(endExclusive)).length('days')));
}
