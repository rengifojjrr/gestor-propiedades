/**
 * «Limpieza y mantenimiento» (equipo): urgencias, gastos por aprobar (propietario), carga de la
 * semana, mantenimiento y limpiezas pendientes, y lo hecho hace poco. Como la pantalla de Stitch.
 */
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, CalendarClock, CircleCheck, ClipboardPlus, Plus, Siren, SprayCan, TriangleAlert, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { CLEANING_TYPE_LABEL } from '@/domain/labels';
import { todayIn } from '@/lib/clock';
import { addDays } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { svc, type CleaningTaskView, type OrderView } from '@/services';
import { Button, Card, EmptyState, Fab, LinkButton, Loading, PageHeader, Section } from '@/ui';
import { DecisionModal, type Threshold } from './Approval';
import { AssignCleaningModal, AssignOrderModal } from './AssignModals';
import { ApprovalRow, CleaningCard, DoneCard, LoadCard, PendingOrderRow, UrgentOrderCard, type DoneItem } from './OperationsCards';
import { ReportProblemModal } from './ReportProblemModal';
import { ago, useFieldStaff, useOpsAccess } from './shared';

const OPEN_STATUSES: OrderView['status'][] = ['open', 'scheduled', 'in_progress'];

function QuickLink({ to, icon: Icon, label, count }: { to: string; icon: LucideIcon; label: string; count?: number }) {
  return (
    <Link to={to} className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-outline-variant/60 bg-surface-lowest px-4 text-label-md text-primary shadow-card hover:bg-surface-low">
      <Icon size={18} aria-hidden />
      {label}
      {count != null && <span className="rounded-full bg-surface-container px-2 py-0.5 text-label-sm">{count}</span>}
    </Link>
  );
}

