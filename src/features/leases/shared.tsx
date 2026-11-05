/** Textos y tonos compartidos de Contratos: estados, libro de pagos, recargo y renovación. */
import type { LedgerStatus } from '@/domain/rules';
import type { Lease, Role } from '@/domain/types';
import { formatMoney, formatNumber } from '@/lib/money';
import type { LeaseView } from '@/services';
import type { Tone } from '@/ui';

/** Crear, renovar, terminar y registrar pagos: propietario y administración (contabilidad solo mira). */
export const canManageLeases = (role?: Role | null): boolean => role === 'owner' || role === 'admin';

export const LEASE_STATUS_LABEL: Record<Lease['status'], string> = {
  active: 'Activo',
  ended: 'Finalizado',
  terminated: 'Terminado',
};

export const LEASE_STATUS_TONE: Record<Lease['status'], Tone> = {
  active: 'good',
  ended: 'neutral',
  terminated: 'bad',
};

export const LEDGER_STATUS_LABEL: Record<LedgerStatus, string> = {
  paid: 'Pagado',
  paid_late: 'Pagado con atraso',
  due: 'Por pagar',
  overdue: 'Atrasado',
  upcoming: 'Próximo',
};

export const LEDGER_STATUS_TONE: Record<LedgerStatus, Tone> = {
  paid: 'good',
  paid_late: 'warn',
  due: 'info',
  overdue: 'bad',
  upcoming: 'neutral',
};

/** «5 % después de 3 días de gracia» o «$75 después de 5 días». */
export function lateFeeText(l: Pick<Lease, 'lateFee' | 'currency'>): string {
  const { kind, value, graceDays } = l.lateFee;
  if (value <= 0) return 'Sin recargo por atraso';
  if (kind === 'percent') {
    const pct = `${formatNumber(value, 2)} %`;
    return graceDays > 0 ? `${pct} después de ${graceDays} ${graceDays === 1 ? 'día' : 'días'} de gracia` : `${pct} si se paga después del vencimiento`;
  }
  const amount = formatMoney(value, l.currency);
  return graceDays > 0 ? `${amount} después de ${graceDays} ${graceDays === 1 ? 'día' : 'días'}` : `${amount} si se paga después del vencimiento`;
}

export const dueDayText = (day: number): string => `El ${day} de cada mes`;

/** «$2,800 + $140 de recargo» (o «$2,800 + $140» en corto, para las insignias). */
export function overdueText(l: Pick<LeaseView, 'overdue' | 'currency'>, short = false): string {
  const base = formatMoney(l.overdue.amount, l.currency);
  if (l.overdue.lateFees <= 0) return base;
  return `${base} + ${formatMoney(l.overdue.lateFees, l.currency)}${short ? '' : ' de recargo'}`;
}

export const renewalText = (daysToEnd: number): string =>
  daysToEnd === 0 ? 'Renovación: termina hoy' : `Renovación: termina en ${daysToEnd} ${daysToEnd === 1 ? 'día' : 'días'}`;
