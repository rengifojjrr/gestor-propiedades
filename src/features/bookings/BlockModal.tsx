/** Bloquear fechas de una propiedad (uso del propietario, mantenimiento u otro). El fin no se incluye. */
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import type { Block } from '@/domain/types';
import { addDays, diffDays, formatDate, formatDateLong } from '@/lib/dates';
import { svc } from '@/services';
import { Banner, Button, Modal, Select, TextInput } from '@/ui';
import { BLOCK_REASON_LABEL, withFriendlyDates } from './shared';

export interface BlockModalProps {
  properties: { id: string; name: string }[];
  propertyId: string;
  start: string;
  end?: string;
  onClose: () => void;
}

export function BlockModal({ properties, propertyId: initialProperty, start: initialStart, end: initialEnd, onClose }: BlockModalProps) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [propertyId, setPropertyId] = useState(initialProperty);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd ?? addDays(initialStart, 1));
  const [reason, setReason] = useState<Block['reason']>('owner');
  const [note, setNote] = useState('');
  const valid = !!propertyId && !!start && !!end && end > start;
  const nights = valid ? diffDays(start, end) : 0;

  const submit = async () => {
    if (!valid) return;
    const ok = await run(() => withFriendlyDates(() => svc.bookings.createBlock(actor, { propertyId, start, end, reason, note: note.trim() })), { success: 'Fechas bloqueadas' });
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Bloquear fechas"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!valid} data-testid="guardar-bloqueo">
            Bloquear
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Propiedad" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} options={properties.map((p) => ({ value: p.id, label: p.name }))} />
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="Desde"
            type="date"
            value={start}
            onChange={(e) => {
              const v = e.target.value;
              setStart(v);
              if (v && (!end || end <= v)) setEnd(addDays(v, 1));
            }}
          />
          <TextInput
            label="Hasta (sin incluir)"
            type="date"
            value={end}
            min={start ? addDays(start, 1) : undefined}
            onChange={(e) => setEnd(e.target.value)}
            error={start && end && end <= start ? 'Debe ser después de «Desde»' : undefined}
          />
        </div>
        <p className="text-body-sm text-on-surface-variant">
          El día «hasta» queda libre, como la salida de una reserva: ese día puede entrar otro huésped.
        </p>
        <Select
          label="Motivo"
          value={reason}
          onChange={(e) => setReason(e.target.value as Block['reason'])}
          options={(Object.keys(BLOCK_REASON_LABEL) as Block['reason'][]).map((r) => ({ value: r, label: r === 'other' ? 'Otro motivo' : BLOCK_REASON_LABEL[r] }))}
        />
        <TextInput label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: pintura de la sala" />
        {valid && (
          <Banner tone="info">
            Se bloquean {nights} {nights === 1 ? 'noche' : 'noches'}: desde el {formatDateLong(start)} hasta el {formatDate(addDays(end, -1))} incluido. El {formatDate(end)} queda libre.
          </Banner>
        )}
      </div>
    </Modal>
  );
}
