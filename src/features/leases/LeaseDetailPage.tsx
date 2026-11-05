/**
 * Detalle de un contrato (`/contratos/:id`): resumen, libro de pagos con atrasos y recargos,
 * registrar pago (solo se anota), renovación, documentos y conversación. Contabilidad solo mira.
 */
import { AlertTriangle, ArrowRight, CalendarClock, CalendarRange, CircleDollarSign, FileText, Hourglass, MessageSquare, Percent, PiggyBank, Receipt, RefreshCw, UserRound, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useAction } from '@/app/hooks';
import { useActor, useSession } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { DOC_CATEGORY_LABEL } from '@/domain/labels';
import { formatDate, formatDateLong } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { svc } from '@/services';
import { Avatar, Badge, Banner, Button, Card, CardHeader, EmptyState, ErrorState, LinkButton, Loading, Money, PageHeader, PropertyImage, useConfirm } from '@/ui';
import { DANGER_OUTLINE } from '../bookings/shared';
import { LeaseLedger } from './LeaseLedger';
import { PaymentModal } from './PaymentModal';
import { RenewModal } from './RenewModal';
import { canManageLeases, dueDayText, lateFeeText, LEASE_STATUS_LABEL, LEASE_STATUS_TONE, overdueText } from './shared';

function Fact({ icon: Icon, label, children }: { icon: typeof Receipt; label: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-low p-3">
      <dt className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
        <Icon size={14} aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 text-label-md text-primary">{children}</dd>
    </div>
  );
}

