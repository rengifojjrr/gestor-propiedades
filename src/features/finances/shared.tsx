/**
 * Piezas compartidas de Finanzas: mes elegido (en la URL), selector de mes, permisos de la pantalla,
 * estado y monto de un movimiento. Aquí nunca se mueve dinero: todo es «registrado».
 */
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useActor } from '@/app/session';
import { PAYMENT_METHOD_LABEL } from '@/domain/labels';
import type { Transaction } from '@/domain/types';
import { formatDate, lastMonths, monthLabel } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { svc, type TransactionView } from '@/services';
import { Badge, cn, Select, type Tone } from '@/ui';

const MONTH_RE = /^\d{4}-\d{2}$/;

/** Los últimos 12 meses, del más nuevo al más viejo. */
export function monthOptions(count = 12): { value: string; label: string }[] {
  const current = svc.finance.currentMonth();
  return lastMonths(current, count)
    .reverse()
    .map((m) => ({ value: m, label: monthLabel(m) }));
}

/**
 * Mes elegido, guardado en la URL (?mes=AAAA-MM) para que Finanzas, Movimientos y el Estado de
 * cuenta hablen del mismo mes. `allowAll` acepta «todos» (?mes=todos).
 */
export function useMonthParam(allowAll = false): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('mes');
  const current = svc.finance.currentMonth();
  // Solo los 12 meses del selector (o «todos» donde se permite); cualquier otra cosa vuelve al mes en curso.
  const oldest = lastMonths(current, 12)[0];
  const valid = !!raw && ((MONTH_RE.test(raw) && raw >= oldest && raw <= current) || (allowAll && raw === 'todos'));
  const month = valid && raw ? raw : current;
  const setMonth = useCallback(
    (m: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (m === current) next.delete('mes');
          else next.set('mes', m);
          return next;
        },
        { replace: true },
      ),
    [current, setParams],
  );
  return [month, setMonth];
}

export function MonthSelect({ value, onChange, allowAll = false, className }: { value: string; onChange: (m: string) => void; allowAll?: boolean; className?: string }) {
  const options = monthOptions();
  return (
    <div className={className ?? 'w-full sm:w-56'}>
      <Select
        aria-label="Mes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={allowAll ? [...options, { value: 'todos', label: 'Todos los meses' }] : options}
        className="font-semibold text-primary"
      />
    </div>
  );
}

/** Qué puede hacer quien mira (los servicios lo vuelven a verificar). */
export function useFinancePerms() {
  const actor = useActor();
  const role = actor.user.role;
  const team = role === 'owner' || role === 'admin';
  return {
    role,
    isOwner: role === 'owner',
    /** Registrar y anular (propietario y administración, nunca en «Ver como…»). */
    canWrite: team && !actor.readOnly,
    /** Aprobar gastos (solo el propietario). */
    canApprove: role === 'owner' && !actor.readOnly,
  };
}

export const TX_STATUS: Record<Transaction['status'], { label: string; tone: Tone }> = {
  posted: { label: 'Registrado', tone: 'good' },
  pending_approval: { label: 'Por aprobar', tone: 'warn' },
  void: { label: 'Anulado', tone: 'neutral' },
};

export const TX_SOURCE_LABEL: Record<Transaction['source']['kind'], string> = {
  booking: 'Reserva',
  lease_payment: 'Pago de renta',
  cleaning: 'Limpieza',
  maintenance: 'Mantenimiento',
  manual: 'Registrado a mano',
  recurring: 'Fijo mensual',
};

export function TxStatusBadge({ status }: { status: Transaction['status'] }) {
  return <Badge tone={TX_STATUS[status].tone}>{TX_STATUS[status].label}</Badge>;
}

/** Monto con signo, color (verde ingreso, rojo gasto) y su moneda; debajo, el equivalente en la base si es otra. */
export function TxAmount({ tx, base, className }: { tx: Pick<TransactionView, 'type' | 'amount' | 'currency' | 'amountBase'>; base?: string; className?: string }) {
  const income = tx.type === 'income';
  return (
    <span className={cn('flex flex-col items-end', className)}>
      <span className={cn('tabular text-label-md whitespace-nowrap', income ? 'text-secondary' : 'text-error')}>
        {income ? '+' : '−'}
        {formatMoney(tx.amount, tx.currency)}
      </span>
      {base && tx.currency !== base && (
        <span className="tabular text-label-sm font-normal whitespace-nowrap text-on-surface-variant">≈ {formatMoney(tx.amountBase, base)}</span>
      )}
    </span>
  );
}

export function TxIcon({ type }: { type: Transaction['type'] }) {
  const income = type === 'income';
  const Icon = income ? ArrowDownLeft : ArrowUpRight;
  return (
    <span
      className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', income ? 'bg-secondary/10 text-secondary' : 'bg-error/10 text-error')}
      aria-label={income ? 'Ingreso' : 'Gasto'}
      role="img"
    >
      <Icon size={18} aria-hidden />
    </span>
  );
}

/** «Transferencia · TR-2026». */
export function methodText(tx: Pick<Transaction, 'method' | 'reference'>): string {
  return [tx.method ? PAYMENT_METHOD_LABEL[tx.method] : null, tx.reference || null].filter(Boolean).join(' · ');
}

/** Fila compacta de un movimiento (lista del teléfono y «Últimos movimientos»). Con `onOpen`, toda la fila abre el detalle. */
export function TxRow({ tx, base, actions, onOpen }: { tx: TransactionView; base?: string; actions?: ReactNode; onOpen?: (tx: TransactionView) => void }) {
  const method = methodText(tx);
  const body = (
    <>
      <TxIcon type={tx.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label-md text-primary">{tx.description}</span>
        <span className="block truncate text-body-sm text-on-surface-variant">
          {tx.propertyName} · {tx.categoryLabel}
        </span>
        <span className="block truncate text-label-sm font-normal text-on-surface-variant">
          {formatDate(tx.date)}
          {method && ` · ${method}`}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <TxAmount tx={tx} base={base} />
        {tx.status !== 'posted' && <TxStatusBadge status={tx.status} />}
      </span>
    </>
  );
  return (
    <li>
      {onOpen ? (
        <button type="button" onClick={() => onOpen(tx)} className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-md px-2 py-3 text-left transition-colors hover:bg-surface-low">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 py-3">{body}</div>
      )}
      {actions && !onOpen && <div className="-mt-1 flex flex-wrap gap-2 pb-3 pl-13">{actions}</div>}
    </li>
  );
}

/** Cambio relativo contra el mes anterior (null si no hay base para comparar). */
export function relativeChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / Math.abs(previous);
}
