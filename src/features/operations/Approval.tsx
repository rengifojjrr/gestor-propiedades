/**
 * Aprobación de gastos por encima del umbral: solo el propietario decide (con nota).
 * Administración y el resto solo ven en qué quedó.
 */
import { Ban, CircleCheck, Hourglass } from 'lucide-react';
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { formatMoney } from '@/lib/money';
import { svc, type OrderView } from '@/services';
import { Button, cn, Modal, Money, TextArea } from '@/ui';
import { stamp, useOpsAccess } from './shared';

export interface Threshold {
  amount: number;
  currency: string;
}

/** Monto que se está aprobando (el del gasto real si ya se resolvió, si no el presupuesto). */
export function approvalAmount(o: OrderView): number | undefined {
  return o.approval.amount ?? o.estimate;
}

export function DecisionModal({ order, mode, threshold, onClose }: { order: OrderView; mode: 'approve' | 'reject'; threshold?: Threshold; onClose: () => void }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [note, setNote] = useState('');
  const amount = approvalAmount(order);
  const approve = mode === 'approve';
  const submit = async () => {
    const done = await run(() => (approve ? svc.operations.approveOrder(actor, order.id, note.trim()) : svc.operations.rejectOrder(actor, order.id, note.trim())), {
      success: approve ? 'Gasto aprobado' : 'Gasto rechazado',
    });
    if (done) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={approve ? 'Aprobar gasto' : 'Rechazar gasto'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={approve ? 'success' : 'danger'} onClick={submit} loading={busy} data-testid={approve ? 'confirmar-aprobar' : 'confirmar-rechazar'}>
            {approve ? 'Aprobar' : 'Rechazar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-md bg-surface-low p-4">
          <p className="text-label-sm uppercase text-on-surface-variant">
            {order.code} · {order.propertyName}
          </p>
          <p className="mt-1 text-label-md text-primary">{order.title}</p>
          {amount != null && (
            <p className="mt-2 text-headline-lg text-primary">
              <Money amount={amount} currency={order.currency} />
            </p>
          )}
          {threshold && <p className="text-body-sm text-on-surface-variant">Supera el límite de {formatMoney(threshold.amount, threshold.currency)} para gastos sin aprobación.</p>}
        </div>
        <TextArea
          label={approve ? 'Nota (opcional)' : '¿Por qué lo rechazas?'}
          hint={approve ? undefined : 'Lo verán administración y el técnico.'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </div>
    </Modal>
  );
}

/** Recuadro de aprobación de una orden (detalle de la orden). */
export function ApprovalBox({ order, threshold }: { order: OrderView; threshold?: Threshold }) {
  const { isOwner } = useOpsAccess();
  const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
  const a = order.approval;
  const amount = approvalAmount(order);
  if (a.status === 'not_required')
    return (
      <p className="text-body-sm text-on-surface-variant">
        No necesita aprobación{threshold ? ` (gastos de hasta ${formatMoney(threshold.amount, threshold.currency)})` : ''}.
      </p>
    );
  const tone = a.status === 'pending' ? 'bg-warning-container text-on-warning-container' : a.status === 'approved' ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container';
  const Icon = a.status === 'pending' ? Hourglass : a.status === 'approved' ? CircleCheck : Ban;
  return (
    <div className={cn('rounded-md p-4', tone)} data-testid="aprobacion">
      <div className="flex items-start gap-3">
        <Icon size={22} className="mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-label-md">
            {a.status === 'pending' ? 'Gasto por aprobar' : a.status === 'approved' ? 'Gasto aprobado por el propietario' : 'Gasto rechazado por el propietario'}
            {amount != null && order.canSeeCost && (
              <>
                {' · '}
                <Money amount={amount} currency={order.currency} />
              </>
            )}
          </p>
          {a.status === 'pending' && (
            <p className="mt-1 text-body-sm">
              {threshold ? `Supera el límite de ${formatMoney(threshold.amount, threshold.currency)}. ` : ''}
              {isOwner ? 'Tú decides si se hace.' : 'Espera la decisión del propietario.'}
            </p>
          )}
          {a.decidedAt && <p className="mt-1 text-body-sm">{stamp(a.decidedAt, order.timezone)}</p>}
          {a.note && <p className="mt-1 text-body-sm">«{a.note}»</p>}
        </div>
      </div>
      {a.status === 'pending' && isOwner && (
        <div className="mt-3 flex gap-2 sm:max-w-sm">
          <Button variant="success" icon={CircleCheck} className="flex-1" onClick={() => setDeciding('approve')} data-testid="aprobar-gasto">
            Aprobar
          </Button>
          <Button variant="secondary" icon={Ban} className="flex-1" onClick={() => setDeciding('reject')} data-testid="rechazar-gasto">
            Rechazar
          </Button>
        </div>
      )}
      {deciding && <DecisionModal order={order} mode={deciding} threshold={threshold} onClose={() => setDeciding(null)} />}
    </div>
  );
}
