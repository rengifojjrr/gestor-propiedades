/** Detalle de un movimiento (hoja desde abajo en el teléfono) con «Aprobar» y «Anular» según el rol. */
import { Ban, Check } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { PAYMENT_METHOD_LABEL } from '@/domain/labels';
import { formatDate, formatDateTime } from '@/lib/dates';
import { formatMoney, formatNumber } from '@/lib/money';
import { svc, type TransactionView } from '@/services';
import { Button, cn, KeyValue, Modal, useConfirm } from '@/ui';
import { TX_SOURCE_LABEL, TxIcon, TxStatusBadge, useFinancePerms } from './shared';

/** Móntalo solo mientras está abierto. */
export function TxDetailModal({ tx, base, onClose }: { tx: TransactionView; base: string; onClose: () => void }) {
  const actor = useActor();
  const run = useAction();
  const confirm = useConfirm();
  const perms = useFinancePerms();
  const [busy, setBusy] = useState<'approve' | 'void' | null>(null);
  const income = tx.type === 'income';
  const canVoid = perms.canWrite && tx.status !== 'void';
  const canApprove = perms.canApprove && tx.status === 'pending_approval';

  const approve = async () => {
    setBusy('approve');
    const ok = await run(() => svc.finance.approveTransaction(actor, tx.id), { success: 'Gasto aprobado: ya suma en las cuentas.' });
    setBusy(null);
    if (ok) onClose();
  };

  const voidTx = async () => {
    const yes = await confirm({
      title: '¿Anular este movimiento?',
      body: `«${tx.description}» (${formatMoney(tx.amount, tx.currency)}) deja de sumar en las cuentas. No se borra: queda anulado y en la auditoría.`,
      confirmLabel: 'Anular',
      danger: true,
    });
    if (!yes) return;
    setBusy('void');
    await run(() => svc.finance.voidTransaction(actor, tx.id), { success: 'Movimiento anulado.' });
    setBusy(null);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={income ? 'Ingreso registrado' : 'Gasto registrado'}
      footer={
        <>
          {canVoid && (
            <span className="mr-auto">
              <Button variant="secondary" icon={Ban} onClick={voidTx} loading={busy === 'void'}>
                Anular
              </Button>
            </span>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {canApprove && (
            <Button variant="success" icon={Check} onClick={approve} loading={busy === 'approve'}>
              Aprobar
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex items-start gap-3">
        <TxIcon type={tx.type} />
        <div className="min-w-0 flex-1">
          <p className="text-label-md text-primary">{tx.description}</p>
          <p className="text-body-sm text-on-surface-variant">{tx.propertyName}</p>
        </div>
      </div>
      <div className="mb-4 rounded-md bg-surface-low px-4 py-3">
        <p className={cn('text-headline-lg', income ? 'text-secondary' : 'text-error')}>
          {income ? '+' : '−'}
          {formatMoney(tx.amount, tx.currency)}
        </p>
        {tx.currency !== base && (
          <p className="text-body-sm text-on-surface-variant">
            ≈ {formatMoney(tx.amountBase, base)} · 1 {tx.currency} = {formatNumber(tx.fxRate, 6)} {base}
          </p>
        )}
      </div>
      <dl>
        <KeyValue label="Estado" value={<TxStatusBadge status={tx.status} />} />
        <KeyValue label="Fecha" value={formatDate(tx.date, { year: true })} />
        <KeyValue label="Categoría" value={tx.categoryLabel} />
        <KeyValue label="Origen" value={TX_SOURCE_LABEL[tx.source.kind]} />
        <KeyValue label="Método" value={tx.method ? PAYMENT_METHOD_LABEL[tx.method] : '—'} />
        <KeyValue label="Referencia" value={<span className="break-all">{tx.reference || '—'}</span>} />
        <KeyValue label="Registrado el" value={formatDateTime(tx.createdAt)} />
      </dl>
      {tx.status === 'pending_approval' && (
        <p className="mt-3 text-body-sm text-on-warning-container">Pendiente de la aprobación del propietario: todavía no suma en las cuentas.</p>
      )}
    </Modal>
  );
}
