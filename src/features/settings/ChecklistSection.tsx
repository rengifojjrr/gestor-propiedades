/** «Checklists de limpieza»: por propiedad, cuartos y tareas que la limpieza marca en cada salida. */
import { ChevronDown, ListChecks, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useAction } from '@/app/hooks';
import { useLive } from '@/data/live';
import type { Checklist } from '@/domain/types';
import { svc } from '@/services';
import { Button, cn, IconButton, Loading, Select } from '@/ui';
import { OwnerOnlyNote, SettingsSection, ToneIconButton, useSettingsPerms } from './SettingsSection';

type Room = Checklist['rooms'][number];

/** Quita tareas vacías y cuartos vacíos; un cuarto sin nombre se llama «General». */
function clean(rooms: Room[]): Room[] {
  return rooms
    .map((r) => ({ name: r.name.trim(), items: r.items.map((i) => i.trim()).filter(Boolean) }))
    .filter((r) => r.name || r.items.length)
    .map((r) => ({ ...r, name: r.name || 'General' }));
}

export function ChecklistSection() {
  const { actor, canManage } = useSettingsPerms();
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const [selected, setSelected] = useState('');
  const propertyId = selected || properties?.[0]?.id || '';
  const checklist = useLive(() => (propertyId ? svc.properties.getChecklist(actor, propertyId) : Promise.resolve(undefined)), [actor, propertyId]);

  return (
    <SettingsSection id="checklists" icon={ListChecks} title="Checklists de limpieza" subtitle="Lo que la limpieza marca en cada salida, cuarto por cuarto. Las tareas nuevas usan la versión guardada.">
      {!canManage && <OwnerOnlyNote>Modo solo mirar.</OwnerOnlyNote>}
      <Select
        label="Propiedad"
        value={propertyId}
        onChange={(e) => setSelected(e.target.value)}
        options={(properties ?? []).map((p) => ({ value: p.id, label: p.name }))}
        className="md:max-w-md"
      />
      <div className="mt-4">
        {checklist && checklist.propertyId === propertyId ? <ChecklistEditor key={propertyId} initial={checklist} canEdit={canManage} /> : <Loading />}
      </div>
    </SettingsSection>
  );
}

function ChecklistEditor({ initial, canEdit }: { initial: Checklist; canEdit: boolean }) {
  const { actor } = useSettingsPerms();
  const run = useAction();
  const [rooms, setRooms] = useState<Room[]>(() => initial.rooms.map((r) => ({ name: r.name, items: [...r.items] })));
  const [saved, setSaved] = useState(() => JSON.stringify(clean(initial.rooms)));
  const [open, setOpen] = useState<number | null>(0);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(clean(rooms)) !== saved;
  const totalItems = rooms.reduce((s, r) => s + r.items.filter((i) => i.trim()).length, 0);

  const updateRoom = (index: number, fn: (r: Room) => Room) => setRooms((list) => list.map((r, i) => (i === index ? fn(r) : r)));
  const addRoom = () => {
    setRooms((list) => [...list, { name: '', items: [''] }]);
    setOpen(rooms.length);
  };

  const save = async () => {
    setSaving(true);
    const result = await run(() => svc.properties.saveChecklist(actor, { id: initial.id, propertyId: initial.propertyId, rooms: clean(rooms) }), { success: 'Checklist guardada.' });
    setSaving(false);
    if (result) {
      setRooms(result.rooms.map((r) => ({ name: r.name, items: [...r.items] })));
      setSaved(JSON.stringify(result.rooms));
    }
  };

  const undo = () => {
    const back = JSON.parse(saved) as Room[];
    setRooms(back);
    setOpen(0);
  };

  return (
    <div className="space-y-3">
      <p className="text-body-sm text-on-surface-variant">
        {rooms.length} {rooms.length === 1 ? 'cuarto' : 'cuartos'} · {totalItems} {totalItems === 1 ? 'tarea' : 'tareas'}
      </p>
      <ul className="space-y-2">
        {rooms.map((room, ri) => {
          const isOpen = open === ri;
          const label = room.name.trim() || 'Cuarto nuevo';
          return (
            <li key={ri} className="rounded-md border border-outline-variant/60">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : ri)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-low"
              >
                <span className="min-w-0">
                  <span className="block truncate text-label-md text-primary">{label}</span>
                  <span className="text-label-sm font-normal text-on-surface-variant">
                    {room.items.filter((i) => i.trim()).length} {room.items.filter((i) => i.trim()).length === 1 ? 'tarea' : 'tareas'}
                  </span>
                </span>
                <ChevronDown size={18} className={cn('shrink-0 text-on-surface-variant transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </button>
              {isOpen && (
                <div className="space-y-2 border-t border-outline-variant/60 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label="Nombre del cuarto"
                      value={room.name}
                      disabled={!canEdit}
                      placeholder="Nombre del cuarto (ej. Cocina)"
                      onChange={(e) => updateRoom(ri, (r) => ({ ...r, name: e.target.value }))}
                      className="h-11 min-w-0 flex-1 rounded-md border border-outline-variant bg-surface-lowest px-3 text-label-md text-primary focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none disabled:opacity-60"
                    />
                    {canEdit && <ToneIconButton icon={Trash2} tone="danger" label={`Quitar el cuarto «${label}»`} onClick={() => setRooms((list) => list.filter((_, i) => i !== ri))} />}
                  </div>
                  <ol className="space-y-2 pl-1">
                    {room.items.map((item, ii) => (
                      <li key={ii} className="flex items-center gap-2">
                        <span className="w-5 shrink-0 text-right text-label-sm text-on-surface-variant">{ii + 1}.</span>
                        <input
                          aria-label={`Tarea ${ii + 1} de ${label}`}
                          value={item}
                          disabled={!canEdit}
                          placeholder="Tarea (ej. Limpiar la nevera)"
                          onChange={(e) => updateRoom(ri, (r) => ({ ...r, items: r.items.map((x, k) => (k === ii ? e.target.value : x)) }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              updateRoom(ri, (r) => ({ ...r, items: [...r.items.slice(0, ii + 1), '', ...r.items.slice(ii + 1)] }));
                            }
                          }}
                          className="h-10 min-w-0 flex-1 rounded-md border border-outline-variant bg-surface-lowest px-3 text-body-sm text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/15 focus:outline-none disabled:opacity-60"
                        />
                        {canEdit && <IconButton icon={X} size="sm" label={`Quitar la tarea ${ii + 1}`} onClick={() => updateRoom(ri, (r) => ({ ...r, items: r.items.filter((_, k) => k !== ii) }))} />}
                      </li>
                    ))}
                  </ol>
                  {canEdit && (
                    <Button size="sm" variant="ghost" icon={Plus} onClick={() => updateRoom(ri, (r) => ({ ...r, items: [...r.items, ''] }))}>
                      Agregar tarea
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="tonal" icon={Plus} onClick={addRoom}>
            Agregar cuarto
          </Button>
          <span className="flex-1" />
          {dirty && (
            <Button variant="ghost" icon={RotateCcw} onClick={undo}>
              Deshacer
            </Button>
          )}
          <Button icon={Save} onClick={save} disabled={!dirty} loading={saving} data-testid="guardar-checklist">
            Guardar checklist
          </Button>
        </div>
      )}
    </div>
  );
}
