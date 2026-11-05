/**
 * «Plantillas de mensajes» (ES/EN con variables que se rellenan solas): lista con vista previa,
 * editor con leyenda de variables (toca para insertar), crear y borrar las que no son básicas.
 */
import { ArrowRight, Braces, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import type { Lang, Template } from '@/domain/types';
import { svc } from '@/services';
import { Badge, Button, cn, Modal, TextArea, TextInput, useConfirm } from '@/ui';
import { slugify, templatePreview } from './text';

function TemplateEditor({ template, templates, onClose }: { template: Template | null; templates: Template[]; onClose: () => void }) {
  const actor = useActor();
  const confirm = useConfirm();
  const [run, busy] = useBusyAction();
  const [name, setName] = useState(template?.name ?? '');
  const [es, setEs] = useState(template?.body.es ?? '');
  const [en, setEn] = useState(template?.body.en ?? '');
  const [target, setTarget] = useState<Lang>('es');
  const [tried, setTried] = useState(false);
  const esRef = useRef<HTMLTextAreaElement>(null);
  const enRef = useRef<HTMLTextAreaElement>(null);
  const isNew = !template;
  const errors = {
    name: name.trim().length < 2 ? 'Ponle un nombre (mínimo 2 letras).' : undefined,
    es: !es.trim() ? 'Escribe el texto en español.' : undefined,
    en: !en.trim() ? 'Escribe el texto en inglés.' : undefined,
  };
  const valid = !errors.name && !errors.es && !errors.en;

  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const el = target === 'es' ? esRef.current : enRef.current;
    const value = target === 'es' ? es : en;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    (target === 'es' ? setEs : setEn)(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    setTried(true);
    if (!valid) return;
    const id = template?.id ?? svc.people.newTemplateId();
    let key = template?.key ?? slugify(name);
    if (isNew && templates.some((x) => x.key === key)) key = `${key}-${id.slice(-4).toLowerCase()}`;
    const saved = await run(
      () => svc.people.saveTemplate(actor, { id, key, name: name.trim(), body: { es: es.trim(), en: en.trim() }, builtIn: template?.builtIn ?? false }),
      { success: isNew ? 'Plantilla creada' : 'Plantilla guardada' },
    );
    if (saved) onClose();
  };

  const remove = async () => {
    if (!template) return;
    const ok = await confirm({ title: `¿Borrar «${template.name}»?`, body: 'Los mensajes ya enviados no cambian. Esto no se puede deshacer.', confirmLabel: 'Borrar', danger: true });
    if (!ok) return;
    const done = await run(
      async () => {
        await svc.people.deleteTemplate(actor, template.id);
        return true;
      },
      { success: 'Plantilla borrada' },
    );
    if (done) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? 'Crear plantilla' : `Editar «${template.name}»`}
      footer={
        <>
          {template && !template.builtIn && (
            <button
              type="button"
              onClick={remove}
              className="mr-auto inline-flex h-11 items-center gap-2 rounded-md px-4 text-label-md font-semibold text-error transition-colors hover:bg-error-container"
            >
              <Trash2 size={18} aria-hidden />
              Borrar
            </button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy} data-testid="guardar-plantilla">
            {isNew ? 'Crear plantilla' : 'Guardar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {template?.builtIn && (
          <p className="rounded-md bg-info-container px-3 py-2 text-body-sm text-on-info-container">Plantilla básica: puedes editarla, pero no borrarla.</p>
        )}
        <TextInput label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Recordatorio de basura" error={tried ? errors.name : undefined} maxLength={60} />
        <TextArea
          ref={esRef}
          label="Texto en español"
          rows={4}
          value={es}
          onChange={(e) => setEs(e.target.value)}
          onFocus={() => setTarget('es')}
          error={tried ? errors.es : undefined}
          placeholder="¡Hola {{guest_name}}! …"
        />
        <TextArea
          ref={enRef}
          label="Texto en inglés"
          rows={4}
          value={en}
          onChange={(e) => setEn(e.target.value)}
          onFocus={() => setTarget('en')}
          error={tried ? errors.en : undefined}
          placeholder="Hi {{guest_name}}! …"
        />
        <div className="rounded-md bg-surface-low p-3">
          <p className="mb-2 flex items-center gap-2 text-label-md text-on-surface">
            <Braces size={16} aria-hidden />
            Datos que se rellenan solos
          </p>
          <p className="mb-3 text-body-sm text-on-surface-variant">
            Toca uno para ponerlo en el texto en <strong>{target === 'es' ? 'español' : 'inglés'}</strong>, donde está el cursor.
          </p>
          <ul className="flex flex-wrap gap-2">
            {svc.people.TEMPLATE_VARIABLES.map((v) => (
              <li key={v.key}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(v.key)}
                  title={`Insertar {{${v.key}}}`}
                  className="flex flex-col items-start rounded-md border border-outline-variant bg-surface-lowest px-2.5 py-1.5 text-left transition-colors hover:border-primary"
                >
                  <span className="text-label-sm text-primary">{v.label}</span>
                  <code className="text-label-sm font-normal text-on-surface-variant">{`{{${v.key}}}`}</code>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

export function TemplatesCard({ canWrite }: { canWrite: boolean }) {
  const actor = useActor();
  const templates = useLive(() => svc.people.listTemplates(actor), [actor]);
  const [editing, setEditing] = useState<Template | 'new' | null>(null);

  return (
    <section
      id="plantillas"
      aria-label="Plantillas de mensajes"
      className="scroll-mt-24 rounded-lg border border-outline-variant/50 bg-surface-lowest/80 p-5 shadow-card backdrop-blur md:p-6"
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-headline-md text-primary">Plantillas de mensajes</h2>
        <Sparkles size={20} className="text-primary" aria-hidden />
      </div>
      <p className="mb-4 text-body-sm text-on-surface-variant">En español e inglés. Los datos de cada huésped se rellenan solos.</p>
      <ul className="space-y-3">
        {templates?.map((tpl) => {
          const inner = (
            <>
              <span className="mb-1.5 flex items-start justify-between gap-2">
                <span className="text-label-md font-bold text-primary">{tpl.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {tpl.builtIn && <Badge tone="neutral">Básica</Badge>}
                  {canWrite && <ArrowRight size={16} className="text-on-surface-variant group-hover:text-primary" aria-hidden />}
                </span>
              </span>
              <span className="line-clamp-2 text-body-sm text-on-surface-variant">«{templatePreview(tpl.body.es)}»</span>
            </>
          );
          const cls = 'group block w-full rounded-md border border-outline-variant bg-surface-lowest p-4 text-left transition-colors';
          return (
            <li key={tpl.id}>
              {canWrite ? (
                <button type="button" onClick={() => setEditing(tpl)} className={cn(cls, 'hover:border-primary')} aria-label={`Editar la plantilla ${tpl.name}`}>
                  {inner}
                </button>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {canWrite && (
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-outline-variant py-3 text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          data-testid="crear-plantilla"
        >
          <Plus size={18} aria-hidden />
          Crear plantilla
        </button>
      )}
      {editing && (
        <TemplateEditor key={editing === 'new' ? 'new' : editing.id} template={editing === 'new' ? null : editing} templates={templates ?? []} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}
