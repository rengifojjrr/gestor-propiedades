/** Libro de pagos del contrato: un renglón por mes (el más reciente arriba). */
import { PAYMENT_METHOD_LABEL } from '@/domain/labels';
import type { LedgerRow } from '@/domain/rules';
import { formatDate, monthLabel } from '@/lib/dates';
import { Badge, Button, cn, Money } from '@/ui';
import { LEDGER_STATUS_LABEL, LEDGER_STATUS_TONE } from './shared';

export function LeaseLedger({ rows, currency, onPay }: { rows: LedgerRow[]; currency: string; onPay?: (period: string) => void }) {
  const list = [...rows].reverse();
  const fee = (r: LedgerRow) => (r.lateFee > 0 ? <Money amount={r.lateFee} currency={currency} tone={r.status === 'overdue' ? 'expense' : undefined} /> : <span className="text-on-surface-variant">—</span>);
  const canPay = (r: LedgerRow) => !!onPay && !r.payment && (r.status === 'overdue' || r.status === 'due' || r.status === 'upcoming');

  return (
    <>
      {/* Teléfono: renglones apilados */}
      <ul className="divide-y divide-outline-variant/60 md:hidden">
        {list.map((r) => (
          <li key={r.period} className={cn('py-3', r.status === 'overdue' && '-mx-4 bg-error-container/40 px-4')}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-label-md text-primary">{monthLabel(r.period)}</p>
              <Badge tone={LEDGER_STATUS_TONE[r.status]}>{LEDGER_STATUS_LABEL[r.status]}</Badge>
            </div>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              Vence {formatDate(r.dueDate)} · <Money amount={r.payment?.amount ?? r.rent} currency={currency} className="text-on-surface" />
              {r.lateFee > 0 && (
                <>
                  {' '}
                  + recargo <Money amount={r.lateFee} currency={currency} className={r.status === 'overdue' ? 'text-error' : 'text-on-surface'} />
                </>
              )}
              {r.status === 'overdue' && ` · ${r.daysLate} días de atraso`}
            </p>
            {r.payment && (
              <p className="text-body-sm text-on-surface-variant">
                Pagado el {formatDate(r.payment.paidOn)} · {PAYMENT_METHOD_LABEL[r.payment.method]}
                {r.payment.reference ? ` · ${r.payment.reference}` : ''}
              </p>
            )}
            {canPay(r) && (
              <Button size="sm" variant={r.status === 'overdue' ? 'danger' : 'secondary'} className="mt-2" onClick={() => onPay?.(r.period)}>
                Registrar pago
              </Button>
            )}
          </li>
        ))}
      </ul>

      {/* Tableta y computadora: tabla */}
      <div className="-mx-4 hidden overflow-x-auto md:mx-0 md:block">
        <table className="w-full border-collapse text-left">
          <thead className="bg-surface-low text-on-surface-variant">
            <tr>
              <th scope="col" className="px-3 py-2.5 whitespace-nowrap text-label-md">Mes</th>
              <th scope="col" className="px-3 py-2.5 whitespace-nowrap text-label-md">Vence</th>
              <th scope="col" className="px-3 py-2.5 whitespace-nowrap text-right text-label-md">Renta</th>
              <th scope="col" className="px-3 py-2.5 whitespace-nowrap text-label-md">Estado</th>
              <th scope="col" className="px-3 py-2.5 whitespace-nowrap text-right text-label-md">Recargo</th>
              <th scope="col" className="px-3 py-2.5 whitespace-nowrap text-label-md">Pagado el</th>
              <th scope="col" className="px-3 py-2.5 whitespace-nowrap text-label-md">Método</th>
              <th scope="col" className="px-3 py-2.5 whitespace-nowrap text-label-md">Referencia</th>
              {onPay && (
                <th scope="col" className="px-3 py-2.5">
                  <span className="sr-only">Acciones</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/60 text-body-sm">
            {list.map((r) => (
              <tr key={r.period} className={cn(r.status === 'overdue' && 'bg-error-container/40')}>
                <td className="px-3 py-3 text-label-md whitespace-nowrap text-primary">{monthLabel(r.period)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-on-surface-variant">{formatDate(r.dueDate)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  <Money amount={r.payment?.amount ?? r.rent} currency={currency} />
                </td>
                <td className="px-3 py-3">
                  <Badge tone={LEDGER_STATUS_TONE[r.status]}>{LEDGER_STATUS_LABEL[r.status]}</Badge>
                  {r.status === 'overdue' && <span className="mt-1 block text-label-sm text-error">{r.daysLate} días</span>}
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap">{fee(r)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-on-surface-variant">{r.payment ? formatDate(r.payment.paidOn) : '—'}</td>
                <td className="px-3 py-3 whitespace-nowrap text-on-surface-variant">{r.payment ? PAYMENT_METHOD_LABEL[r.payment.method] : '—'}</td>
                <td className="px-3 py-3 text-on-surface-variant">{r.payment?.reference || '—'}</td>
                {onPay && (
                  <td className="px-3 py-3 text-right">
                    {canPay(r) && (
                      <Button size="sm" variant={r.status === 'overdue' ? 'danger' : 'secondary'} onClick={() => onPay(r.period)}>
                        Registrar
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
