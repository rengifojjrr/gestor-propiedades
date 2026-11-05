/** Registrar un pago de renta: solo se anota (método y referencia); la app no cobra ni mueve dinero. */
import { Info } from 'lucide-react';
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { PAYMENT_METHOD_LABEL } from '@/domain/labels';
import { lateFeeFor } from '@/domain/rules';
import { PAYMENT_METHODS, type PaymentMethod } from '@/domain/types';
import { formatDate, monthLabel } from '@/lib/dates';
import { formatMoney, parseAmount, round2 } from '@/lib/money';
import { svc, type LeaseView } from '@/services';
import { Banner, Button, Modal, Select, TextInput, Toggle } from '@/ui';
import { LEDGER_STATUS_LABEL } from './shared';

export function PaymentModal({ lease, period: initialPeriod, onClose }: { lease: LeaseView; period?: string; onClose: () => void }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const unpaid = lease.ledger.filter((r) => !r.payment);
  const first = unpaid.find((r) => r.period === initialPeriod) ?? unpaid.find((r) => r.status === 'overdue') ?? unpaid.find((r) => r.status === 'due') ?? unpaid[0];
  const [period, setPeriod] = useState(first?.period ?? '');
  const row = unpaid.find((r) => r.period === period);
  const [amount, setAmount] = useState(String(lease.rent));
  const [paidOn, setPaidOn] = useState(lease.today);
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [reference, setReference] = useState('');
  const [includeLateFee, setIncludeLateFee] = useState(first?.status === 'overdue');

  const value = parseAmount(amount);
  const fee = row && paidOn ? lateFeeFor(lease, row.dueDate, paidOn) : 0;
  const valid = !!row && value > 0 && !!paidOn;

  const submit = async () => {
    if (!valid || !row) return;
    const ok = await run(
      () => svc.leases.recordLeasePayment(actor, lease.id, { period: row.period, amount: round2(value), paidOn, method, reference: reference.trim(), includeLateFee }),
      { success: `Pago de ${monthLabel(row.period).toLowerCase()} registrado` },
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar pago"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="success" onClick={submit} loading={busy} disabled={!valid} data-testid="guardar-pago">
            Registrar pago
          </Button>
        </>
      }
    >
      {unpaid.length === 0 ? (
        <Banner tone="good">No hay meses por pagar: todo está registrado.</Banner>
      ) : (
        <div className="space-y-4">
          <Select
            label="Mes que paga"
            value={period}
            onChange={(e) => {
              const p = e.target.value;
              setPeriod(p);
              setIncludeLateFee(unpaid.find((r) => r.period === p)?.status === 'overdue');
            }}
            options={unpaid.map((r) => ({ value: r.period, label: `${monthLabel(r.period)} · vence ${formatDate(r.dueDate)} · ${LEDGER_STATUS_LABEL[r.status]}` }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label={`Monto (${lease.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && !(value > 0) ? 'Escribe un monto mayor que cero' : undefined} />
            <TextInput label="Pagado el" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Método"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              options={PAYMENT_METHODS.filter((m) => m !== 'channel').map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))}
            />
            <TextInput label="Referencia" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej.: ZL-4821" />
          </div>
          <div className="rounded-md bg-surface-low px-3">
            <Toggle
              label="Cobrar recargo por atraso"
              description={
                fee > 0
                  ? `Con esta fecha corresponde ${formatMoney(fee, lease.currency)} (${row ? `vencía el ${formatDate(row.dueDate)}` : ''}).`
                  : 'Con esta fecha de pago no corresponde recargo (está dentro de la gracia).'
              }
              checked={includeLateFee}
              onChange={setIncludeLateFee}
            />
          </div>
          {row && (
            <p className="text-body-sm text-on-surface-variant">
              Total registrado:{' '}
              <strong className="text-on-surface">
                {formatMoney(value > 0 ? value + (includeLateFee ? fee : 0) : 0, lease.currency)}
              </strong>
              {includeLateFee && fee > 0 ? ` (renta + ${formatMoney(fee, lease.currency)} de recargo)` : ''}
            </p>
          )}
          <Banner tone="info" icon={Info}>
            Solo se registra: la app no cobra ni mueve dinero.
          </Banner>
        </div>
      )}
    </Modal>
  );
}
