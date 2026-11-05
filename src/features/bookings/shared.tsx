/** Piezas compartidas de Reservas: permisos de pantalla, canal, tonos de las barras, totales y desglose del pago. */
import type { ReactNode } from 'react';
import { CHANNEL_LABEL } from '@/domain/labels';
import { rangesOverlap } from '@/domain/rules';
import type { Block, BookingStatus, Channel, Role } from '@/domain/types';
import { addDays, diffDays } from '@/lib/dates';
import { formatMoney, formatPercent, round2 } from '@/lib/money';
import type { CalendarData } from '@/services';
import { Badge, cn, Money } from '@/ui';

/** Crear, cancelar, registrar entradas y salidas, bloquear e importar: propietario y administración. */
export const canManageBookings = (role?: Role | null): boolean => role === 'owner' || role === 'admin';

/** Atención al cliente no ve finanzas: los montos solo para propietario y administración. */
export const seesBookingMoney = (role?: Role | null): boolean => role === 'owner' || role === 'admin';

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

/** Botón con borde y texto rojo (acciones que deshacen algo: cancelar, terminar). */
export const DANGER_OUTLINE =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-outline-variant bg-surface-lowest px-5 text-label-md font-semibold whitespace-nowrap text-error transition-colors hover:bg-error-container disabled:opacity-50';

export const BLOCK_REASON_LABEL: Record<Block['reason'], string> = {
  owner: 'Uso del propietario',
  maintenance: 'Mantenimiento',
  other: 'Bloqueo',
};

export const CHANNEL_OPTIONS = (['direct', 'airbnb', 'booking', 'vrbo'] as const).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }));

export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  return (
    <Badge tone={channel === 'direct' ? 'info' : 'neutral'} className={className}>
      {CHANNEL_LABEL[channel]}
    </Badge>
  );
}

/** Color de una reserva en la línea de tiempo y en el mes. */
export function bookingBarClass(b: { status: BookingStatus; needsDetails: boolean }): string {
  if (b.needsDetails && b.status === 'confirmed') return 'bg-warning-container text-on-warning-container';
  switch (b.status) {
    case 'in_progress':
      return 'bg-secondary text-on-secondary';
    case 'confirmed':
      return 'bg-primary text-on-primary';
    case 'completed':
      return 'bg-surface-high text-on-surface-variant';
    default:
      return 'bg-error-container text-on-error-container';
  }
}

export const BLOCK_BAR_CLASS = 'border border-dashed border-outline bg-surface-container text-on-surface-variant';
export const LEASE_BAR_CLASS = 'bg-info-container text-on-info-container';

/** Leyenda de colores del calendario de ocupación. */
export function OccupancyLegend({ className }: { className?: string }) {
  const items: { label: string; cls: string }[] = [
    { label: 'En curso', cls: 'bg-secondary' },
    { label: 'Confirmada', cls: 'bg-primary' },
    { label: 'Terminada', cls: 'bg-surface-high' },
    { label: 'Por completar (.ics)', cls: 'bg-warning-container' },
    { label: 'Bloqueo', cls: BLOCK_BAR_CLASS },
    { label: 'Contrato', cls: LEASE_BAR_CLASS },
  ];
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-2 text-label-sm text-on-surface-variant', className)} aria-label="Leyenda">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className={cn('h-3 w-5 rounded-sm', i.cls)} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Suma montos agrupando por moneda (nunca se suman monedas distintas). */
export function sumByCurrency(items: { amount: number; currency: string }[]): { amount: number; currency: string }[] {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.currency, (map.get(i.currency) ?? 0) + i.amount);
  return [...map.entries()].map(([currency, amount]) => ({ currency, amount: round2(amount) }));
}

/** Totales por moneda: «$3,750» o «$3,750 + €900». */
export function MoneyTotals({ totals, fallbackCurrency = 'USD', className }: { totals: { amount: number; currency: string }[]; fallbackCurrency?: string; className?: string }) {
  if (!totals.length) return <Money amount={0} currency={fallbackCurrency} className={className} />;
  return (
    <span className={className}>
      {totals.map((t, i) => (
        <span key={t.currency}>
          {i > 0 && ' + '}
          <Money amount={t.amount} currency={t.currency} whole />
        </span>
      ))}
    </span>
  );
}

export interface MoneyLines {
  nightlyRate: number;
  nights: number;
  cleaningFee: number;
  commission: number;
  taxes: number;
  taxRemittedByChannel: boolean;
  netPayout: number;
  currency: string;
  channel: Channel;
}

