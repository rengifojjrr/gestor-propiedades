/**
 * Documentos (Stitch «Documents»): contratos, seguros, escrituras, licencias, facturas e inspecciones
 * por propiedad y por persona, con vencimientos. Cumplimiento arriba, lista o tabla, subir y abrir.
 */
import { BellRing, ExternalLink, FileText, HardDrive, Trash2, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { downloadFile, useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { DOC_CATEGORY_LABEL } from '@/domain/labels';
import { DOC_CATEGORIES, type DocCategory } from '@/domain/types';
import { formatPercent } from '@/lib/money';
import { svc, type DocStatus, type DocumentView } from '@/services';
import { Button, Card, cn, EmptyState, ErrorState, IconButton, Loading, PageHeader, SearchInput, Select, useConfirm } from '@/ui';
import { ToneIconButton } from '@/features/settings/SettingsSection';
import { DocIcon, expiryDate, ExpiryBadge, VisibilityTag } from './docUi';
import { UploadDocumentModal } from './UploadDocumentModal';

export default function DocumentsPage() {
  const actor = useActor();
  const run = useAction();
  const confirm = useConfirm();
  const role = actor.user.role;
  const canWrite = (role === 'owner' || role === 'admin') && !actor.readOnly;
  const [propertyId, setPropertyId] = useState('');
  const [category, setCategory] = useState<DocCategory | ''>('');
  const [status, setStatus] = useState<DocStatus | ''>('');
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const res = useLiveResult(
    () => svc.documents.listDocuments(actor, { propertyId: propertyId || undefined, category: category || undefined, status: status || undefined, q: q || undefined }),
    [actor, propertyId, category, status, q],
  );
  const docs = res.data;
  const stats = useLive(() => svc.documents.complianceStats(actor), [actor]);
  const properties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const filtered = !!(propertyId || category || status || q);

  const open = async (d: DocumentView) => {
    // La ventana se abre dentro del toque (si no, el navegador la bloquea) y luego recibe el archivo.
    const win = window.open('', '_blank');
    setOpeningId(d.id);
    const file = await run(() => svc.documents.openDocument(actor, d.id));
    setOpeningId(null);
    if (!file) {
      win?.close();
      return;
    }
    const url = URL.createObjectURL(file.blob);
    if (win) win.location.href = url;
    else downloadFile(file.blob, file.name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const remove = async (d: DocumentView) => {
    const ok = await confirm({
      title: '¿Borrar este documento?',
      body: `«${d.name}» y su archivo se borran de este navegador. Queda en la auditoría.`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (ok) await run(() => svc.documents.deleteDocument(actor, d.id), { success: 'Documento borrado.' });
  };

  const toggleStatus = (s: DocStatus) => setStatus((cur) => (cur === s ? '' : s));

  return (
    <div data-testid="documentos" className="space-y-6">
      <PageHeader
        title="Documentos"
        subtitle="Contratos, seguros, licencias y facturas de todo el portafolio, con sus vencimientos."
        actions={
          canWrite && (
            <Button icon={Upload} onClick={() => setUploading(true)} data-testid="subir-documento">
              Subir documento
            </Button>
          )
        }
      />

      {/* Cumplimiento (tocar una tarjeta filtra la lista) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatButton
          label="Al día"
          value={stats ? formatPercent(stats.activeCompliance) : '—'}
          hint={stats ? `${stats.valid + stats.expiring} de ${stats.withExpiry} con vencimiento` : undefined}
          accent="good"
          active={status === 'valid'}
          onClick={() => toggleStatus('valid')}
        />
        <StatButton
          label="Por vencer (30 días)"
          value={stats ? `${stats.expiring} ${stats.expiring === 1 ? 'documento' : 'documentos'}` : '—'}
          hint="Avisan en la campana"
          accent="warn"
          active={status === 'expiring'}
          onClick={() => toggleStatus('expiring')}
        />
        <StatButton
          label="Vencidos"
          value={stats ? `${stats.expired} ${stats.expired === 1 ? 'documento' : 'documentos'}` : '—'}
          hint={stats?.expired ? 'Renuévalos cuanto antes' : 'Ninguno vencido'}
          accent="bad"
          active={status === 'expired'}
          onClick={() => toggleStatus('expired')}
        />
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1.4fr]">
        <Select
          aria-label="Propiedad"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          options={[{ value: '', label: 'Todas las propiedades' }, ...(properties ?? []).map((p) => ({ value: p.id, label: p.name }))]}
        />
        <Select
          aria-label="Categoría"
          value={category}
          onChange={(e) => setCategory(e.target.value as DocCategory | '')}
          options={[{ value: '', label: 'Todas las categorías' }, ...DOC_CATEGORIES.map((c) => ({ value: c, label: DOC_CATEGORY_LABEL[c] }))]}
        />
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre o etiqueta…" label="Buscar documentos" />
      </div>
      {filtered && (
        <div className="-mt-3 flex flex-wrap items-center gap-2 text-body-sm text-on-surface-variant">
          {docs && <span>{docs.length === 1 ? '1 documento' : `${docs.length} documentos`}</span>}
          {status && <span>· {status === 'valid' ? 'vigentes' : status === 'expiring' ? 'por vencer' : status === 'expired' ? 'vencidos' : 'sin vencimiento'}</span>}
          <Button
            size="sm"
            variant="ghost"
            icon={X}
            onClick={() => {
              setPropertyId('');
              setCategory('');
              setStatus('');
              setQ('');
            }}
          >
            Quitar filtros
          </Button>
        </div>
      )}

      {res.error && !docs ? (
        <ErrorState error={res.error} />
      ) : !docs ? (
        <Loading />
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={filtered ? 'Nada con estos filtros' : 'Todavía no hay documentos'}
          body={filtered ? 'Prueba con otra propiedad, categoría o búsqueda.' : canWrite ? 'Sube contratos, seguros o licencias desde el teléfono.' : undefined}
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          {/* Teléfono */}
          <ul className="divide-y divide-outline-variant/50 md:hidden">
            {docs.map((d) => (
              <li key={d.id} className="flex items-start gap-3 px-4 py-4">
                <DocIcon category={d.category} />
                <div className="min-w-0 flex-1">
                  <p className="text-label-md text-primary">{d.name}</p>
                  <p className="truncate text-body-sm text-on-surface-variant">
                    {d.categoryLabel}
                    {d.propertyName && ` · ${d.propertyName}`}
                    {d.personName && ` · ${d.personName}`}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ExpiryBadge doc={d} />
                    {d.expiresOn && <span className="text-label-sm font-normal text-on-surface-variant">{expiryDate(d)}</span>}
                    <VisibilityTag visibility={d.visibility} title={d.visibilityLabel} />
                  </div>
                  {d.tags.length > 0 && <Tags tags={d.tags} />}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <IconButton icon={ExternalLink} label={`Abrir «${d.name}»`} variant="tonal" size="sm" onClick={() => open(d)} disabled={openingId === d.id} />
                  {canWrite && <ToneIconButton icon={Trash2} label={`Borrar «${d.name}»`} tone="danger" onClick={() => remove(d)} />}
                </div>
              </li>
            ))}
          </ul>
          {/* Computadora */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-body-sm">
              <thead className="border-b border-outline-variant bg-surface-low text-label-md text-on-surface-variant">
                <tr>
                  <th scope="col" className="py-3.5 pr-3 pl-5">
                    Documento
                  </th>
                  <th scope="col" className="px-3 py-3.5">
                    Propiedad
                  </th>
                  <th scope="col" className="px-3 py-3.5">
                    Vence
                  </th>
                  <th scope="col" className="px-3 py-3.5">
                    Visible para
                  </th>
                  <th scope="col" className="py-3.5 pr-5 pl-3 text-right">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {docs.map((d) => (
                  <tr key={d.id} className="align-top transition-colors hover:bg-surface-low/60">
                    <td className="py-4 pr-3 pl-5">
                      <div className="flex items-start gap-3">
                        <DocIcon category={d.category} />
                        <div className="min-w-0">
                          <p className="text-label-md text-primary">{d.name}</p>
                          <p className="text-label-sm font-normal text-on-surface-variant">
                            {d.categoryLabel}
                            {!d.sample && ' · subido aquí'}
                          </p>
                          {d.tags.length > 0 && <Tags tags={d.tags} />}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-on-surface-variant">
                      <span className="block max-w-48">{d.propertyName ?? 'General'}</span>
                      {d.personName && <span className="block text-label-sm font-normal">{d.personName}</span>}
                    </td>
                    <td className="px-3 py-4">
                      <p className="mb-1.5 text-on-surface">{expiryDate(d)}</p>
                      <ExpiryBadge doc={d} />
                    </td>
                    <td className="px-3 py-4">
                      <VisibilityTag visibility={d.visibility} title={d.visibilityLabel} />
                    </td>
                    <td className="py-3 pr-5 pl-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => open(d)} loading={openingId === d.id} aria-label={`Abrir «${d.name}»`}>
                          Abrir
                        </Button>
                        {canWrite && <ToneIconButton icon={Trash2} label={`Borrar «${d.name}»`} tone="danger" onClick={() => remove(d)} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card padding="lg" className="flex gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-warning-container text-on-warning-container">
            <BellRing size={22} aria-hidden />
          </span>
          <div>
            <h2 className="text-headline-md text-primary">Avisos de vencimiento</h2>
            <p className="mt-1 text-body-md text-on-surface-variant">
              Licencias, seguros y contratos avisan 30 días antes en la campana, y otra vez si se vencen. Pon la fecha de vencimiento al subirlos.
            </p>
          </div>
        </Card>
        <Card tone="dark" padding="lg" className="flex gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
            <HardDrive size={22} aria-hidden />
          </span>
          <div>
            <h2 className="text-headline-md">Dónde se guardan</h2>
            <p className="mt-1 text-body-md text-on-primary-container-muted">
              En esta demo los archivos viven solo en este navegador. Con servidor: almacenamiento privado con enlaces firmados.
            </p>
          </div>
        </Card>
      </div>

      {uploading && <UploadDocumentModal onClose={() => setUploading(false)} defaultPropertyId={propertyId || undefined} />}
    </div>
  );
}

function Tags({ tags }: { tags: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded-sm bg-surface-container px-1.5 py-0.5 text-label-sm font-normal text-on-surface-variant">
          #{t}
        </span>
      ))}
    </div>
  );
}

function StatButton({ label, value, hint, accent, active, onClick }: { label: string; value: string; hint?: string; accent: 'good' | 'warn' | 'bad'; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-lg border border-l-4 bg-surface-lowest p-5 text-left shadow-card transition-all hover:shadow-lift',
        accent === 'good' && 'border-l-secondary',
        accent === 'warn' && 'border-l-warning-strong',
        accent === 'bad' && 'border-l-error',
        active ? 'border-primary ring-2 ring-primary/20' : 'border-outline-variant/40',
      )}
    >
      <p className="text-label-sm text-on-surface-variant uppercase">{label}</p>
      <p className="mt-1 text-headline-lg text-primary">{value}</p>
      {hint && <p className="mt-0.5 text-label-sm font-normal text-on-surface-variant">{hint}</p>}
    </button>
  );
}