export default function OperationsPage() {
  const actor = useActor();
  const { isOwner, canManage, canTriage } = useOpsAccess();
  const orders = useLive(() => svc.operations.listOrders(actor), [actor]);
  const cleanings = useLive(() => svc.operations.listCleaning(actor), [actor]);
  const openIncidents = useLive(() => svc.operations.listIncidents(actor, { status: ['open'] }), [actor]);
  const vendors = useLive(() => svc.operations.listVendors(actor), [actor]);
  const settings = useLive(() => (canManage ? svc.system.getAppSettings(actor) : Promise.resolve(undefined)), [actor, canManage]);
  const preventive = useLive(() => (canManage ? svc.operations.listPreventive(actor) : Promise.resolve(undefined)), [actor, canManage]);
  const staff = useFieldStaff();
  const [assigningOrder, setAssigningOrder] = useState<OrderView | null>(null);
  const [assigningTask, setAssigningTask] = useState<CleaningTaskView | null>(null);
  const [deciding, setDeciding] = useState<{ order: OrderView; mode: 'approve' | 'reject' } | null>(null);
  const [reporting, setReporting] = useState(false);

  if (!orders || !cleanings) return <Loading />;

  const threshold: Threshold | undefined = settings ? { amount: settings.approvalThreshold, currency: settings.baseCurrency } : undefined;
  const open = orders.filter((o) => OPEN_STATUSES.includes(o.status));
  const urgent = open.filter((o) => o.priority === 'urgent');
  const pendingOrders = open.filter((o) => o.priority !== 'urgent');
  const approvals = orders.filter((o) => o.approval.status === 'pending');
  const pendingCleanings = cleanings.filter((t) => t.status === 'pending' || t.status === 'in_progress');

  // Carga de los próximos 7 días (con lo atrasado y lo que no tiene fecha).
  const inWeek = (date: string | undefined, tz: string) => !date || date <= addDays(todayIn(tz), 6);
  const weekCleanings = pendingCleanings.filter((t) => inWeek(t.date, t.timezone)).length;
  const weekOrders = open.filter((o) => inWeek(o.scheduledDate, o.timezone)).length;
  const people = staff.cleaners.length + staff.technicians.length;

  const done: DoneItem[] = [
    ...cleanings
      .filter((t) => t.status === 'done' && t.completedAt)
      .map((t) => ({
        key: t.id,
        kind: 'cleaning' as const,
        at: t.completedAt!,
        propertyName: t.propertyName,
        detail: `${CLEANING_TYPE_LABEL[t.type]} · ${t.assigneeName ?? 'Limpieza'} · ${ago(t.completedAt!)}`,
        to: `/operacion/limpieza/${t.id}`,
      })),
    ...orders
      .filter((o) => o.status === 'resolved' && o.resolvedAt)
      .map((o) => ({
        key: o.id,
        kind: 'order' as const,
        at: o.resolvedAt!,
        propertyName: o.propertyName,
        detail: `${o.code} · ${o.title} · ${ago(o.resolvedAt!)}`,
        to: `/operacion/mantenimiento/${o.id}`,
      })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Limpieza y mantenimiento"
        subtitle="Cuida el estado de las propiedades y los horarios de servicio."
        actions={
          <>
            {canManage && (
              <LinkButton to="/operacion/limpieza/nueva" icon={ClipboardPlus}>
                Crear limpieza
              </LinkButton>
            )}
            {canTriage && (
              <Button variant="secondary" icon={TriangleAlert} onClick={() => setReporting(true)} data-testid="reportar-problema">
                Reportar problema
              </Button>
            )}
          </>
        }
      />

      <nav aria-label="Más de operación" className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        <QuickLink to="/operacion/incidencias" icon={Siren} label="Incidencias" count={openIncidents?.length} />
        {canManage && <QuickLink to="/operacion/preventivo" icon={CalendarClock} label="Preventivo" count={preventive?.filter((p) => p.active).length} />}
        <QuickLink to="/operacion/proveedores" icon={Truck} label="Proveedores" count={vendors?.length} />
      </nav>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="space-y-6 xl:col-span-8">
          <section aria-label="Mantenimiento urgente" className="space-y-3">
            <div className="flex items-center gap-2">
              <TriangleAlert size={20} className="text-error" aria-hidden />
              <h2 className="text-headline-md text-primary">Mantenimiento urgente</h2>
            </div>
            {urgent.length ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {urgent.map((o) => (
                  <UrgentOrderCard key={o.id} order={o} wide={urgent.length === 1} onAssign={canManage ? () => setAssigningOrder(o) : undefined} />
                ))}
              </div>
            ) : (
              <EmptyState icon={CircleCheck} title="Sin urgencias" body="No hay órdenes urgentes abiertas." />
            )}
          </section>

          {isOwner && (
            <Section title="Gastos por aprobar" action={approvals.length ? <span className="text-label-md text-on-surface-variant">{approvals.length} pendientes</span> : undefined}>
              {approvals.length ? (
                <Card padding="none">
                  <ul className="divide-y divide-outline-variant/50">
                    {approvals.map((o) => (
                      <ApprovalRow key={o.id} order={o} threshold={threshold} onDecide={(mode) => setDeciding({ order: o, mode })} />
                    ))}
                  </ul>
                </Card>
              ) : (
                <EmptyState icon={CircleCheck} title="Nada por aprobar" body={threshold ? `Los gastos de más de ${formatMoney(threshold.amount, threshold.currency)} te llegan aquí.` : undefined} />
              )}
            </Section>
          )}
        </div>

        <div className="grid content-start gap-6 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
          <LoadCard cleanings={weekCleanings} orders={weekOrders} people={people} />
          <Card padding="lg" className="self-start">
            <div className="mb-5 flex items-center justify-between gap-2">
              <h2 className="text-headline-md text-primary">Mantenimiento pendiente</h2>
              {canManage && (
                <LinkButton to="/operacion/mantenimiento/nueva" variant="ghost" size="sm" icon={Plus}>
                  Orden
                </LinkButton>
              )}
            </div>
            {pendingOrders.length ? (
              <ul className="space-y-4">
                {pendingOrders.map((o) => (
                  <PendingOrderRow key={o.id} order={o} />
                ))}
              </ul>
            ) : (
              <p className="text-body-sm text-on-surface-variant">Todo al día.</p>
            )}
          </Card>
        </div>

        <Section
          className="xl:col-span-12"
          title="Limpiezas pendientes"
          action={
            canManage ? (
              <Link to="/operacion/limpieza/nueva" className="inline-flex items-center gap-1 text-label-md text-primary hover:underline">
                Nueva <ArrowRight size={18} aria-hidden />
              </Link>
            ) : undefined
          }
        >
          {pendingCleanings.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pendingCleanings.map((t) => (
                <CleaningCard key={t.id} task={t} onAssign={canManage ? () => setAssigningTask(t) : undefined} />
              ))}
            </div>
          ) : (
            <EmptyState icon={SprayCan} title="Sin limpiezas pendientes" body="Las limpiezas de salida se crean solas cuando termina cada estadía." />
          )}
        </Section>

        {done.length > 0 && (
          <Section className="xl:col-span-12" title="Hechas recientemente">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {done.map((d) => (
                <DoneCard key={d.key} item={d} />
              ))}
            </div>
          </Section>
        )}
      </div>

      {canManage && <Fab icon={SprayCan} label="Crear limpieza" to="/operacion/limpieza/nueva" className="lg:hidden" />}

      {assigningOrder && <AssignOrderModal order={assigningOrder} onClose={() => setAssigningOrder(null)} />}
      {assigningTask && <AssignCleaningModal task={assigningTask} onClose={() => setAssigningTask(null)} />}
      {deciding && <DecisionModal order={deciding.order} mode={deciding.mode} threshold={threshold} onClose={() => setDeciding(null)} />}
      {reporting && <ReportProblemModal onClose={() => setReporting(false)} />}
    </div>
  );
}
