/**
 * Movimientos: todo lo registrado, con filtros (mes, propiedad, tipo, pendientes), exportación a CSV
 * y «Anular» (propietario y administración). Lista en el teléfono, tabla en la computadora.
 */
import { Ban, Check, Download, Filter, Receipt } from 'lucide-react';
import { useState } from 'react';
import { downloadFile, useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { svc, type TransactionView } from '@/services';
import { Button, Card, cn, EmptyState, ErrorState, Eyebrow, LinkButton, Loading, PageHeader, Select, Toggle, useConfirm } from '@/ui';
import { withMonth } from './FinanceSections';
import { methodText, MonthSelect, TX_SOURCE_LABEL, TxAmount, TxIcon, TxRow, TxStatusBadge, useFinancePerms, useMonthParam } from './shared';

const PAGE = 60;

export default function TransactionsPage() {
  const actor = useActor();
  const run = useAction();
  const confirm = useConfirm();
  const perms = useFinancePerms();
  const current = svc.finance.currentMonth();
  const [month, setMonth] = useMonthParam(true);
  const [propertyId, setPropertyId] = useState('');
  const [type, setType] = useState<'' | 'income' | 'expense'>('');
  const [includePending, setIncludePending] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const filter = { month: month === 'todos' ? undefined : month, propertyId: propertyId || undefined, type: type || undefined, includePending };
  const res = useLiveResult(() => svc.finance.listTransactions(actor, filter), [actor, month, propertyId, type, includePending]);
  const rows = res.data;
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const summary = useLive(() => svc.finance.monthSummary(actor, month === 'todos' ? current : month), [actor, month, current]);
  const base = summary?.baseCurrency ?? 'USD';

  const posted = rows?.filter((t) => t.status === 'posted') ?? [];
  const income = posted.filter((t) => t.type === 'income').reduce((s, t) => s + t.amountBase, 0);
  const expenses = posted.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amountBase, 0);
  const pendingCount = rows?.filter((t) => t.status === 'pending_approval').length ?? 0;

  const exportCsv = async () => {
    setExporting(true);
    const csv = await run(() => svc.finance.exportCsv(actor, { month: filter.month, propertyId: filter.propertyId, type: filter.type }), { success: 'CSV descargado.' });
    setExporting(false);
    if (csv) downloadFile(csv, `movimientos-${filter.month ?? 'todos'}.csv`, 'text/csv;charset=utf-8');
  };

  const voidTx = async (t: TransactionView) => {
    const ok = await confirm({
      title: '¿Anular este movimiento?',
      body: (
        <>
          «{t.description}» ({formatMoney(t.amount, t.currency)}) deja de sumar en las cuentas. No se borra: queda anulado y en la auditoría.
        </>
      ),
      confirmLabel: 'Anular',
      danger: true,
    });
    if (!ok) return;
    setBusyId(t.id);
    await run(() => svc.finance.voidTransaction(actor, t.id), { success: 'Movimiento anulado.' });
    setBusyId(null);
  };

  const approve = async (t: TransactionView) => {
    setBusyId(t.id);
    await run(() => svc.finance.approveTransaction(actor, t.id), { success: 'Gasto aprobado.' });
    setBusyId(null);
  };

  const actionsFor = (t: TransactionView) =>
    perms.canWrite ? (
      <>
        {perms.canApprove && t.status === 'pending_approval' && (
          <Button size="sm" variant="success" icon={Check} loading={busyId === t.id} onClick={() => approve(t)}>
            Aprobar
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={Ban} disabled={busyId === t.id} onClick={() => voidTx(t)} aria-label={`Anular «${t.description}»`}>
          Anular
        </Button>
      </>
    ) : null;

  const visible = rows?.slice(0, limit) ?? [];

  return (
    <div className="space-y-6" data-testid="movimientos">
      <PageHeader
        back="/finanzas"
        title="Movimientos"
        subtitle="Todo lo registrado: ingresos y gastos con su moneda. Nada se borra; lo anulado sale de las cuentas."
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={exportCsv} loading={exporting}>
              Exportar CSV
            </Button>
            {month !== 'todos' && (
              <LinkButton to={withMonth('/finanzas/estado-de-cuenta', month, current)} variant="secondary" icon={Receipt}>
                Estado de cuenta
              </LinkButton>
            )}
          </>
        }
      />

      <Card padding="md" as="section" aria-label="Filtros">
        <div className="mb-3 flex items-center gap-2 text-label-md text-primary">
          <Filter size={16} aria-hidden /> Filtros
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MonthSelect value={month} onChange={setMonth} allowAll className="w-full" />
          <Select
            aria-label="Propiedad"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            options={[{ value: '', label: 'Todas las propiedades' }, ...(properties ?? []).map((p) => ({ value: p.id, label: p.name }))]}
          />
          <Select
            aria-label="Tipo"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            options={[
              { value: '', label: 'Ingresos y gastos' },
              { value: 'income', label: 'Solo ingresos' },
              { value: 'expense', label: 'Solo gastos' },
            ]}
          />
          <div className="rounded-md border border-outline-variant bg-surface-lowest px-3">
            <Toggle checked={includePending} onChange={setIncludePending} label="Incluir por aprobar" />
          </div>
        </div>
      </Card>

      {res.error && !rows ? (
        <ErrorState error={res.error} />
      ) : !rows ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryTile label="Movimientos" value={String(rows.length)} />
            <SummaryTile label="Ingresos" value={formatMoney(income, base)} tone="income" />
            <SummaryTile label="Gastos" value={formatMoney(expenses, base)} tone="expense" />
            <SummaryTile label="Neto" value={formatMoney(income - expenses, base)} hint={pendingCount ? `${pendingCount} por aprobar (no suman)` : `en ${base}`} />
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={Receipt} title="No hay movimientos con estos filtros" body="Prueba con otro mes o con todas las propiedades." />
          ) : (
            <Card padding="none" className="overflow-hidden">
              {/* Teléfono */}
              <ul className="divide-y divide-outline-variant/50 px-4 lg:hidden">
                {visible.map((t) => (
                  <TxRow key={t.id} tx={t} base={base} actions={actionsFor(t)} />
                ))}
              </ul>
              {/* Computadora */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-left text-body-sm">
                  <thead className="bg-surface-low text-[12px] font-bold tracking-wider text-on-surface-variant uppercase">
                    <tr>
                      <th scope="col" className="py-3 pr-3 pl-5">
                        Fecha
                      </th>
                      <th scope="col" className="px-3 py-3">
                        Movimiento
                      </th>
                      <th scope="col" className="px-3 py-3">
                        Propiedad
                      </th>
                      <th scope="col" className="px-3 py-3 text-right">
                        Monto
                      </th>
                      <th scope="col" className="px-3 py-3">
                        Estado
                      </th>
                      <th scope="col" className="px-3 py-3">
                        Método / referencia
                      </th>
                      {perms.canWrite && (
                        <th scope="col" className="py-3 pr-5 pl-3 text-right">
                          <span className="sr-only">Acciones</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {visible.map((t) => (
                      <tr key={t.id} className="align-top transition-colors hover:bg-surface-low/60">
                        <td className="tabular py-3 pr-3 pl-5 whitespace-nowrap text-on-surface">{formatDate(t.date, { year: month === 'todos' })}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-start gap-3">
                            <TxIcon type={t.type} />
                            <div className="min-w-0">
                              <p className="max-w-64 truncate text-label-md text-primary" title={t.description}>
                                {t.description}
                              </p>
                              <p className="text-label-sm font-normal text-on-surface-variant">
                                {t.categoryLabel} · {TX_SOURCE_LABEL[t.source.kind]}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-on-surface">
                          <span className="block max-w-44 truncate" title={t.propertyName}>
                            {t.propertyName}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <TxAmount tx={t} base={base} />
                        </td>
                        <td className="px-3 py-3">
                          <TxStatusBadge status={t.status} />
                        </td>
                        <td className="px-3 py-3 text-on-surface-variant">
                          <span className="block max-w-40 truncate">{methodText(t) || '—'}</span>
                        </td>
                        {perms.canWrite && (
                          <td className="py-2 pr-5 pl-3">
                            <div className="flex justify-end gap-1">{actionsFor(t)}</div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > limit && (
                <div className="border-t border-outline-variant/40 p-3 text-center">
                  <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
                    Ver más ({rows.length - limit} restantes)
                  </Button>
                </div>
              )}
            </Card>
          )}
          <p className="text-body-sm text-on-surface-variant">
            Montos en la moneda de cada movimiento; cuando es otra, debajo va el equivalente en {base} con la tasa manual de su fecha.
          </p>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone, hint }: { label: string; value: string; tone?: 'income' | 'expense'; hint?: string }) {
  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 shadow-card">
      <Eyebrow>{label}</Eyebrow>
      <p className={cn('mt-1 truncate text-headline-md', tone === 'income' ? 'text-secondary' : tone === 'expense' ? 'text-error' : 'text-primary')}>{value}</p>
      {hint && <p className="text-label-sm font-normal text-on-surface-variant">{hint}</p>}
    </div>
  );
}
