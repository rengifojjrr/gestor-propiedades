/**
 * «Resolver» una orden desde el equipo: foto de lo resuelto, costo real, materiales y nota.
 * El costo se vuelve gasto de la propiedad (o queda por aprobar si supera el umbral).
 */
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { formatMoney } from '@/lib/money';
import { svc, type OrderView } from '@/services';
import { Button, Modal, PhotoInput, TextArea, TextInput, useToast } from '@/ui';
import { fromRows, materialsTotal, MaterialsEditor, toRows, type MaterialRow } from './MaterialsEditor';
import { numberOrUndefined, PhotoGrid, Requirements } from './shared';

/** Aviso según cómo quedó el gasto. */
export function resolvedMessage(expenseStatus: 'posted' | 'pending_approval', actualCost: number): string {
  if (expenseStatus === 'pending_approval') return 'Queda pendiente de la aprobación del propietario';
  return actualCost > 0 ? 'Gasto registrado en las finanzas' : 'Orden resuelta sin costo';
}

export function ResolveOrderModal({ order, onClose }: { order: OrderView; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [run, busy] = useBusyAction();
  const [cost, setCost] = useState(order.actualCost != null ? String(order.actualCost) : '');
  const [rows, setRows] = useState<MaterialRow[]>(() => toRows(order.materials));
  const [note, setNote] = useState('');
  const resolvedPhotos = order.photos.filter((p) => p.phase === 'resolved').map((p) => p.fileId);
  const actualCost = numberOrUndefined(cost);
  const costOk = actualCost != null && actualCost >= 0;
  const ready = resolvedPhotos.length > 0 && costOk;
  const materials = fromRows(rows);

  const submit = async () => {
    if (!ready || actualCost == null) return;
    const result = await run(() => svc.operations.resolveOrder(actor, order.id, { actualCost, materials, note: note.trim() }));
    if (!result) return;
    if (result.expenseStatus === 'pending_approval') toast.info(resolvedMessage(result.expenseStatus, actualCost));
    else toast.success(resolvedMessage(result.expenseStatus, actualCost));
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Resolver ${order.code}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="success" onClick={submit} loading={busy} disabled={!ready}>
            Marcar como resuelta
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-2" aria-label="Foto de lo resuelto">
          <p className="text-label-md text-on-surface">Foto de lo resuelto</p>
          <PhotoGrid fileIds={resolvedPhotos} alt="Foto de lo resuelto" size="sm" />
          <PhotoInput
            onPhoto={async (blob) => {
              await run(() => svc.operations.addOrderPhoto(actor, order.id, 'resolved', blob));
            }}
            variant={resolvedPhotos.length ? 'secondary' : 'primary'}
            size="md"
            label={resolvedPhotos.length ? 'Otra foto' : 'Tomar foto'}
            sample={{ phase: 'resolved', caption: order.propertyName }}
          />
        </section>
        <TextInput
          label={`Costo real (${order.currency})`}
          inputMode="decimal"
          placeholder="0"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          hint={[order.estimate != null ? `Presupuesto: ${formatMoney(order.estimate, order.currency)}` : '', materialsTotal(materials) > 0 ? `Materiales: ${formatMoney(materialsTotal(materials), order.currency)}` : ''].filter(Boolean).join(' · ') || undefined}
          error={cost && !costOk ? 'Escribe un número (0 o más)' : undefined}
        />
        <div className="space-y-2">
          <p className="text-label-md text-on-surface">Materiales</p>
          <MaterialsEditor rows={rows} onChange={setRows} currency={order.currency} />
        </div>
        <TextArea label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        <Requirements
          items={[
            { ok: resolvedPhotos.length > 0, label: 'Al menos 1 foto de lo resuelto' },
            { ok: costOk, label: 'El costo real' },
          ]}
        />
      </div>
    </Modal>
  );
}
