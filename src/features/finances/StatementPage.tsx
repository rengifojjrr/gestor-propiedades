/**
 * Estado de cuenta mensual del propietario: una hoja tipo documento para imprimir o guardar en PDF
 * (window.print). Al imprimir solo sale la hoja (.print-sheet), en claro aunque la app esté en oscuro.
 */
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect } from 'react';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { formatDate, formatDateTime } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { svc, type OwnerStatement, type TransactionView } from '@/services';
import { Button, cn, ErrorState, LinkButton, Loading, useFileUrl } from '@/ui';
import { withMonth } from './FinanceSections';
import { MonthSelect, useMonthParam } from './shared';

/**
 * Al imprimir: se esconde todo menos la hoja y sus contenedores (sin márgenes ni marco de la app).
 * Solo reglas de diseño, sin colores: los colores salen de los tokens.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm 12mm; }
  body *:not(:has(.print-sheet)):not(.print-sheet):not(.print-sheet *) { display: none !important; }
  *:has(.print-sheet) { display: block !important; position: static !important; margin: 0 !important; padding: 0 !important; max-width: none !important; min-height: 0 !important; height: auto !important; overflow: visible !important; border: 0 !important; box-shadow: none !important; background: var(--color-surface-lowest) !important; }
  .print-sheet { margin: 0 !important; padding: 0 !important; max-width: none !important; border-radius: 0 !important; }
  .print-avoid-break { break-inside: avoid; }
  .print-sheet table { font-size: 11px; }
}`;

/** Mientras se imprime, la hoja sale en modo claro (se devuelve el oscuro al terminar). */
function usePrintInLight() {
  useEffect(() => {
    const root = document.documentElement;
    let restore = false;
    const before = () => {
      restore = root.classList.contains('dark');
      if (restore) root.classList.remove('dark');
    };
    const after = () => {
      if (restore) root.classList.add('dark');
      restore = false;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}

interface Line {
  label: string;
  amount: number;
}

/** Ingresos o gastos de una propiedad por categoría, en SU moneda (de los movimientos del mes). */
function linesFor(transactions: TransactionView[], propertyId: string | null, type: 'income' | 'expense'): Line[] {
  const map = new Map<string, number>();
  for (const t of transactions) {
    if ((t.propertyId ?? null) !== propertyId || t.type !== type || t.status !== 'posted') continue;
    map.set(t.categoryLabel, (map.get(t.categoryLabel) ?? 0) + t.amount);
  }
  return [...map.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
}

export default function StatementPage() {
  const actor = useActor();
  const current = svc.finance.currentMonth();
  const [month, setMonth] = useMonthParam();
  const res = useLiveResult(() => svc.finance.ownerStatement(actor, month), [actor, month]);
  const company = useLive(() => svc.system.getCompanyName(), []);
  const logoUrl = useFileUrl(company?.logoFileId);
  usePrintInLight();

  const st = res.data;
  return (
    <div className="space-y-5">
      <style>{PRINT_CSS}</style>
      <div className="no-print flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <LinkButton to={withMonth('/finanzas', month, current)} variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2 mb-2">
            Finanzas
          </LinkButton>
          <h1 className="text-headline-lg text-primary md:text-headline-xl">Estado de cuenta</h1>
          <p className="mt-1 text-body-md text-on-surface-variant">Resumen mensual para el propietario. Imprímelo o guárdalo en PDF.</p>
        </div>
        <div className="flex flex-wrap gap-2 md:shrink-0 md:flex-nowrap">
          <MonthSelect value={month} onChange={setMonth} />
          <Button icon={Printer} onClick={() => window.print()} disabled={!st} data-testid="imprimir-estado">
            Imprimir o guardar PDF
          </Button>
        </div>
      </div>

      {res.error && !st ? (
        <ErrorState error={res.error} className="no-print" />
      ) : !st ? (
        <Loading className="no-print" />
      ) : (
        <StatementSheet st={st} logoUrl={logoUrl ?? `${import.meta.env.BASE_URL}logo.svg`} />
      )}
    </div>
  );
}

function StatementSheet({ st, logoUrl }: { st: OwnerStatement; logoUrl: string }) {
  const base = st.baseCurrency;
  const pendingTotal = st.pending.reduce((s, t) => s + t.amountBase, 0);
  return (
    <article className="print-sheet mx-auto max-w-4xl rounded-lg border border-outline-variant/60 bg-surface-lowest p-5 text-on-surface shadow-card sm:p-8 md:p-10" aria-label={`Estado de cuenta de ${st.label}`}>
      {/* Encabezado del documento */}
      <header className="flex flex-col gap-5 border-b-2 border-primary pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="" className="h-12 w-12 rounded-md object-cover" />
          <div>
            <p className="text-headline-md font-bold text-primary">{st.companyName}</p>
            <p className="text-body-sm text-on-surface-variant">Administración de propiedades</p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-label-sm tracking-widest text-on-surface-variant uppercase">Estado de cuenta</p>
          <p className="text-headline-lg text-primary">{st.label}</p>
          <p className="text-body-sm text-on-surface-variant">
            Propietario: <span className="font-semibold text-on-surface">{st.ownerName || '—'}</span>
          </p>
          <p className="text-body-sm text-on-surface-variant">Generado el {formatDateTime(st.generatedAt)}</p>
        </div>
      </header>

      {/* Resumen */}
      <section className="print-avoid-break mt-6" aria-label="Resumen del mes">
        <h2 className="mb-3 text-label-sm tracking-widest text-on-surface-variant uppercase">Resumen del mes · {base}</h2>
        <div className="grid grid-cols-1 overflow-hidden rounded-md border border-outline-variant sm:grid-cols-3 print:grid-cols-3">
          <SummaryBox label="Ingresos" value={formatMoney(st.totals.income, base)} />
          <SummaryBox label="Gastos" value={formatMoney(st.totals.expenses, base)} className="border-t border-outline-variant sm:border-t-0 sm:border-l print:border-t-0 print:border-l" />
          <SummaryBox label="Neto" value={formatMoney(st.totals.net, base)} strong className="border-t border-outline-variant bg-surface-low sm:border-t-0 sm:border-l print:border-t-0 print:border-l" />
        </div>
      </section>

      {/* Por propiedad */}
      <section className="mt-8" aria-label="Por propiedad">
        <h2 className="mb-3 text-label-sm tracking-widest text-on-surface-variant uppercase">Por propiedad</h2>
        {st.rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-outline-variant p-4 text-body-sm text-on-surface-variant">No hay movimientos registrados en {st.label.toLowerCase()}.</p>
        ) : (
          <div className="space-y-4">
            {st.rows.map((row) => {
              const income = linesFor(st.transactions, row.propertyId, 'income');
              const expenses = linesFor(st.transactions, row.propertyId, 'expense');
              return (
                <div key={row.propertyId ?? 'portafolio'} className="print-avoid-break rounded-md border border-outline-variant">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-outline-variant bg-surface-low px-4 py-2.5">
                    <h3 className="text-label-md text-primary">{row.propertyName}</h3>
                    <span className="text-label-sm font-normal text-on-surface-variant">Moneda: {row.currency}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 sm:grid-cols-2">
                    <LineList title="Ingresos por categoría" lines={income} total={row.totalIncome} currency={row.currency} />
                    <LineList title="Gastos por categoría" lines={expenses} total={row.totalExpenses} currency={row.currency} />
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-outline-variant px-4 py-2.5">
                    <span className="text-label-md text-on-surface">Neto</span>
                    <span className="tabular text-label-md text-primary">
                      {formatMoney(row.net, row.currency)}
                      {row.currency !== base && <span className="ml-2 font-normal text-on-surface-variant">≈ {formatMoney(row.netBase, base)}</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Totales del portafolio */}
      <section className="print-avoid-break mt-8" aria-label="Totales del portafolio">
        <h2 className="mb-3 text-label-sm tracking-widest text-on-surface-variant uppercase">Totales del portafolio · {base}</h2>
        <dl className="rounded-md border border-outline-variant">
          <TotalRow label="Ingresos registrados" value={formatMoney(st.totals.income, base)} />
          <TotalRow label="Gastos registrados" value={formatMoney(st.totals.expenses, base)} />
          <TotalRow label="Ganancia neta del mes" value={formatMoney(st.totals.net, base)} strong />
        </dl>
        <p className="mt-2 text-body-sm text-on-surface-variant">
          Cada movimiento se convierte a {base} con la tasa manual vigente en su fecha (Ajustes → Monedas). Nunca se suman monedas distintas sin convertir.
        </p>
      </section>

      {/* Pendientes */}
      <section className="print-avoid-break mt-6" aria-label="Pendientes de aprobación">
        {st.pending.length > 0 ? (
          <div className="rounded-md border border-warning bg-warning-container/40 p-4 text-body-sm text-on-surface">
            <p className="font-semibold">
              {st.pending.length} {st.pending.length === 1 ? 'gasto pendiente' : 'gastos pendientes'} de aprobación por {formatMoney(pendingTotal, base)}: no están incluidos en los totales.
            </p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {st.pending.map((t) => (
                <li key={t.id}>
                  {formatDate(t.date)} · {t.propertyName} · {t.description} · {formatMoney(t.amount, t.currency)}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-body-sm text-on-surface-variant">Sin gastos pendientes de aprobación en el mes.</p>
        )}
      </section>

      {/* Anexo */}
      <section className="mt-8" aria-label="Anexo: movimientos del mes">
        <h2 className="mb-3 text-label-sm tracking-widest text-on-surface-variant uppercase">Anexo · movimientos registrados ({st.transactions.length})</h2>
        {st.transactions.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Sin movimientos.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-outline-variant">
            <table className="w-full min-w-[560px] text-left text-body-sm">
              <thead className="bg-surface-low text-label-sm text-on-surface-variant">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Fecha
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Propiedad
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Descripción
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Categoría
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Monto
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/60">
                {[...st.transactions]
                  .sort((a, b) => a.date.localeCompare(b.date) || a.propertyName.localeCompare(b.propertyName))
                  .map((t) => (
                    <tr key={t.id} className="print-avoid-break">
                      <td className="tabular px-3 py-1.5 whitespace-nowrap">{formatDate(t.date)}</td>
                      <td className="px-3 py-1.5">{t.propertyName}</td>
                      <td className="px-3 py-1.5">{t.description}</td>
                      <td className="px-3 py-1.5 text-on-surface-variant">{t.categoryLabel}</td>
                      <td className={cn('tabular px-3 py-1.5 text-right whitespace-nowrap', t.type === 'income' ? 'text-secondary' : 'text-error')}>
                        {t.type === 'income' ? '+' : '−'}
                        {formatMoney(t.amount, t.currency)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="mt-8 border-t border-outline-variant pt-4 text-label-sm font-normal text-on-surface-variant">
        Documento informativo de {st.companyName}. Solo refleja movimientos registrados: la app no cobra, no paga ni mueve dinero. Datos de ejemplo.
      </footer>
    </article>
  );
}

function SummaryBox({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-baseline justify-between gap-3 px-4 py-3 sm:block print:block', className)}>
      <p className="text-label-sm text-on-surface-variant">{label}</p>
      <p className={cn('tabular truncate text-body-lg sm:mt-1 sm:text-headline-md print:mt-1 print:text-headline-md', strong ? 'font-bold text-primary' : 'font-semibold text-on-surface')}>{value}</p>
    </div>
  );
}

function LineList({ title, lines, total, currency }: { title: string; lines: Line[]; total: number; currency: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-label-sm text-on-surface-variant">{title}</p>
      {lines.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">—</p>
      ) : (
        <ul className="space-y-1">
          {lines.map((l) => (
            <li key={l.label} className="flex items-baseline justify-between gap-3 text-body-sm">
              <span className="min-w-0 truncate">{l.label}</span>
              <span className="tabular shrink-0">{formatMoney(l.amount, currency)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-outline-variant/60 pt-1.5 text-body-sm font-semibold">
        <span>Total</span>
        <span className="tabular">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 border-b border-outline-variant/60 px-4 py-2.5 last:border-b-0', strong && 'bg-surface-low')}>
      <dt className={cn('text-body-sm', strong ? 'font-bold text-primary' : 'text-on-surface')}>{label}</dt>
      <dd className={cn('tabular text-body-md', strong ? 'font-bold text-primary' : 'text-on-surface')}>{value}</dd>
    </div>
  );
}
