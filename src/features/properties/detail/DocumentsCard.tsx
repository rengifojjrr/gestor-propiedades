/** Documentos de la propiedad (los que el rol puede ver). Se abren en otra pestaña. */
import { ExternalLink, FileText, Upload } from 'lucide-react';
import { useAction, downloadFile } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { formatDate } from '@/lib/dates';
import { svc, type DocumentView } from '@/services';
import { Badge, Card, CardHeader, LinkButton, Skeleton } from '@/ui';

function DocStatus({ doc }: { doc: DocumentView }) {
  if (doc.status === 'expired') return <Badge tone="bad">Vencido</Badge>;
  if (doc.status === 'expiring') return <Badge tone="warn">Vence en {doc.daysToExpiry} días</Badge>;
  if (doc.status === 'valid' && doc.expiresOn) return <span className="text-label-sm font-normal text-on-surface-variant">Vigente hasta {formatDate(doc.expiresOn, { year: true })}</span>;
  return null;
}

export function DocumentsCard({ propertyId, canUpload }: { propertyId: string; canUpload: boolean }) {
  const actor = useActor();
  const run = useAction();
  const docs = useLive(() => svc.documents.listDocuments(actor, { propertyId }).catch(() => null), [actor, propertyId]);

  const open = async (doc: DocumentView) => {
    const file = await run(() => svc.documents.openDocument(actor, doc.id));
    if (!file) return;
    const url = URL.createObjectURL(file.blob);
    const tab = window.open(url, '_blank');
    // Si el navegador bloquea la pestaña nueva, se descarga.
    if (!tab) downloadFile(file.blob, file.name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  if (docs === null) return null;
  return (
    <Card padding="lg">
      <CardHeader title="Documentos" subtitle="Seguros, licencias, contratos e inspecciones de esta propiedad." />
      {docs === undefined ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : docs.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">No hay documentos de esta propiedad que puedas ver.</p>
      ) : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => open(d)}
                className="flex w-full items-center gap-3 rounded-md border border-outline-variant/50 p-3 text-left transition-colors hover:bg-surface-low"
                aria-label={`Abrir ${d.name} en otra pestaña`}
              >
                <FileText size={20} className="shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-label-md text-on-surface">{d.name}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-body-sm text-on-surface-variant">{d.categoryLabel}</span>
                    <DocStatus doc={d} />
                  </span>
                </span>
                <ExternalLink size={18} className="shrink-0 text-on-surface-variant" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <LinkButton to="/documentos" variant="ghost" icon={Upload} fullWidth className="mt-3 border-2 border-dashed border-outline-variant">
          Subir documento
        </LinkButton>
      )}
    </Card>
  );
}