export default function LeaseDetailPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const { user } = useSession();
  const manage = canManageLeases(user?.role);
  const run = useAction();
  const confirm = useConfirm();
  const res = useLiveResult(() => svc.leases.getLease(actor, id), [actor, id]);
  const l = res.data;
  const property = useLive(() => (l ? svc.properties.getProperty(actor, l.propertyId).catch(() => null) : Promise.resolve(null)), [actor, l?.propertyId]);
  const [paying, setPaying] = useState<{ period?: string } | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  if (!l) {
    if (res.error)
      return (
        <div className="space-y-4" data-testid="detalle-contrato">
          <PageHeader title="Contrato" back="/contratos" />
          <ErrorState error={res.error} />
        </div>
      );
    return <Loading />;
  }

  const active = l.status === 'active';
  const nextPayment = l.ledger.find((r) => !r.payment && (r.status === 'due' || r.status === 'upcoming'));
  const unpaid = l.ledger.some((r) => !r.payment);
  const canPay = manage && l.status !== 'terminated' && unpaid;

  const openDoc = async (docId: string) => {
    // La pestaña se abre antes de esperar el archivo, para que el navegador no la bloquee.
    const tab = window.open('', '_blank');
    setOpening(docId);
    const file = await run(() => svc.documents.openDocument(actor, docId));
    setOpening(null);
    if (!file) {
      tab?.close();
      return;
    }
    const url = URL.createObjectURL(file.blob);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const terminate = async () => {
    const ok = await confirm({
      title: `¿Terminar el contrato ${l.code}?`,
      body: `${l.tenantName} deja ${l.propertyName}. El contrato queda como terminado y ya no genera rentas ni avisos.`,
      confirmLabel: 'Terminar contrato',
      danger: true,
    });
    if (ok) await run(() => svc.leases.updateLeaseStatus(actor, l.id, 'terminated'), { success: `Contrato ${l.code} terminado` });
  };

  const actions = manage && (canPay || active) && (
    <>
      {canPay && (
        <Button variant="success" icon={CircleDollarSign} onClick={() => setPaying({})} className="flex-1 md:flex-none" data-testid="registrar-pago">
          Registrar pago
        </Button>
      )}
      {active && !l.renewalDue && (
        <Button variant="secondary" icon={RefreshCw} onClick={() => setRenewing(true)} data-testid="renovar-contrato">
          Renovar
        </Button>
      )}
      {active && (
        <button type="button" onClick={terminate} className={DANGER_OUTLINE} data-testid="terminar-contrato">
          <XCircle size={18} aria-hidden />
          Terminar contrato
        </button>
      )}
    </>
  );

  return (
    <div className="space-y-5" data-testid="detalle-contrato">
      <PageHeader
        back="/contratos"
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label-sm uppercase text-on-surface-variant">{l.code}</span>
            <Badge tone={LEASE_STATUS_TONE[l.status]}>{LEASE_STATUS_LABEL[l.status]}</Badge>
            {!manage && <Badge tone="neutral">Solo lectura</Badge>}
          </div>
        }
        title={l.tenantName}
        subtitle={`${l.propertyName} · ${l.propertyCity}`}
        actions={actions || undefined}
      />

      {active && l.overdue.count > 0 && (
        <Banner
          tone="bad"
          icon={AlertTriangle}
          action={
            canPay && (
              <Button size="sm" variant="danger" onClick={() => setPaying({ period: l.ledger.find((r) => r.status === 'overdue')?.period })}>
                Registrar pago
              </Button>
            )
          }
        >
          <strong>Renta atrasada: {overdueText(l)}.</strong>{' '}
          {l.ledger
            .filter((r) => r.status === 'overdue')
            .map((r) => `Venció el ${formatDate(r.dueDate)} (${r.daysLate} días)`)
            .join(' · ')}
        </Banner>
      )}

      {l.renewalDue && (
        <Card accent="warn" className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between" data-testid="tarjeta-renovacion">
          <div className="flex items-start gap-3">
            <span className="rounded-md bg-warning-container p-2 text-on-warning-container">
              <CalendarClock size={20} aria-hidden />
            </span>
            <div>
              <p className="text-label-md text-primary">
                {l.daysToEnd === 0 ? 'El contrato termina hoy' : `El contrato termina en ${l.daysToEnd} ${l.daysToEnd === 1 ? 'día' : 'días'}`}
              </p>
              <p className="text-body-sm text-on-surface-variant">
                Último día: {formatDateLong(l.end)}. Habla con {l.tenantName.split(' ')[0]} para renovar o preparar la salida.
              </p>
            </div>
          </div>
          {manage && (
            <Button icon={RefreshCw} onClick={() => setRenewing(true)} data-testid="renovar-contrato">
              Renovar
            </Button>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader title="Resumen" subtitle={l.notes || undefined} />
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Fact icon={CalendarRange} label="Inicio">
                {formatDate(l.start, { year: true })}
              </Fact>
              <Fact icon={CalendarClock} label="Fin">
                {formatDate(l.end, { year: true })}
              </Fact>
              <Fact icon={Receipt} label="Renta">
                <Money amount={l.rent} currency={l.currency} />
                <span className="font-normal text-on-surface-variant"> /mes</span>
              </Fact>
              <Fact icon={CalendarRange} label="Día de pago">
                {dueDayText(l.dueDay)}
              </Fact>
              <Fact icon={PiggyBank} label="Depósito">
                <Money amount={l.deposit} currency={l.currency} />
              </Fact>
              <Fact icon={l.lateFee.kind === 'percent' ? Percent : Hourglass} label="Recargo por atraso">
                {lateFeeText(l)}
              </Fact>
            </dl>
          </Card>
        </div>
        <Card padding="none" className="overflow-hidden">
          <Link to={`/propiedades/${l.propertyId}`} className="block hover:opacity-95">
            <PropertyImage photo={property?.photos[0]} src={l.heroSrc} alt={l.propertyName} className="h-36 w-full" />
            <div className="flex items-center justify-between gap-3 p-4">
              <span className="min-w-0">
                <span className="block truncate text-label-md text-primary">{l.propertyName}</span>
                <span className="block truncate text-body-sm text-on-surface-variant">{property?.address ?? l.propertyCity}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-on-surface-variant" aria-hidden />
            </div>
          </Link>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Libro de pagos"
          subtitle={nextPayment ? `Próximo pago: ${formatDate(nextPayment.dueDate, { year: true })} · ${formatMoney(nextPayment.rent, l.currency)}` : 'Sin pagos pendientes'}
        />
        <LeaseLedger rows={l.ledger} currency={l.currency} onPay={canPay ? (period) => setPaying({ period }) : undefined} />
        <p className="mt-3 text-label-sm font-normal text-on-surface-variant">Solo se registra: la app no cobra ni mueve dinero.</p>
      </Card>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Inquilino" />
          <div className="flex items-center gap-3">
            <Avatar name={l.tenantName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-label-md text-primary">{l.tenantName}</p>
              <p className="text-body-sm text-on-surface-variant">Idioma: {l.tenantLanguage === 'en' ? 'inglés' : 'español'}</p>
            </div>
          </div>
          {manage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton to={`/personas/${l.tenantId}`} variant="secondary" size="sm" icon={UserRound}>
                Ver ficha
              </LinkButton>
              {l.threadId && (
                <LinkButton to={`/mensajes/${l.threadId}`} variant="secondary" size="sm" icon={MessageSquare} data-testid="conversacion-contrato">
                  Conversación
                </LinkButton>
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Documentos" subtitle={l.documents.length ? undefined : 'Contrato firmado, inventario y reglamento.'} />
          {l.documents.length === 0 ? (
            <EmptyState icon={FileText} title="Sin documentos" body="Súbelos desde Documentos y vincúlalos a este contrato." />
          ) : (
            <ul className="space-y-2">
              {l.documents.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => openDoc(d.id)}
                    disabled={opening === d.id}
                    className="flex w-full items-center gap-3 rounded-md border border-outline-variant/60 px-3 py-2.5 text-left transition-colors hover:bg-surface-low disabled:opacity-60"
                  >
                    <FileText size={18} className="shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label-md text-primary">{d.name}</span>
                      <span className="block truncate text-body-sm text-on-surface-variant">
                        {DOC_CATEGORY_LABEL[d.category]}
                        {d.expiresOn ? ` · vence ${formatDate(d.expiresOn, { year: true })}` : ''}
                      </span>
                    </span>
                    <span className="text-label-sm text-primary">{opening === d.id ? 'Abriendo…' : 'Abrir'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {paying && <PaymentModal lease={l} period={paying.period} onClose={() => setPaying(null)} />}
      {renewing && <RenewModal lease={l} onClose={() => setRenewing(false)} />}
    </div>
  );
}
