/** Cuadrícula de mes (semanas de lunes a domingo), compartida por el calendario y la vista «Mes» de reservas. */
import { addDays, monthEndExclusive, monthStart, parseDate } from '@/lib/dates';

/** Iniciales de los días (la semana empieza el lunes). */
export const WEEKDAY_INITIALS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'] as const;
export const WEEKDAY_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'] as const;

/** 0 = lunes … 6 = domingo. */
export function weekdayIndex(iso: string): number {
  return parseDate(iso).weekday - 1;
}

export function isWeekend(iso: string): boolean {
  return weekdayIndex(iso) >= 5;
}

/** Semanas completas (lunes a domingo) que cubren el mes `key` (AAAA-MM). */
export function monthWeeks(key: string): string[][] {
  const first = monthStart(key);
  const end = monthEndExclusive(key);
  let cursor = addDays(first, -weekdayIndex(first));
  const weeks: string[][] = [];
  while (cursor < end) {
    const weekStart = cursor;
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

/** Rango [inicio, fin) que cubre la cuadrícula del mes. */
export function gridRange(weeks: string[][]): { from: string; to: string } {
  const last = weeks[weeks.length - 1];
  return { from: weeks[0][0], to: addDays(last[6], 1) };
}

/** ¿Se puede usar la vista de computadora? (lee el ancho al abrir la pantalla). */
export function isWideScreen(minWidth = 1024): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(`(min-width: ${minWidth}px)`).matches;
}
