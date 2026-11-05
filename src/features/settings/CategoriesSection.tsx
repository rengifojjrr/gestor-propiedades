/** «Categorías de gasto»: las de siempre y las propias (aparecen al registrar un gasto). */
import { Plus, Tags, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/app/hooks';
import { EXPENSE_CATEGORY_LABEL } from '@/domain/labels';
import type { Settings } from '@/domain/types';
import { svc } from '@/services';
import { Button, TextInput, useConfirm } from '@/ui';
import { OwnerOnlyNote, SettingsSection, useSettingsPerms } from './SettingsSection';

/** «Jardinería y poda» → «custom_jardineria_y_poda». */
function keyFor(label: string, taken: Set<string>): string {
  const slug =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'categoria';
  let key = `custom_${slug}`;
  for (let n = 2; taken.has(key); n++) key = `custom_${slug}_${n}`;
  return key;
}

export function CategoriesSection({ settings }: { settings: Settings }) {
  const { actor, canManage } = useSettingsPerms();
  const run = useAction();
  const confirm = useConfirm();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const custom = settings.customExpenseCategories;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const text = label.trim();
    if (text.length < 2) return setError('Escribe un nombre de al menos 2 letras.');
    const all = [...Object.values(EXPENSE_CATEGORY_LABEL), ...custom.map((c) => c.label)].map((l) => l.toLowerCase());
    if (all.includes(text.toLowerCase())) return setError('Ya existe una categoría con ese nombre.');
    setError(undefined);
    setSaving(true);
    const taken = new Set([...Object.keys(EXPENSE_CATEGORY_LABEL), ...custom.map((c) => c.key)]);
    const ok = await run(() => svc.system.saveCustomCategories(actor, [...custom, { key: keyFor(text, taken), label: text }]), { success: `Categoría «${text}» agregada.` });
    setSaving(false);
    if (ok) setLabel('');
  };

  const remove = async (key: string, name: string) => {
    const ok = await confirm({
      title: `¿Quitar «${name}»?`,
      body: 'Ya no aparecerá al registrar gastos. Los movimientos que ya la usan se conservan, pero mostrarán su clave en lugar del nombre.',
      confirmLabel: 'Quitar',
      danger: true,
    });
    if (ok) await run(() => svc.system.saveCustomCategories(actor, custom.filter((c) => c.key !== key)), { success: 'Categoría quitada.' });
  };

  return (
    <SettingsSection id="categorias" icon={Tags} title="Categorías de gasto" subtitle="Las propias aparecen al registrar un gasto y en los reportes.">
      {!canManage && <OwnerOnlyNote>Modo solo mirar.</OwnerOnlyNote>}
      <p className="mb-2 text-label-md text-on-surface">De siempre</p>
      <ul className="mb-5 flex flex-wrap gap-2">
        {Object.entries(EXPENSE_CATEGORY_LABEL).map(([key, name]) => (
          <li key={key} className="rounded-full bg-surface-container px-3 py-1.5 text-label-sm text-on-surface-variant">
            {name}
          </li>
        ))}
      </ul>
      <p className="mb-2 text-label-md text-on-surface">Propias</p>
      {custom.length === 0 ? (
        <p className="mb-4 text-body-sm text-on-surface-variant">Todavía no hay categorías propias.</p>
      ) : (
        <ul className="mb-4 flex flex-wrap gap-2">
          {custom.map((c) => (
            <li key={c.key} className="inline-flex items-center gap-1 rounded-full bg-secondary-container py-1 pr-1 pl-3 text-label-sm text-on-secondary-container">
              {c.label}
              {canManage && (
                <button
                  type="button"
                  aria-label={`Quitar la categoría «${c.label}»`}
                  title="Quitar"
                  onClick={() => remove(c.key, c.label)}
                  className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-surface-lowest/60"
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="sm:w-72">
            <TextInput aria-label="Nueva categoría" placeholder="Ej.: Jardinería, Lavandería…" value={label} onChange={(e) => setLabel(e.target.value)} aria-invalid={!!error} />
            {error && <p className="mt-1.5 text-label-sm text-error">{error}</p>}
          </div>
          <Button type="submit" icon={Plus} loading={saving} variant="secondary">
            Agregar categoría
          </Button>
        </form>
      )}
    </SettingsSection>
  );
}
