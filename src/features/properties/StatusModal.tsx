/** «Cambiar estado»: el estado manual de la propiedad (automático, en mantenimiento o bloqueada). */
import { Ban, CheckCircle2, Wrench, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import type { StatusOverride } from '@/domain/types';
import { svc } from '@/services';
import { Button, cn, Modal } from '@/ui';

const OPTIONS: { value: StatusOverride; label: string; description: string; icon: LucideIcon }[] = [
  {
    value: 'none',
    label: 'Disponible (automático)',
    description: 'El estado sale solo de las reservas y los contratos: ocupada o libre.',
    icon: CheckCircle2,
  },
  {
    value: 'maintenance',
    label: 'En mantenimiento',
    description: 'Se está arreglando algo. Aparece en rojo en el panel y en el mapa.',
    icon: Wrench,
  },
  {
    value: 'blocked',
    label: 'Bloqueada',
    description: 'Fuera de servicio por otro motivo (uso del propietario, temporada, etc.).',
    icon: Ban,
  },
];

export function StatusModal({
  property,
  open,
  onClose,
}: {
  property: { id: string; name: string; statusOverride: StatusOverride };
  open: boolean;
  onClose: () => void;
}) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [value, setValue] = useState<StatusOverride>(property.statusOverride);
  const [lastOpen, setLastOpen] = useState(open);
  // Al abrir de nuevo, arranca desde el estado guardado.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setValue(property.statusOverride);
  }

  const save = async () => {
    const ok = await run(() => svc.properties.setPropertyStatus(actor, property.id, value), { success: 'Estado actualizado.' });
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cambiar estado"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy} disabled={value === property.statusOverride} data-testid="guardar-estado">
            Guardar
          </Button>
        </>
      }
    >
      <p className="mb-4 text-body-sm text-on-surface-variant">{property.name}</p>
      <div role="radiogroup" aria-label="Estado de la propiedad" className="space-y-2">
        {OPTIONS.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setValue(o.value)}
              className={cn(
                'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
                selected ? 'border-secondary bg-secondary-container/40' : 'border-outline-variant hover:bg-surface-low',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                  selected ? 'bg-secondary text-on-secondary' : 'bg-surface-container text-primary',
                )}
              >
                <o.icon size={18} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-label-md text-primary">{o.label}</span>
                <span className="mt-0.5 block text-body-sm text-on-surface-variant">{o.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
