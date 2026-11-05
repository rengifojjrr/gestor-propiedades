/** Textos y formatos de las pantallas de huéspedes y mensajes del equipo. */
import type { Lang } from '@/domain/types';
import type { Tone } from '@/ui';

export type Stage = 'active' | 'upcoming' | 'past';

export const STAGE_LABEL: Record<Stage, string> = { active: 'En casa', upcoming: 'Por llegar', past: 'Se fue' };
export const STAGE_TONE: Record<Stage, Tone> = { active: 'good', upcoming: 'info', past: 'neutral' };

export const LANG_LABEL: Record<Lang, string> = { es: 'Español', en: 'Inglés' };
export const SPEAKS: Record<Lang, string> = { es: 'Habla español', en: 'Habla inglés' };

/** «12 min», «1 h 05 min» o «—» si todavía no hay respuestas. */
export function formatWait(minutes: number): string {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 48) return `${Math.round(h / 24)} días`;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

/** Nombres cortos de las variables para las vistas previas («Hola [Nombre]…»). */
const SHORT: Record<string, string> = {
  guest_name: 'Nombre',
  property_name: 'Propiedad',
  city: 'Ciudad',
  check_in: 'Entrada',
  check_out: 'Salida',
  check_in_time: 'Hora de entrada',
  check_out_time: 'Hora de salida',
  amount: 'Monto',
  due_date: 'Fecha de pago',
  company: 'Empresa',
  app_link: 'Link de la app',
};

export function templatePreview(body: string): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => `[${SHORT[key] ?? key}]`);
}

/** «Recordatorio de salida» → «recordatorio-de-salida». */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length >= 2 ? slug : 'plantilla';
}

/** Quita el punto doble que queda al rellenar «{{check_in_time}}.» con una hora como «4:00 p. m.». */
export function tidyText(text: string): string {
  return text.replace(/([^.])\.\.(?!\.)/g, '$1.');
}
