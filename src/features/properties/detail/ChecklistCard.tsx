/** Resumen de la checklist de limpieza de la propiedad (se edita en Ajustes). */
import { ListChecks, Settings } from 'lucide-react';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { svc } from '@/services';
import { Card, CardHeader, LinkButton } from '@/ui';

export function ChecklistCard({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const actor = useActor();
  const checklist = useLive(() => svc.properties.getChecklist(actor, propertyId).catch(() => null), [actor, propertyId]);
  if (!checklist) return null;
  const items = checklist.rooms.reduce((n, r) => n + r.items.length, 0);
  return (
    <Card padding="lg">
      <CardHeader
        title="Checklist de limpieza"
        subtitle={checklist.rooms.length ? `${checklist.rooms.length} ${checklist.rooms.length === 1 ? 'área' : 'áreas'} · ${items} ${items === 1 ? 'tarea' : 'tareas'}` : 'Todavía no tiene checklist.'}
        action={<ListChecks size={20} className="text-primary" aria-hidden />}
      />
      {checklist.rooms.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {checklist.rooms.map((r) => (
            <li key={r.name} className="rounded-full bg-surface-low px-3 py-1.5 text-label-sm text-on-surface">
              {r.name} <span className="text-on-surface-variant">· {r.items.length}</span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <LinkButton to="/ajustes" variant="secondary" size="sm" icon={Settings} className="mt-4">
          Editar en Ajustes
        </LinkButton>
      )}
    </Card>
  );
}
