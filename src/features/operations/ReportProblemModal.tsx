/**
 * «Reportar problema» del equipo (propietario, administración y atención al cliente).
 * Se vuelve incidencia; si es urgente o alta, también orden de mantenimiento.
 */
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import type { Incident, MaintenanceCategory, Priority } from '@/domain/types';
import { svc } from '@/services';
import { Button, Modal, PhotoInput, Select, TextArea, TextInput, useToast } from '@/ui';
import { CATEGORY_OPTIONS, PriorityPicker, SegmentedChoice } from './shared';
import { BlobPreview } from './BlobPreview';

export function ReportProblemModal({ onClose, defaultPropertyId }: { onClose: () => void; defaultPropertyId?: string }) {
  const actor = useActor();
  const toast = useToast();
  const [run, busy] = useBusyAction();
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MaintenanceCategory>('general');
  const [severity, setSeverity] = useState<Priority>('medium');
  const [kind, setKind] = useState<Incident['kind']>('problem');
  const [photo, setPhoto] = useState<Blob>();
  const [tried, setTried] = useState(false);

  const titleError = tried && title.trim().length < 3 ? 'Describe el problema en pocas palabras' : undefined;
  const propertyError = tried && !propertyId ? 'Elige una propiedad' : undefined;

  const submit = async () => {
    setTried(true);
    if (!propertyId || title.trim().length < 3) return;
    const result = await run(() => svc.operations.createIncident(actor, { propertyId, title: title.trim(), description: description.trim(), category, severity, source: 'team', kind, photo }));
    if (!result) return;
    toast.success('Problema reportado');
    if (result.order) toast.info(`Se creó la orden ${result.order.priority === 'urgent' ? 'urgente ' : ''}${result.order.code}`);
    else toast.info('Quedó en Incidencias para asignarlo');
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reportar problema"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} data-testid="enviar-problema">
            Reportar
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Select
          label="Propiedad"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          placeholder="Elige una propiedad"
          options={(properties ?? []).map((p) => ({ value: p.id, label: p.name }))}
          error={propertyError}
        />
        <TextInput label="¿Qué pasa?" placeholder="Ej. el portón no abre" value={title} onChange={(e) => setTitle(e.target.value)} error={titleError} />
        <TextArea label="Detalles (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        <div className="grid gap-4 md:grid-cols-2">
          <Select label="Categoría" value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)} options={CATEGORY_OPTIONS} />
          <SegmentedChoice
            name="tipo-problema"
            label="Tipo"
            size="md"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'problem', label: 'Problema' },
              { value: 'damage', label: 'Daño' },
              { value: 'missing', label: 'Faltante' },
            ]}
          />
        </div>
        <PriorityPicker name="urgencia-problema" value={severity} onChange={setSeverity} />
        <p className="text-body-sm text-on-surface-variant">Si es urgente o alta, se crea sola una orden de mantenimiento para el proveedor de la categoría.</p>
        <div className="space-y-2">
          <p className="text-label-md text-on-surface">Foto (opcional)</p>
          {photo ? (
            <BlobPreview blob={photo} alt="Foto del problema" onRemove={() => setPhoto(undefined)} />
          ) : (
            <PhotoInput onPhoto={(b) => setPhoto(b)} variant="secondary" size="md" sample={{ phase: 'report', caption: title || 'Problema' }} />
          )}
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
