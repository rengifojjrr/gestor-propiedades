/** «Salud de la propiedad»: nota de 0 a 100, sus motivos y lo próximo (reserva, limpieza, mantenimiento). */
import { CircleAlert, CircleCheck } from 'lucide-react';
import type { HealthResult } from '@/domain/rules';
import { formatDate, relativeDay } from '@/lib/dates';
import type { PropertyOperations, PropertyView } from '@/services';
import { Card, cn } from '@/ui';
import { when, type Perms } from '../shared';

const BAR: Record<HealthResult['tone'], string> = {
  good: 'bg-secondary-container dark:bg-secondary',
  warn: 'bg-warning-strong',
  bad: 'bg-error-container dark:bg-error',
};

/** Texto «bueno» (menta) sobre la tarjeta marina, legible en modo claro y oscuro. */
const MINT = 'text-secondary-container dark:text-on-secondary-container';
const AMBER = 'text-warning-strong';

function Line({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-on-primary-container/10 py-2.5 last:border-b-0">
      <dt className="text-body-md text-on-primary-container-muted">{label}</dt>
      <dd className={cn('text-right text-label-md', tone === 'good' && MINT, tone === 'warn' && AMBER)}>{value}</dd>
    </div>
  );
}

export function HealthCard({
  property: p,
  health,
  ops,
  perms,
}: {
  property: PropertyView;
  health: HealthResult | null | undefined;
  ops: PropertyOperations | null | undefined;
  perms: Perms;
}) {
  const res = { propertyId: p.id };
  const today = p.today;
  const lines: { label: string; value: string; tone?: 'good' | 'warn' }[] = [];
  if (ops) {
    if (perms.allowed('booking.read', res) && p.rentalMode !== 'monthly') {
      const next = ops.nextBooking;
      lines.push(next ? { label: 'Próxima reserva', value: formatDate(next.checkIn), tone: 'good' } : { label: 'Próxima reserva', value: 'Sin reservas' });
    }
    if (perms.allowed('lease.read', res) && p.rentalMode !== 'nightly') {
      lines.push(ops.activeLease ? { label: 'Contrato', value: `Hasta ${formatDate(ops.activeLease.end, { year: true })}`, tone: 'good' } : { label: 'Contrato', value: 'Sin contrato activo' });
    }
    if (perms.allowed('cleaning.read', res)) {
      const pending = ops.pendingCleanings[0];
      const last = ops.lastCleaning?.completedAt?.slice(0, 10);
      lines.push(
        pending
          ? { label: 'Limpieza', value: pending.date < today ? `Atrasada (${formatDate(pending.date)})` : when(pending.date, today, pending.time), tone: pending.date < today ? 'warn' : undefined }
          : { label: 'Limpieza', value: last ? `Última: ${relativeDay(last, today).toLowerCase()}` : 'Sin pendientes', tone: 'good' },
      );
    }
    if (perms.allowed('maintenance.read', res)) {
      const n = ops.openOrders.length;
      lines.push(n ? { label: 'Mantenimiento', value: `${n} ${n === 1 ? 'orden abierta' : 'órdenes abiertas'}`, tone: 'warn' } : { label: 'Mantenimiento', value: 'Al día', tone: 'good' });
    }
  }

  return (
    <Card tone="dark" padding="lg" className="relative overflow-hidden" aria-label="Salud de la propiedad">
      <h2 className="text-headline-md">Salud de la propiedad</h2>
      {health === undefined ? (
        <div className="mt-4 h-24 animate-pulse rounded-md bg-on-primary-container/10" aria-hidden />
      ) : health === null ? (
        <p className="mt-2 text-body-sm text-on-primary-container-muted">No se pudo calcular la salud.</p>
      ) : (
        <>
          <div className="mt-4 flex items-end gap-3">
            <p className="tabular text-headline-xl leading-none" data-testid="salud-puntaje">
              {health.score}
              <span className="text-body-md text-on-primary-container-muted">/100</span>
            </p>
            <span className={cn('mb-1 text-label-md', health.tone === 'good' ? MINT : health.tone === 'warn' ? AMBER : 'text-error-container dark:text-on-error-container')}>
              {health.label}
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-on-primary-container/15" role="progressbar" aria-valuenow={health.score} aria-valuemin={0} aria-valuemax={100} aria-label="Nota de salud">
            <div className={cn('h-full rounded-full', BAR[health.tone])} style={{ width: `${health.score}%` }} />
          </div>
          <ul className="mt-4 space-y-1.5">
            {health.reasons.length === 0 ? (
              <li className="flex items-center gap-2 text-body-sm text-on-primary-container-muted">
                <CircleCheck size={16} className={MINT} aria-hidden /> Sin incidencias, atrasos ni documentos por vencer.
              </li>
            ) : (
              health.reasons.map((r) => (
                <li key={r} className="flex items-center gap-2 text-body-sm">
                  <CircleAlert size={16} className="shrink-0 text-warning-strong" aria-hidden /> {r.charAt(0).toUpperCase() + r.slice(1)}
                </li>
              ))
            )}
          </ul>
        </>
      )}
      {lines.length > 0 && (
        <dl className="mt-4 border-t border-on-primary-container/10 pt-1">
          {lines.map((l) => (
            <Line key={l.label} {...l} />
          ))}
        </dl>
      )}
    </Card>
  );
}
