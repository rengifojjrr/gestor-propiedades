/**
 * «Reportar daño» desde la limpieza: qué pasó, foto, urgencia con botones grandes y categoría.
 * Se vuelve incidencia; si es urgente o alta, también una orden de mantenimiento.
 */
import { PackageX, Send, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { MAINTENANCE_CATEGORY_LABEL } from '@/domain/labels';
import { MAINTENANCE_CATEGORIES, type MaintenanceCategory, type Priority } from '@/domain/types';
import { svc, type CleaningTaskView } from '@/services';
import { Button, Modal, PhotoInput, TextArea, TextInput, useToast } from '@/ui';
import { BlobPreview } from '@/features/operations/BlobPreview';
import { CATEGORY_ICON, PriorityPicker, SegmentedChoice } from '@/features/operations/shared';

export function DamageModal({ task, onClose }: { task: CleaningTaskView; onClose: () => void }) {
  const actor = useActor();
  const toast = useToast();
  const [run, busy] = useBusyAction();
  const [kind, setKind] = useState<'damage' | 'missing'>('damage');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MaintenanceCategory>('general');
  const [severity, setSeverity] = useState<Priority>('medium');
  const [photo, setPhoto] = useState<Blob>();
  const [tried, setTried] = useState(false);
  const titleError = tried && title.trim().length < 3 ? 'Escribe qué pasó en pocas palabras' : undefined;

  const submit = async () => {
    setTried(true);
    if (title.trim().length < 3) return;
    const result = await run(() => svc.operations.reportDamage(actor, task.id, { title: title.trim(), description: description.trim(), category, severity, kind }, photo));
    if (!result) return;
    toast.success(kind === 'missing' ? 'Faltante reportado' : 'Daño reportado');
    if (result.order) toast.info(`Se creó la orden ${result.order.priority === 'urgent' ? 'urgente ' : ''}${result.order.code}`);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reportar daño"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="lg" icon={Send} onClick={submit} loading={busy} data-testid="enviar-dano">
            Enviar reporte
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <SegmentedChoice
          name="tipo-dano"
          label="¿Qué es?"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'damage', label: 'Algo dañado', icon: Wrench, testId: 'tipo-dano' },
            { value: 'missing', label: 'Falta algo', icon: PackageX, testId: 'tipo-faltante' },
          ]}
        />
        <TextInput label="¿Qué pasó?" placeholder={kind === 'missing' ? 'Ej. falta el control del aire' : 'Ej. gotea el lavamanos'} value={title} onChange={(e) => setTitle(e.target.value)} error={titleError} data-testid="dano-titulo" />
        <div className="space-y-2">
          <p className="text-label-md text-on-surface">Foto</p>
          {photo ? (
            <BlobPreview blob={photo} alt="Foto del daño" onRemove={() => setPhoto(undefined)} className="w-48" />
          ) : (
            <PhotoInput onPhoto={(b) => setPhoto(b)} label="Tomar foto" sample={{ phase: 'damage', caption: task.propertyName }} testId="foto-dano" />
          )}
        </div>
        <PriorityPicker name="urgencia-dano" value={severity} onChange={setSeverity} testIdPrefix="urgencia" />
        <p className="-mt-3 text-body-sm text-on-surface-variant">Urgente o Alta avisa al técnico al instante.</p>
        <SegmentedChoice
          name="categoria-dano"
          label="Categoría"
          size="md"
          columns={2}
          value={category}
          onChange={setCategory}
          options={MAINTENANCE_CATEGORIES.map((c) => ({ value: c, label: MAINTENANCE_CATEGORY_LABEL[c], icon: CATEGORY_ICON[c] }))}
        />
        <TextArea label="Descripción (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
