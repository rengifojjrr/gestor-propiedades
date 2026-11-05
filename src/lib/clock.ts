/**
 * Reloj de la app. Todo lo que depende de «hoy» pasa por aquí, para que las pruebas
 * puedan fijar la fecha (clock.set) y para respetar la zona horaria de cada propiedad.
 */
import { DateTime } from 'luxon';

let nowFn: () => DateTime = () => DateTime.now();

export const clock = {
  now: (): DateTime => nowFn(),
  set(fn: () => DateTime): void {
    nowFn = fn;
  },
  /** Fija una fecha y hora (ISO) para pruebas. */
  setFixed(iso: string, zone = 'America/New_York'): void {
    const fixed = DateTime.fromISO(iso, { zone });
    nowFn = () => fixed;
  },
  reset(): void {
    nowFn = () => DateTime.now();
  },
};

/** Marca de tiempo ISO (UTC) para createdAt, at, etc. */
export function nowIso(): string {
  return clock.now().toUTC().toISO() ?? new Date().toISOString();
}

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria dada. */
export function todayIn(timezone: string): string {
  return clock.now().setZone(timezone).toISODate() ?? clock.now().toISODate()!;
}

/** Hora actual (HH:MM) en la zona horaria dada. */
export function timeIn(timezone: string): string {
  return clock.now().setZone(timezone).toFormat('HH:mm');
}

/** Fecha de hoy en la zona del navegador. */
export function todayLocal(): string {
  return clock.now().toISODate()!;
}