function Line({ label, value, hint, strong }: { label: ReactNode; value: ReactNode; hint?: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-2.5', strong ? 'border-t border-outline-variant pt-3' : 'border-b border-outline-variant/40')}>
      <dt className="min-w-0">
        <span className={cn(strong ? 'text-label-md text-primary' : 'text-body-sm text-on-surface-variant')}>{label}</span>
        {hint && <span className="block text-label-sm font-normal text-on-surface-variant">{hint}</span>}
      </dt>
      <dd className={cn('shrink-0 text-right', strong ? 'text-headline-md font-bold' : 'text-label-md text-on-surface')}>{value}</dd>
    </div>
  );
}

/** Desglose del pago: tarifa × noches, limpieza, impuestos, comisión del canal y pago neto. */
export function MoneyBreakdown({ m, taxRate }: { m: MoneyLines; taxRate?: number }) {
  const accommodation = round2(m.nightlyRate * m.nights);
  const base = accommodation + m.cleaningFee;
  const pct = base > 0 ? m.commission / base : 0;
  const rate = taxRate ?? (base > 0 ? m.taxes / base : 0);
  return (
    <dl>
      <Line
        label={`${formatMoney(m.nightlyRate, m.currency)} × ${m.nights} ${m.nights === 1 ? 'noche' : 'noches'}`}
        value={<Money amount={accommodation} currency={m.currency} />}
      />
      <Line label="Limpieza" value={<Money amount={m.cleaningFee} currency={m.currency} />} />
      <Line
        label={`Impuestos de hospedaje (${formatPercent(rate, 1)})`}
        value={m.taxRemittedByChannel ? <span className="text-body-sm text-on-surface-variant">Los paga el canal</span> : <Money amount={m.taxes} currency={m.currency} />}
        hint={
          m.taxRemittedByChannel
            ? `${CHANNEL_LABEL[m.channel]} los cobra y los paga: no pasan por ti (${formatMoney(m.taxes, m.currency)}).`
            : m.taxes > 0
              ? 'Los cobras con la reserva y luego se pagan como gasto.'
              : undefined
        }
      />
      <Line
        label={m.commission > 0 ? `Comisión de ${CHANNEL_LABEL[m.channel]} (${formatPercent(pct, 1)})` : 'Comisión del canal'}
        value={m.commission > 0 ? <Money amount={-m.commission} currency={m.currency} tone="expense" /> : <span className="text-body-sm text-on-surface-variant">Sin comisión</span>}
      />
      <Line label="Pago neto" value={<Money amount={m.netPayout} currency={m.currency} tone="income" />} strong />
    </dl>
  );
}

/** Lo que ocupa una propiedad en un rango, para detectar cruces y buscar fechas libres. */
export function occupiedRanges(data: CalendarData | undefined | null, propertyId: string): { start: string; end: string; label: string }[] {
  if (!data) return [];
  return [
    ...data.bookings
      .filter((b) => b.propertyId === propertyId && b.status !== 'cancelled')
      .map((b) => ({ start: b.checkIn, end: b.checkOut, label: `la reserva ${b.code} de ${b.guestName}` })),
    ...data.blocks.filter((b) => b.propertyId === propertyId).map((b) => ({ start: b.start, end: b.end, label: `un bloqueo (${BLOCK_REASON_LABEL[b.reason].toLowerCase()})` })),
    ...data.leases.filter((l) => l.propertyId === propertyId).map((l) => ({ start: l.start, end: addDays(l.end, 1), label: `el contrato ${l.code} de ${l.tenantName}` })),
  ].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Busca ventanas libres seguidas (una por largo pedido) desde `from`, dejando `gap` días entre ellas.
 * Sirve para proponer fechas en el formulario y para el .ics de ejemplo.
 */
export function findFreeWindows(occupied: { start: string; end: string }[], from: string, lengths: number[], gap = 2, horizonDays = 180): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cursor = from;
  const limit = addDays(from, horizonDays);
  for (const len of lengths) {
    let found: { start: string; end: string } | null = null;
    while (cursor < limit) {
      const end = addDays(cursor, len);
      const clash = occupied.find((o) => rangesOverlap(cursor, end, o.start, o.end));
      if (!clash) {
        found = { start: cursor, end };
        break;
      }
      cursor = diffDays(cursor, clash.end) > 0 ? clash.end : addDays(cursor, 1);
    }
    if (!found) break;
    out.push(found);
    cursor = addDays(found.end, gap);
  }
  return out;
}
