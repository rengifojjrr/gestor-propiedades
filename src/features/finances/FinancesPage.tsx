/**
 * Finanzas (Stitch «Financial Overview»): ganancia neta del mes, ingresos y gastos, flujo de caja de
 * 6 meses, margen, gastos por aprobar, desempeño por propiedad, indicadores y últimos movimientos.
 * Todo es lo REGISTRADO: la app nunca mueve dinero. Contabilidad: solo lectura y exportación.
 */
import { Download, Info, Receipt } from 'lucide-react';
import { useState } from 'react';
import { downloadFile, useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { formatMoney } from '@/lib/money';
import { svc, type TransactionView } from '@/services';
import { Banner, Button, Card, ErrorState, LinkButton, Loading, PageHeader, useConfirm } from '@/ui';
import { CashflowChart, ChartLegend, useIsDark } from './CashflowChart';
import {
  CategoryBreakdownCard,
  HeroCards,
  MarginCard,
  PendingApprovalsCard,
  PerformanceSection,
  PortfolioKpisCard,
  RecentTransactionsCard,
  withMonth,
  type PerformanceRow,
} from './FinanceSections';
import { RecordTransactionModal } from './RecordTransactionModal';
import { TxDetailModal } from './TxDetailModal';
import { MonthSelect, useFinancePerms, useMonthParam } from './shared';

export default function FinancesPage() {
  const actor = useActor();
  const run = useAction();
  const confirm = useConfirm();
  const perms = useFinancePerms();
  const dark = useIsDark();
  const current = svc.finance.currentMonth();
  const [month, setMonth] = useMonthParam();
  const [recording, setRecording] = useState<'income' | 'expense' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<TransactionView | null>(null);

  const summaryRes = useLiveResult(() => svc.finance.monthSummary(actor, month), [actor, month]);
  const summary = summaryRes.data;
  const series = useLive(() => svc.finance.series(actor, month, 6), [actor, month]);
  const kpis = useLive(() => svc.finance.portfolioKpis(actor, month), [actor, month]);
  const recent = useLive(async () => (await svc.finance.listTransactions(actor, { month, includePending: true })).slice(0, 8), [actor, month]);
  const pending = useLive(() => (perms.isOwner ? svc.finance.pendingApprovals(actor) : Promise.resolve([] as TransactionView[])), [actor, perms.isOwner]);
  const performance = useLive(async (): Promise<PerformanceRow[]> => {
    const [rows, props] = await Promise.all([svc.finance.propertyPerformance(actor, month), svc.properties.listProperties(actor)]);
    const rois = await Promise.all(rows.map((r) => svc.finance.roi(actor, r.propertyId).catch(() => null)));
    return rows.map((r, i) => ({ ...r, roi: rois[i], photo: props.find((p) => p.id === r.propertyId)?.photos[0] }));
  }, [actor, month]);

  if (summaryRes.error && !summary) return <ErrorState error={summaryRes.error} />;
  if (!summary) return <Loading />;
  const base = summary.baseCurrency;
  const showRoi = !!performance?.some((r) => r.roi);

  const exportCsv = async () => {
    setExporting(true);
    const csv = await run(() => svc.finance.exportCsv(actor, { month }), { success: 'CSV descargado.' });
    setExporting(false);
    if (csv) downloadFile(csv, `movimientos-${month}.csv`, 'text/csv;charset=utf-8');
  };

  const approve = async (t: TransactionView) => {
    setBusyId(t.id);
    await run(() => svc.finance.approveTransaction(actor, t.id), { success: `Aprobado: ${t.description}. Ya suma en las cuentas.` });
    setBusyId(null);
  };

  const reject = async (t: TransactionView) => {
    const ok = await confirm({
      title: '¿Rechazar este gasto?',
      body: `«${t.description}» (${formatMoney(t.amount, t.currency)}) queda anulado y no suma en las cuentas. Queda en la auditoría.`,
      confirmLabel: 'Rechazar',
      danger: true,
    });
    if (!ok) return;
    setBusyId(t.id);
    await run(() => svc.finance.voidTransaction(actor, t.id), { success: 'Gasto rechazado (anulado).' });
    setBusyId(null);
  };

  return (
    <div data-testid="finanzas" className="space-y-6">
      <PageHeader
        title="Finanzas"
        subtitle="Lo registrado del portafolio: ingresos, gastos y ganancia."
        actions={
          <div className="flex flex-wrap gap-2 xl:flex-nowrap">
            <MonthSelect value={month} onChange={setMonth} />
            <Button variant="secondary" icon={Download} onClick={exportCsv} loading={exporting} data-testid="exportar-csv">
              Exportar CSV
            </Button>
            <LinkButton to={withMonth('/finanzas/estado-de-cuenta', month, current)} variant="secondary" icon={Receipt}>
              Estado de cuenta
            </LinkButton>
          </div>
        }
      />

      {perms.role === 'accountant' && (
        <Banner tone="info" icon={Info}>
          Contabilidad: ves las finanzas en modo lectura y puedes exportarlas. Registran el propietario y Administración.
        </Banner>
      )}

      <HeroCards summary={summary} isCurrent={month === current} />

      {perms.isOwner && pending && pending.length > 0 && (
        <PendingApprovalsCard items={pending} base={base} onApprove={approve} onReject={reject} busyId={busyId} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card padding="lg" className="lg:col-span-2" as="section" aria-label="Ingresos vs. gastos (6 meses)">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-headline-md text-primary">Ingresos vs. gastos (6 meses)</h2>
              <p className="text-body-sm text-on-surface-variant">Flujo de caja registrado, en {base}</p>
            </div>
            <ChartLegend dark={dark} />
          </div>
          {series ? <CashflowChart data={series} currency={base} selected={month} className="mt-4" /> : <Loading className="h-64" />}
        </Card>
        <MarginCard summary={summary} canWrite={perms.canWrite} onRecord={setRecording} />
      </div>

      {performance ? <PerformanceSection rows={performance} base={base} showRoi={showRoi} /> : <Loading />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {kpis ? <PortfolioKpisCard kpis={kpis} base={base} /> : <Loading />}
        <CategoryBreakdownCard items={summary.expensesByCategory} base={base} />
      </div>

      {recent ? <RecentTransactionsCard items={recent} base={base} allLink={withMonth('/finanzas/movimientos', month, current)} onOpen={setSelected} /> : <Loading />}

      <p className="flex items-start gap-2 text-body-sm text-on-surface-variant">
        <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
        Todo se consolida en {base} con las tasas manuales de Ajustes; nunca se suman monedas distintas sin convertir. La app solo registra: no cobra ni paga.
      </p>

      {recording && <RecordTransactionModal initialType={recording} onClose={() => setRecording(null)} />}
      {selected && <TxDetailModal tx={selected} base={base} onClose={() => setSelected(null)} />}
    </div>
  );
}
