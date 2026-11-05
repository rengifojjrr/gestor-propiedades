/** Renovar un contrato: nueva fecha de fin y, si se quiere, nueva renta. */
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { addDays, addMonths, formatDateLong } from '@/lib/dates';
import { formatMoney, parseAmount } from '@/lib/money';
import { svc, type LeaseView } from '@/services';
import { Button, Modal, TextInput } from '@/ui';

export function RenewModal({ lease, onClose }: { lease: LeaseView; onClose: () => void }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [end, setEnd] = useState(addMonths(lease.end, 12));
  const [rent, setRent] = useState('');
  const newRent = rent.trim() ? parseAmount(rent) : undefined;
  const endError = end && end <= lease.end ? 'Debe ser después del fin actual' : undefined;
  const rentError = newRent !== undefined && !(newRent > 0) ? 'Escribe un monto mayor que cero' : undefined;
  const valid = !!end && !endError && !rentError;

  const submit = async () => {
    if (!valid) return;
    const ok = await run(() => svc.leases.renewLease(actor, lease.id, end, newRent), { success: `Contrato renovado hasta el ${formatDateLong(end)}` });
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Renovar ${lease.code}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!valid} data-testid="guardar-renovacion">
            Renovar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-body-md text-on-surface-variant">
          {lease.tenantName} · {lease.propertyName}. Hoy termina el {formatDateLong(lease.end)}.
        </p>
        <TextInput label="Nueva fecha de fin" type="date" value={end} min={addDays(lease.end, 1)} onChange={(e) => setEnd(e.target.value)} error={endError} hint="Último día del contrato (incluido)." />
        <TextInput
          label={`Nueva renta mensual (${lease.currency}, opcional)`}
          inputMode="decimal"
          value={rent}
          onChange={(e) => setRent(e.target.value)}
          placeholder={String(lease.rent)}
          error={rentError}
          hint={`Si la dejas vacía, sigue en ${formatMoney(lease.rent, lease.currency)}.`}
        />
      </div>
    </Modal>
  );
}
