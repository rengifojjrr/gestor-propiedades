/**
 * Fechas y horas en el idioma de la persona (huésped o inquilino). En español usa las mismas
 * funciones que el resto de la app (@/lib/dates); en inglés, luxon con 'en-US'.
 */
import { DateTime } from 'luxon';
import type { Lang } from '@/domain/types';
import { diffDays, formatDate, formatDateLong, formatRange, formatTime, monthLabel, parseDate, timeAgo } from '@/lib/dates';

const EN = 'en-US';

/** «12 nov» / «Nov 12» (con día de la semana o año si se pide). */
export function fDate(iso: string, lang: Lang, opts: { year?: boolean; weekday?: boolean } = {}): string {
  if (lang === 'es') return formatDate(iso, opts);
  return parseDate(iso)
    .setLocale(EN)
    .toFormat(`${opts.weekday ? 'ccc, ' : ''}LLL d${opts.year ? ', yyyy' : ''}`);
}

/** «jueves, 12 de noviembre» / «Thursday, November 12». */
export function fDateLong(iso: string, lang: Lang): string {
  if (lang === 'es') return formatDateLong(iso);
  return parseDate(iso).setLocale(EN).toFormat('cccc, LLLL d');
}

/** «10–15 nov» / «Nov 10–15». */
export function fRange(start: string, end: string, lang: Lang): string {
  if (lang === 'es') return formatRange(start, end);
  const a = parseDate(start).setLocale(EN);
  const b = parseDate(end).setLocale(EN);
  if (a.month === b.month && a.year === b.year) return `${a.toFormat('LLL d')}–${b.day}`;
  return `${a.toFormat('LLL d')} – ${b.toFormat('LLL d')}`;
}

/** «4:00 p. m.» / «4:00 PM» desde 'HH:MM'. */
export function fTime(hm: string, lang: Lang): string {
  if (lang === 'es') return formatTime(hm);
  const [h, m] = hm.split(':').map(Number);
  return DateTime.fromObject({ hour: h, minute: m }).setLocale(EN).toFormat('h:mm a');
}

/** «Noviembre 2026» / «November 2026» desde 'AAAA-MM'. */
export function fMonth(key: string, lang: Lang): string {
  if (lang === 'es') return monthLabel(key);
  return parseDate(`${key}-01`).setLocale(EN).toFormat('LLLL yyyy');
}

/** Solo el nombre del mes: «noviembre» / «November». */
export function fMonthName(key: string, lang: Lang): string {
  return parseDate(`${key}-01`)
    .setLocale(lang === 'en' ? EN : 'es')
    .toFormat('LLLL');
}

/** Hora de un mensaje («3:05 p. m.» / «3:05 PM») en la zona del navegador. */
export function fClock(isoTimestamp: string, lang: Lang): string {
  return DateTime.fromISO(isoTimestamp)
    .setLocale(lang === 'en' ? EN : 'es')
    .toFormat('h:mm a');
}

/** Fecha y hora de un momento («3 nov, 2:05 p. m.» / «Nov 3, 2:05 PM») en la zona del navegador. */
export function fStamp(isoTimestamp: string, lang: Lang): string {
  const d = DateTime.fromISO(isoTimestamp);
  return `${fDate(d.toISODate()!, lang)}, ${fClock(isoTimestamp, lang)}`;
}

/** «hace 5 min» / «5 min ago». */
export function fAgo(isoTimestamp: string, now: DateTime, lang: Lang): string {
  if (lang === 'es') return timeAgo(isoTimestamp, now);
  const minutes = Math.round(now.diff(DateTime.fromISO(isoTimestamp), 'minutes').minutes);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Separador de días del chat: «Hoy», «Ayer» o la fecha. */
export function fChatDay(isoTimestamp: string, now: DateTime, lang: Lang): string {
  const day = DateTime.fromISO(isoTimestamp).toISODate()!;
  const today = now.toISODate()!;
  const d = diffDays(day, today);
  if (d === 0) return lang === 'en' ? 'Today' : 'Hoy';
  if (d === 1) return lang === 'en' ? 'Yesterday' : 'Ayer';
  return fDate(day, lang, { weekday: true, year: day.slice(0, 4) !== today.slice(0, 4) });
}

/** Primer nombre («Emily Carter» → «Emily»). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Link de Google Maps a unas coordenadas. */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
