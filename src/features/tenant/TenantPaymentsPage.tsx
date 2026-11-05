/**
 * Pagos del inquilino: libro de su contrato mes por mes (vence, estado, renta, recargo, pagado el,
 * método y referencia). Solo se registran: la app no cobra.
 */
import { CircleCheck, TriangleAlert, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useActor } from '@/app/session';
import { useLiveResult } from '@/data/live';
import type { LedgerRow, LedgerStatus } from '@/domain/rules';
import type { Lang } from '@/domain/types';
import { fDate, fMonth } from '@/features/guest/format';
import { COMMON, makeT } from '@/features/guest/i18n';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { svc, type LeaseView } from '@/services';
import { Badge, Card, EmptyState, ErrorState, Loading, Money, type Tone } from '@/ui';
import { ledgerKey, methodKey, TENANT } from './i18n';

const TONE: Record<LedgerStatus, Tone> = { paid: 'good', paid_late: 'warn', due: 'warn', overdue: 'bad', upcoming: 'info' };

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-sm text-on-surface-variant">{label}</dt>
      <dd className="text-body-md break-words text-on-surface">{children}</dd>
    </div>
  );
}

function RowCard({ row, lease, lang }: { row: LedgerRow; lease: LeaseView; lang: Lang }) {
  const t = makeT(TENANT, lang);
  const p = row.payment;
  return (
    <Card padding="md" accent={row.status === 'overdue' ? 'bad' : undefined} as="article" aria-label={fMonth(row.period, lang)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-headline-md text-primary">{fMonth(row.period, lang)}</h2>
        <Badge tone={TONE[row.status]}>{t(ledgerKey(row.status))}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Cell label={t('dueDate')}>{fDate(row.dueDate, lang, { year: true })}</Cell>
        <Cell label={t('rent')}>
          <Money amount={p?.amount ?? row.rent} currency={lease.currency} className="font-semibold" />
        </Cell>
        {row.lateFee > 0 && (
          <Cell label={t('lateFee')}>
            <Money amount={row.lateFee} currency={lease.currency} className="font-semibold text-error" />
          </Cell>
        )}
        {p && <Cell label={t('paidOn')}>{fDate(p.paidOn, lang, { year: true })}</Cell>}
        {p && <Cell label={t('method')}>{t(methodKey(p.method))}</Cell>}
        {p?.reference && <Cell label={t('reference')}>{p.reference}</Cell>}
      </dl>
      {row.status === 'overdue' && (
        <p className="mt-3 flex items-center gap-1.5 text-label-md text-error">
          <TriangleAlert size={16} aria-hidden />
          {t('daysLate', { n: row.daysLate })}
        </p>
      )}
    </Card>
  );
}

function LedgerTable({ rows, lease, lang }: { rows: LedgerRow[]; lease: LeaseView; lang: Lang }) {
  const t = makeT(TENANT, lang);
  return (
    <Card padding="none" className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-body-sm">
        <thead className="border-b border-outline-variant/60 text-label-sm text-on-surface-variant uppercase">
          <tr>
            <th scope="col" className="px-4 py-3">
              {t('month')}
            </th>
            <th scope="col" className="px-2.5 py-3">
              {t('dueDate')}
            </th>
            <th scope="col" className="px-2.5 py-3">
              {t('status')}
            </th>
            <th scope="col" className="px-2.5 py-3 text-right">
              {t('rent')}
            </th>
            <th scope="col" className="px-2.5 py-3 text-right">
              {t('lateFeeShort')}
            </th>
            <th scope="col" className="px-4 py-3">
              {t('payment')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period} className="border-b border-outline-variant/40 align-top last:border-b-0">
              <th scope="row" className="px-4 py-3 text-label-md whitespace-nowrap text-primary">
                {fMonth(r.period, lang)}
              </th>
              <td className="px-2.5 py-3 whitespace-nowrap">{fDate(r.dueDate, lang)}</td>
              <td className="px-2.5 py-3">
                <Badge tone={TONE[r.status]}>{t(ledgerKey(r.status))}</Badge>
                {r.status === 'overdue' && <span className="mt-1 block text-label-sm whitespace-nowrap text-error">{t('daysLate', { n: r.daysLate })}</span>}
              </td>
              <td className="px-2.5 py-3 text-right whitespace-nowrap">
                <Money amount={r.payment?.amount ?? r.rent} currency={lease.currency} />
              </td>
              <td className="px-2.5 py-3 text-right whitespace-nowrap">{r.lateFee > 0 ? <Money amount={r.lateFee} currency={lease.currency} className="text-error" /> : '—'}</td>
              <td className="px-4 py-3">
                {r.payment ? (
                  <>
                    <span className="block whitespace-nowrap text-on-surface">
                      {fDate(r.payment.paidOn, lang)} · {t(methodKey(r.payment.method))}
                    </span>
                    {r.payment.reference && <span className="block text-label-sm font-normal break-all text-on-surface-variant">{r.payment.reference}</span>}
                  </>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function TenantPaymentsPage() {
  const actor = useActor();
  const res = useLiveResult(() => svc.leases.tenantHome(actor), [actor]);
  const home = res.data;
  const [lang] = useLang(home?.person.language ?? 'es');
  const t = makeT(TENANT, lang);
  const tc = makeT(COMMON, lang);
  if (!home) return res.error ? <ErrorState error={tc('loadError')} /> : <Loading label={tc('loading')} />;
  const lease = home.lease;
  const rows = lease ? [...lease.ledger].reverse() : [];
  const balance = lease ? lease.overdue.amount + lease.overdue.lateFees : 0;
  const paidCount = home.payments.length;

  return (
    <div className="space-y-5" lang={lang}>
      <header>
        <h1 className="text-headline-lg text-primary md:text-headline-xl">{t('paymentsTitle')}</h1>
        <p className="mt-1 text-body-lg text-on-surface-variant">{t('paymentsSubtitle')}</p>
      </header>

      {!lease ? (
        <EmptyState icon={Wallet} title={t('noLeaseTitle')} body={t('noLeaseBody')} />
      ) : (
        <>
          <Card padding="lg" accent={balance > 0 ? 'bad' : 'good'} data-testid="saldo">
            <p className="text-label-md text-on-surface-variant uppercase">{t('balanceTitle')}</p>
            {balance > 0 ? (
              <>
                <p className="mt-1 text-headline-xl text-error tabular">{formatMoney(balance, lease.currency)}</p>
                <p className="text-body-md text-on-surface">
                  {t('rent')} <Money amount={lease.overdue.amount} currency={lease.currency} /> + {t('lateFee').toLowerCase()}{' '}
                  <Money amount={lease.overdue.lateFees} currency={lease.currency} className="text-error" />
                </p>
              </>
            ) : (
              <p className="mt-1 flex items-center gap-2 text-headline-lg text-secondary">
                <CircleCheck size={26} aria-hidden />
                {t('upToDate')}
              </p>
            )}
            <p className="mt-2 text-body-sm text-on-surface-variant">{paidCount === 1 ? t('recorded_one') : t('recorded_other', { n: paidCount })}</p>
            <p className="mt-4 flex items-start gap-2 rounded-md bg-surface-low px-4 py-3 text-body-md text-on-surface">
              <Wallet size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
              {t('payNote')}
            </p>
          </Card>

          {!rows.length ? (
            <p className="text-body-md text-on-surface-variant">{t('noRows')}</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {rows.map((r) => (
                  <RowCard key={r.period} row={r} lease={lease} lang={lang} />
                ))}
              </div>
              <LedgerTable rows={rows} lease={lease} lang={lang} />
            </>
          )}
        </>
      )}
    </div>
  );
}
