/**
 * Movimientos: todo lo registrado, con filtros (mes, propiedad, tipo, pendientes), exportación a CSV
 * y «Anular» (propietario y administración). Lista en el teléfono, tabla en la computadora; tocar un
 * movimiento abre su detalle.
 */
import { Ban, Check, Download, Filter, Receipt } from 'lucide-react';
import { useState } from 'react';
import { downloadFile, useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { formatDate } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { svc, type TransactionView } from '@/services';
import { Button, Card, cn, EmptyState, ErrorState, Eyebrow, IconButton, LinkButton, Loading, PageHeader, Select, Toggle, useConfirm } from '@/ui';
import { withMonth } from './FinanceSections';
import { methodText, MonthSelect, TX_SOURCE_LABEL, TxAmount, TxIcon, TxRow, TxStatusBadge, useFinancePerms, useMonthParam } from './shared';
import { TxDetailModal } from './TxDetailModal';

const PAGE = 60;

/** El origen solo se nombra cuando la categoría no lo dice ya. */
function subline(t: TransactionView): string {
  return t.source.kind === 'manual' || t.source.kind === 'recurring' ? `${t.categoryLabel} · ${TX_SOURCE_LABEL[t.source.kind]}` : t.categoryLabel;
}

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
  const [selected, setSelected] = useState<TransactionView | null>(null);

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
      body: `«${t.description}» (${formatMoney(t.amount, t.currency)}) deja de sumar en las cuentas. No se borra: queda anulado y en la auditoría.`,
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

  const visible = rows?.slice(0, limit) ?? [];

  return (
    <div className="space-y-6" data-testid="movimientos">
      <PageHeader
        back="/finanzas"
        title="Movimientos"
        subtitle="Todo lo registrado, con su moneda. Nada se borra: lo anulado deja de sumar."
        actions={
          <div className="flex flex-wrap gap-2 xl:flex-nowrap">
            <Button variant="secondary" icon={Download} onClick={exportCsv} loading={exporting}>
              Exportar CSV
            </Button>
            {month !== 'todos' && (
              <LinkButton to={withMonth('/finanzas/estado-de-cuenta', month, current)} variant="secondary" icon={Receipt}>
                Estado de cuenta
              </LinkButton>
            )}
          </div>
        }
      />

      <Card padding="md" as="section" aria-label="Filtros">
        <div className="mb-3 flex items-center gap-2 text-label-md text-primary">
          <Filter size={16} aria-hidden /> Filtros
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
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
            <SummaryTile label="Movimientos" value={String(rows.length)} hint={pendingCount ? `${pendingCount} por aprobar` : undefined} />
            <SummaryTile label="Ingresos" value={formatMoney(income, base)} tone="income" />
            <SummaryTile label="Gastos" value={formatMoney(expenses, base)} tone="expense" />
            <SummaryTile label="Neto" value={formatMoney(income - expenses, base)} hint={pendingCount ? 'Sin contar lo por aprobar' : `En ${base}`} />
          </div>

          {rows.length === 0 ? (
            <EmptyState icon={Receipt} title="No hay movimientos con estos filtros" body="Prueba con otro mes o con todas las propiedades." />
          ) : (
            <Card padding="none" className="overflow-hidden">
              {/* Teléfono y tableta: toca un movimiento para ver el detalle y sus acciones */}
              <ul className="divide-y divide-outline-variant/50 px-4 lg:hidden">
                {visible.map((t) => (
                  <TxRow key={t.id} tx={t} base={base} onOpen={setSelected} />
                ))}
              </ul>
              {/* Computadora */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-left text-body-sm">
                  <thead className="bg-surface-low text-[11px] font-bold tracking-wide whitespace-nowrap text-on-surface-variant uppercase">
                    <tr>
                      <th scope="col" className="py-3 pr-2 pl-5">
                        Fecha
                      </th>
                      <th scope="col" className="px-2 py-3">
                        Movimiento
                      </th>
                      <th scope="col" className="px-2 py-3">
                        Propiedad
                      </th>
                      <th scope="col" className="px-2 py-3">
                        Método · ref.
                      </th>
                      <th scope="col" className="px-2 py-3 text-right">
                        Monto
                      </th>
                      <th scope="col" className={cn('py-3 pl-2', perms.canWrite ? 'pr-2' : 'pr-5')}>
                        Estado
                      </th>
                      {perms.canWrite && (
                        <th scope="col" className="py-3 pr-4 pl-1">
                          <span className="sr-only">Acciones</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {visible.map((t) => (
                      <tr key={t.id} className="transition-colors hover:bg-surface-low/60">
                        <td className="tabular py-2.5 pr-2 pl-5 whitespace-nowrap text-on-surface">{formatDate(t.date, { year: month === 'todos' })}</td>
                        <td className="px-2 py-2.5">
                          <button type="button" onClick={() => setSelected(t)} className="group flex items-center gap-3 text-left">
                            <TxIcon type={t.type} />
                            <span className="min-w-0">
                              <span className="block max-w-60 truncate text-label-md text-primary group-hover:underline" title={t.description}>
                                {t.description}
                              </span>
                              <span className="block max-w-60 truncate text-label-sm font-normal text-on-surface-variant">{subline(t)}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-2 py-2.5 text-on-surface">
                          <span className="block max-w-40 truncate" title={t.propertyName}>
                            {t.propertyName}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-on-surface-variant">
                          <span className="block max-w-36 truncate" title={methodText(t)}>
                            {methodText(t) || '—'}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          <TxAmount tx={t} base={base} />
                        </td>
                        <td className={cn('py-2.5 pl-2', perms.canWrite ? 'pr-2' : 'pr-5')}>
                          <TxStatusBadge status={t.status} />
                        </td>
                        {perms.canWrite && (
                          <td className="py-1.5 pr-4 pl-1">
                            <div className="flex justify-end gap-0.5">
                              {perms.canApprove && t.status === 'pending_approval' && (
                                <IconButton icon={Check} size="sm" variant="tonal" label={`Aprobar «${t.description}»`} disabled={busyId === t.id} onClick={() => approve(t)} />
                              )}
                              <IconButton icon={Ban} size="sm" label={`Anular «${t.description}»`} disabled={busyId === t.id} onClick={() => voidTx(t)} />
                            </div>
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
            Cada monto va en la moneda de su movimiento; cuando es otra, debajo aparece el equivalente en {base} con la tasa manual de su fecha.
          </p>
        </>
      )}

      {selected && <TxDetailModal tx={selected} base={base} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SummaryTile({ label, value, tone, hint }: { label: string; value: string; tone?: 'income' | 'expense'; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 shadow-card">
      <Eyebrow>{label}</Eyebrow>
      <p className={cn('mt-1 truncate text-headline-md', tone === 'income' ? 'text-secondary' : tone === 'expense' ? 'text-error' : 'text-primary')}>{value}</p>
      {hint && <p className="text-label-sm font-normal text-on-surface-variant">{hint}</p>}
    </div>
  );
}
