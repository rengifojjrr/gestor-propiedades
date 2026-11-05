/**
 * «Subir documento»: PDF o foto (en el teléfono se puede tomar con la cámara), con categoría,
 * propiedad, persona, etiquetas, vencimiento y quién lo puede ver. En la demo vive en este navegador.
 */
import { FileUp, HardDrive, Upload } from 'lucide-react';
import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { DOC_CATEGORY_LABEL, DOC_VISIBILITY_LABEL } from '@/domain/labels';
import { DOC_CATEGORIES, DOC_VISIBILITY, type DocCategory, type DocVisibility } from '@/domain/types';
import { svc } from '@/services';
import { Banner, Button, cn, Modal, Select, TextInput } from '@/ui';
import { formatSize } from './docUi';

const FORM_ID = 'subir-documento';

/** Quién lo ve, sugerido por la categoría (se puede cambiar). */
const SUGGESTED_VISIBILITY: Record<DocCategory, DocVisibility> = {
  contract: 'tenant',
  insurance: 'finance',
  deed: 'owner',
  license: 'team',
  invoice: 'finance',
  inspection: 'team',
  other: 'team',
};

function baseName(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return (i > 0 ? fileName.slice(0, i) : fileName).replace(/[_-]+/g, ' ').trim();
}

/** Móntalo solo mientras está abierto. */
export function UploadDocumentModal({ onClose, defaultPropertyId }: { onClose: () => void; defaultPropertyId?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Subir documento"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={FORM_ID} icon={Upload} loading={busy} data-testid="guardar-documento">
            Subir
          </Button>
        </>
      }
    >
      <UploadForm onDone={onClose} setBusy={setBusy} defaultPropertyId={defaultPropertyId} />
    </Modal>
  );
}

function UploadForm({ onDone, setBusy, defaultPropertyId }: { onDone: () => void; setBusy: (b: boolean) => void; defaultPropertyId?: string }) {
  const actor = useActor();
  const run = useAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const people = useLive(() => svc.people.listPeople(actor).catch(() => []), [actor]);
  const isOwner = actor.user.role === 'owner';
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<DocCategory>('other');
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? '');
  const [personId, setPersonId] = useState('');
  const [tags, setTags] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [visibility, setVisibility] = useState<DocVisibility>('team');
  const [visTouched, setVisTouched] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'file' | 'name', string>>>({});

  const visibilityOptions = DOC_VISIBILITY.filter((v) => isOwner || v !== 'owner').map((v) => ({ value: v, label: DOC_VISIBILITY_LABEL[v] }));

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > svc.documents.MAX_DOC_BYTES) {
      setErrors((e) => ({ ...e, file: 'El archivo pesa más de 15 MB.' }));
      return;
    }
    setFile(f);
    setErrors((e) => ({ ...e, file: undefined }));
    if (!name.trim()) setName(baseName(f.name));
  };

  const chooseCategory = (c: DocCategory) => {
    setCategory(c);
    if (!visTouched) {
      const suggested = SUGGESTED_VISIBILITY[c];
      setVisibility(suggested === 'owner' && !isOwner ? 'finance' : suggested);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!file) next.file = 'Elige un PDF o una foto.';
    if (name.trim().length < 2) next.name = 'Escribe un nombre.';
    setErrors(next);
    if (!file || next.name) return;
    setBusy(true);
    const doc = await run(
      () =>
        svc.documents.uploadDocument(
          actor,
          {
            name: name.trim(),
            category,
            propertyId: propertyId || undefined,
            personId: personId || undefined,
            tags: tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
            expiresOn: expiresOn || undefined,
            visibility,
          },
          file,
          file.name,
        ),
      { success: 'Documento guardado en este navegador.' },
    );
    setBusy(false);
    if (doc) onDone();
  };

  return (
    <form id={FORM_ID} onSubmit={submit} className="space-y-4" noValidate>
      <div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="archivo-documento"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors',
            dragging ? 'border-secondary bg-secondary-container/30' : errors.file ? 'border-error bg-error-container/30' : 'border-outline-variant bg-surface-low hover:border-primary',
          )}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-lowest text-primary shadow-card">
            <FileUp size={22} aria-hidden />
          </span>
          {file ? (
            <>
              <span className="max-w-full truncate text-label-md text-primary">{file.name}</span>
              <span className="text-label-sm font-normal text-on-surface-variant">
                {formatSize(file.size)} · Toca para cambiarlo
              </span>
            </>
          ) : (
            <>
              <span className="text-label-md text-primary">Elegir un PDF o una foto</span>
              <span className="text-label-sm font-normal text-on-surface-variant">En el teléfono puedes tomarla con la cámara. Máximo 15 MB.</span>
            </>
          )}
        </button>
        {errors.file && <p className="mt-1.5 text-label-sm text-error">{errors.file}</p>}
      </div>

      <TextInput label="Nombre" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Ej.: Póliza de seguro 2027" data-testid="nombre-documento" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Categoría"
          value={category}
          onChange={(e) => chooseCategory(e.target.value as DocCategory)}
          options={DOC_CATEGORIES.map((c) => ({ value: c, label: DOC_CATEGORY_LABEL[c] }))}
        />
        <TextInput label="Vence (opcional)" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} hint="Avisa en la campana 30 días antes." />
        <Select
          label="Propiedad"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          options={[{ value: '', label: 'General (sin propiedad)' }, ...(properties ?? []).map((p) => ({ value: p.id, label: p.name }))]}
        />
        <Select
          label="Persona (opcional)"
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          options={[{ value: '', label: 'Ninguna' }, ...(people ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${p.kind === 'tenant' ? 'inquilino' : 'huésped'}` }))]}
        />
      </div>

      <TextInput label="Etiquetas (separadas por comas)" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ej.: seguro, 2027, Miami" />

      <Select
        label="¿Quién lo puede ver?"
        value={visibility}
        onChange={(e) => {
          setVisibility(e.target.value as DocVisibility);
          setVisTouched(true);
        }}
        options={visibilityOptions}
        hint={isOwner ? 'El propietario siempre ve todo.' : 'Los documentos «Solo propietario» los sube el propietario.'}
      />

      <Banner tone="info" icon={HardDrive}>
        En la demo se guardan solo en este navegador.
      </Banner>
    </form>
  );
}
