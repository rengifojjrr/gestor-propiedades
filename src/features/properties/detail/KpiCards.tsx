/** Cifras del mes de la propiedad (solo roles con finanzas): ingresos, gastos, ganancia y ocupación. */
import type { LucideIcon } from 'lucide-react';
import { ChartNoAxesColumn, Receipt, TrendingUp, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { formatPercent } from '@/lib/money';
import { svc } from '@/services';
import { cn, Money, Skeleton } from '@/ui';

function Kpi({ icon: Icon, iconClass, label, children }: { icon: LucideIcon; iconClass: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 text-center shadow-card md:p-5">
      <Icon size={22} className={cn('mb-2', iconClass)} aria-hidden />
      <p className="text-label-sm text-on-surface-variant">{label}</p>
      <p className="tabular mt-0.5 text-headline-md text-primary">{children}</p>
    </div>
  );
}

/** Ingresos y gastos van en la moneda base (así se consolidan); ADR y RevPAR en la de la propiedad. */
export function KpiCards({ propertyId, currency }: { propertyId: string; currency: string }) {
  const actor = useActor();
  const month = svc.finance.currentMonth();
  const fin = useLive(
    () =>
      Promise.all([svc.finance.propertyPerformance(actor, month), svc.finance.monthSummary(actor, month, propertyId)])
        .then(([rows, summary]) => ({ row: rows.find((r) => r.propertyId === propertyId) ?? null, base: summary.baseCurrency, label: summary.label }))
        .catch(() => null),
    [actor, month, propertyId],
  );

  if (fin === undefined)
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  if (!fin?.row) return null;
  const { row, base, label } = fin;

  return (
    <section aria-label={`Cifras de ${label}`}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi icon={TrendingUp} iconClass="text-primary" label="Ingresos del mes">
          <Money amount={row.income} currency={base} />
        </Kpi>
        <Kpi icon={Receipt} iconClass="text-error" label="Gastos">
          <Money amount={row.expenses} currency={base} />
        </Kpi>
        <Kpi icon={Wallet} iconClass="text-secondary" label="Ganancia neta">
          <Money amount={row.net} currency={base} />
        </Kpi>
        <Kpi icon={ChartNoAxesColumn} iconClass="text-warning" label="Ocupación">
          {formatPercent(row.occupancy)}
        </Kpi>
      </div>
      <p className="mt-2 text-label-sm font-normal text-on-surface-variant">
        {label}
        {row.adr != null && (
          <>
            {' · ADR '}
            <Money amount={row.adr} currency={currency} whole />
          </>
        )}
        {row.revpar != null && (
          <>
            {' · RevPAR '}
            <Money amount={row.revpar} currency={currency} whole />
          </>
        )}
        {row.rentalMode !== 'monthly' && ` · ${row.nightsSold} de ${row.availableNights} noches vendidas`}
      </p>
    </section>
  );
}
