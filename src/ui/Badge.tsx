import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  BOOKING_STATUS_LABEL,
  CLEANING_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  PRIORITY_LABEL,
  PROPERTY_STATUS_LABEL,
} from '@/domain/labels';
import type { BookingStatus, CleaningStatus, OrderStatus, Priority, PropertyStatus } from '@/domain/types';
import { cn } from './cn';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'dark' | 'mint';

const TONE: Record<Tone, string> = {
  good: 'bg-secondary-container text-on-secondary-container',
  mint: 'bg-secondary-container text-on-secondary-container',
  warn: 'bg-warning-container text-on-warning-container',
  bad: 'bg-error-container text-on-error-container',
  info: 'bg-info-container text-on-info-container',
  neutral: 'bg-surface-container text-on-surface-variant',
  dark: 'bg-primary text-on-primary',
};

/** Chip de estado (píldora con fondo suave y texto de alto contraste). */
export function Badge({ tone = 'neutral', icon: Icon, children, className, upper }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string; upper?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-label-sm whitespace-nowrap',
        upper && 'uppercase',
        TONE[tone],
        className,
      )}
    >
      {Icon && <Icon size={12} aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

export const PROPERTY_STATUS_TONE: Record<PropertyStatus, Tone> = { occupied: 'good', vacant: 'info', maintenance: 'bad', blocked: 'neutral' };
export const BOOKING_STATUS_TONE: Record<BookingStatus, Tone> = { confirmed: 'info', in_progress: 'good', completed: 'neutral', cancelled: 'bad' };
export const PRIORITY_TONE: Record<Priority, Tone> = { urgent: 'bad', high: 'warn', medium: 'info', low: 'neutral' };
export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = { open: 'warn', scheduled: 'info', in_progress: 'info', resolved: 'good', cancelled: 'neutral' };
export const CLEANING_STATUS_TONE: Record<CleaningStatus, Tone> = { pending: 'warn', in_progress: 'info', done: 'good', cancelled: 'neutral' };

export const PropertyStatusBadge = ({ status }: { status: PropertyStatus }) => <Badge tone={PROPERTY_STATUS_TONE[status]}>{PROPERTY_STATUS_LABEL[status]}</Badge>;
export const BookingStatusBadge = ({ status }: { status: BookingStatus }) => <Badge tone={BOOKING_STATUS_TONE[status]}>{BOOKING_STATUS_LABEL[status]}</Badge>;
export const PriorityBadge = ({ priority }: { priority: Priority }) => <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
export const OrderStatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
export const CleaningStatusBadge = ({ status }: { status: CleaningStatus }) => <Badge tone={CLEANING_STATUS_TONE[status]}>{CLEANING_STATUS_LABEL[status]}</Badge>;
