/** Tipos de evento del calendario general: nombre, ícono y color (solo clases de tokens). */
import type { LucideIcon } from 'lucide-react';
import { FileWarning, FileX2, LogIn, LogOut, SprayCan, Wallet, Wrench } from 'lucide-react';
import type { CalendarEventKind } from '@/services';

export interface KindMeta {
  /** Plural, para los filtros («Entradas»). */
  label: string;
  icon: LucideIcon;
  /** Punto de color. */
  dot: string;
  /** Borde izquierdo del renglón de la agenda. */
  border: string;
  /** Para la celda del mes: [singular, plural]. */
  short: [string, string];
}

export const KIND_ORDER: CalendarEventKind[] = ['checkin', 'checkout', 'cleaning', 'maintenance', 'expiry', 'rent', 'lease_end'];

export const KIND_META: Record<CalendarEventKind, KindMeta> = {
  checkin: { label: 'Entradas', icon: LogIn, dot: 'bg-secondary', border: 'border-l-secondary', short: ['entrada', 'entradas'] },
  checkout: { label: 'Salidas', icon: LogOut, dot: 'bg-primary', border: 'border-l-primary', short: ['salida', 'salidas'] },
  cleaning: { label: 'Limpiezas', icon: SprayCan, dot: 'bg-secondary-container', border: 'border-l-secondary-container', short: ['limpieza', 'limpiezas'] },
  maintenance: { label: 'Mantenimiento', icon: Wrench, dot: 'bg-warning', border: 'border-l-warning', short: ['mantenim.', 'mantenim.'] },
  expiry: { label: 'Vencimientos', icon: FileWarning, dot: 'bg-error', border: 'border-l-error', short: ['vence', 'vencen'] },
  rent: { label: 'Pagos', icon: Wallet, dot: 'bg-warning-strong', border: 'border-l-warning-strong', short: ['renta', 'rentas'] },
  lease_end: { label: 'Fin de contrato', icon: FileX2, dot: 'bg-outline', border: 'border-l-outline', short: ['fin contrato', 'fin contratos'] },
};
