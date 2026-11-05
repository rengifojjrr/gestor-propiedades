/**
 * «Solo el propietario»: compra, valor, hipoteca, seguro, HOA e impuesto predial, más el ROI.
 * Solo aparece si el servicio entregó `ownerPrivate` (el propietario, o quien él lo comparta).
 */
import type { LucideIcon } from 'lucide-react';
import { Landmark, Lock, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { diffDays, formatDate } from '@/lib/dates';
import { formatMoney, formatPercent } from '@/lib/money';
import { svc, type PropertyView } from '@/services';
import { Badge, Card, CardHeader, KeyValue, Money } from '@/ui';

function Figure({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-label-sm text-on-surface-variant uppercase">{label}</p>
      <p className="tabular mt-0.5 text-headline-md text-primary">{value}</p>
      {note && <p className="text-body-sm text-on-surface-variant">{note}</p>}
    </div>
  );
}

function Block({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-md bg-surface-low p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-lowest text-primary shadow-card">
        <Icon size={18} aria-hidden />
      </span>
      <div className="min-w-0 text-body-sm text-on-surface-variant">
        <p className="text-label-md text-primary">{title}</p>
        {children}
      </div>
    </div>
  );
}

function Roi({ propertyId, currency, canFinance }: { propertyId: string; currency: string; canFinance: boolean }) {
  const actor = useActor();
  const month = svc.finance.currentMonth();
  const data = useLive(
    () =>
      canFinance
        ? Promise.all([svc.finance.roi(actor, propertyId), svc.finance.monthSummary(actor, month, propertyId)])
            .then(([roi, summary]) => (roi ? { roi, base: summary.baseCurrency } : null))
            .catch(() => null)
        : Promise.resolve(null),
    [actor, propertyId, canFinance, month],
  );
  if (!data) return null;
  const { roi, base } = data;
  return (
    <div className="mt-4 rounded-md border border-outline-variant/60 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-label-sm text-on-surface-variant uppercase">ROI anualizado</h3>
        <p className="tabular text-headline-lg text-secondary">{formatPercent(roi.roi, 1)}</p>
      </div>
      <dl className="mt-1">
        <KeyValue label="Neta anualizada" value={<Money amount={roi.annualizedNet} currency={base} whole />} />
        <KeyValue label={`Neta en ${roi.months} ${roi.months === 1 ? 'mes' : 'meses'}`} value={<Money amount={roi.netLast12} currency={base} whole />} />
        {roi.appreciation != null && <KeyValue label="Plusvalía" value={`${roi.appreciation >= 0 ? '+' : ''}${formatPercent(roi.appreciation, 1)}`} />}
      </dl>
      <p className="mt-2 text-label-sm font-normal text-on-surface-variant">
        Ganancia neta del último año llevada a 12 meses, sobre el precio de compra ({formatMoney(roi.purchasePrice, currency)}).
      </p>
    </div>
  );
}

export function OwnerCard({ property: p, isOwner, canFinance }: { property: PropertyView; isOwner: boolean; canFinance: boolean }) {
  const o = p.ownerPrivate;
  if (!o) return null;
  const cur = p.currency;
  const insuranceDays = o.insurance ? diffDays(p.today, o.insurance.expiresOn) : null;
  const appreciation = o.purchasePrice && o.estimatedValue ? (o.estimatedValue - o.purchasePrice) / o.purchasePrice : null;
  const empty = o.purchasePrice == null && o.estimatedValue == null && !o.mortgage && !o.insurance && o.hoaMonthly == null && o.propertyTaxAnnual == null;
  return (
    <Card padding="lg">
      <CardHeader
        title="Solo el propietario"
        subtitle={isOwner ? 'Nadie más ve estos datos, salvo que los compartas en Ajustes.' : 'El propietario compartió estos datos contigo.'}
        action={<Lock size={20} className="text-primary" aria-hidden />}
      />
      {empty ? (
        <p className="text-body-sm text-on-surface-variant">Sin datos privados todavía. Agrégalos en «Editar propiedad».</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {o.purchasePrice != null && (
              <Figure label="Precio de compra" value={<Money amount={o.purchasePrice} currency={cur} whole />} note={o.purchaseDate && formatDate(o.purchaseDate, { year: true })} />
            )}
            {o.estimatedValue != null && (
              <Figure
                label="Valor estimado"
                value={<Money amount={o.estimatedValue} currency={cur} whole />}
                note={appreciation != null && `${appreciation >= 0 ? '+' : ''}${formatPercent(appreciation, 1)} desde la compra`}
              />
            )}
            {o.hoaMonthly != null && <Figure label="HOA (condominio)" value={formatMoney(o.hoaMonthly, cur)} note="al mes" />}
            {o.propertyTaxAnnual != null && <Figure label="Impuesto predial" value={formatMoney(o.propertyTaxAnnual, cur)} note="al año" />}
          </div>
          <div className="mt-4 space-y-2">
            {o.mortgage && (
              <Block icon={Landmark} title="Hipoteca">
                <p>{o.mortgage.lender}</p>
                <p>
                  {formatMoney(o.mortgage.monthlyPayment, cur)}/mes · saldo {formatMoney(o.mortgage.balance, cur)}
                </p>
              </Block>
            )}
            {o.insurance && (
              <Block icon={ShieldCheck} title="Seguro">
                <p>
                  {o.insurance.provider} · póliza {o.insurance.policyNumber}
                </p>
                <p>
                  {formatMoney(o.insurance.annualPremium, cur)}/año · vence {formatDate(o.insurance.expiresOn, { year: true })}
                </p>
                {insuranceDays != null && insuranceDays < 0 && (
                  <Badge tone="bad" className="mt-1.5">
                    Vencido
                  </Badge>
                )}
                {insuranceDays != null && insuranceDays >= 0 && insuranceDays <= 30 && (
                  <Badge tone="warn" className="mt-1.5">
                    Vence en {insuranceDays} días
                  </Badge>
                )}
              </Block>
            )}
          </div>
        </>
      )}
      <Roi propertyId={p.id} currency={cur} canFinance={canFinance} />
    </Card>
  );
}
