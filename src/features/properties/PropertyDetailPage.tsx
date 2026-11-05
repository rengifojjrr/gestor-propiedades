/**
 * Ficha de la propiedad (/propiedades/:id): foto, cifras del mes, operación, salud, ficha técnica,
 * entrada y manual, datos privados del propietario, documentos, historial, fotos y mapa.
 * Cada bloque se oculta solo si el rol no tiene permiso (atención y contabilidad también la abren).
 */
import { MapPin, Pencil, Power } from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { svc, type PropertyView } from '@/services';
import { Badge, Button, Card, ErrorState, LazyMap, LinkButton, Loading, Money, PageHeader, PROPERTY_STATUS_TONE } from '@/ui';
import { PROPERTY_STATUS_LABEL } from '@/domain/labels';
import { AccessCard } from './detail/AccessCard';
import { ChecklistCard } from './detail/ChecklistCard';
import { DocumentsCard } from './detail/DocumentsCard';
import { FactsCard } from './detail/FactsCard';
import { GalleryCard } from './detail/GalleryCard';
import { HealthCard } from './detail/HealthCard';
import { HistoryCard } from './detail/HistoryCard';
import { KpiCards } from './detail/KpiCards';
import { OperationsCard } from './detail/OperationsCard';
import { OwnerCard } from './detail/OwnerCard';
import { CoverPhoto, hasAppHistory, propertyMarker, usePermissions, type Perms } from './shared';
import { StatusModal } from './StatusModal';

function Hero({ property: p }: { property: PropertyView }) {
  const nightly = p.rentalMode !== 'monthly' && p.nightlyRate != null ? p.nightlyRate : undefined;
  const monthly = p.rentalMode !== 'nightly' && p.monthlyRent != null ? p.monthlyRent : undefined;
  const hasPrice = nightly != null || monthly != null;
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-surface-container shadow-card">
      <CoverPhoto property={p} alt={`Foto principal de ${p.name}`} className="h-full w-full" />
      {hasPrice && (
        <>
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-image-scrim to-transparent" aria-hidden />
          <p className="absolute bottom-4 left-5 flex flex-wrap items-baseline gap-x-3 text-on-image md:bottom-6 md:left-6">
            {nightly != null && (
              <span className="text-headline-md">
                <Money amount={nightly} currency={p.currency} />
                <span className="text-body-md opacity-90">/noche</span>
              </span>
            )}
            {monthly != null && (
              <span className="text-headline-md">
                <Money amount={monthly} currency={p.currency} />
                <span className="text-body-md opacity-90">/mes</span>
              </span>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function MapCard({ property: p }: { property: PropertyView }) {
  const markers = useMemo(() => [propertyMarker(p, false)], [p]);
  return (
    <Card padding="none" className="relative overflow-hidden">
      <Suspense fallback={<Loading label="Cargando el mapa…" className="h-60" />}>
        <LazyMap markers={markers} zoom={14} className="h-60 rounded-none" ariaLabel={`Mapa: ${p.name}`} />
      </Suspense>
      <p className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-surface-lowest/90 px-3 py-1 text-label-sm text-primary shadow-card">
        <MapPin size={14} aria-hidden /> {p.neighborhood || p.city}
      </p>
    </Card>
  );
}

function Detail({ property: p, perms }: { property: PropertyView; perms: Perms }) {
  const actor = useActor();
  const [statusOpen, setStatusOpen] = useState(false);
  const ops = useLive(() => svc.properties.propertyOperations(actor, p.id).catch(() => null), [actor, p.id]);
  const health = useLive(() => svc.properties.getHealth(actor, p.id).catch(() => null), [actor, p.id]);
  const res = { propertyId: p.id };
  const canUpdate = perms.allowed('property.update', res);
  const canFinance = perms.allowed('finance.read', res);
  const canBookings = perms.allowed('booking.read', res);
  const teamLead = perms.role === 'owner' || perms.role === 'admin';

  return (
    <div data-testid="ficha-propiedad">
      <PageHeader
        back={hasAppHistory() ? true : '/propiedades'}
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PROPERTY_STATUS_TONE[p.status]} upper>
              {PROPERTY_STATUS_LABEL[p.status]}
            </Badge>
            <span className="flex items-center gap-1 text-label-sm text-on-surface-variant">
              <MapPin size={14} aria-hidden /> {[p.city, p.region].filter(Boolean).join(', ')}
            </span>
          </div>
        }
        title={p.name}
        actions={
          canUpdate && (
            <>
              <LinkButton to={`/propiedades/${p.id}/editar`} state={{ from: 'detail' }} icon={Pencil}>
                Editar propiedad
              </LinkButton>
              <Button variant="secondary" icon={Power} onClick={() => setStatusOpen(true)}>
                Cambiar estado
              </Button>
            </>
          )
        }
      />

      {/* En el teléfono todo va en una columna (el orden lo dan las clases order-*); en la computadora, 8 + 4. */}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:items-start">
        <div className="contents lg:col-span-8 lg:flex lg:flex-col lg:gap-6">
          <div className="order-1">
            <Hero property={p} />
          </div>
          {canFinance && (
            <div className="order-2">
              <KpiCards propertyId={p.id} currency={p.currency} />
            </div>
          )}
          <div className="order-3">
            <OperationsCard property={p} ops={ops} perms={perms} />
          </div>
          <div className="order-5">
            <FactsCard property={p} />
          </div>
          <div className="order-6">
            <AccessCard property={p} canSeeCodes={teamLead && canUpdate} viewingAs={teamLead && perms.readOnly} />
          </div>
          {canBookings && (
            <div className="order-10">
              <HistoryCard propertyId={p.id} monthly={p.rentalMode === 'monthly'} />
            </div>
          )}
          <div className="order-11">
            <GalleryCard property={p} canAdd={canUpdate} />
          </div>
        </div>

        <div className="contents lg:col-span-4 lg:flex lg:flex-col lg:gap-6">
          <div className="order-4">
            <HealthCard property={p} health={health} ops={ops} perms={perms} />
          </div>
          {p.ownerPrivate && (
            <div className="order-7">
              <OwnerCard property={p} isOwner={perms.role === 'owner'} canFinance={canFinance} />
            </div>
          )}
          <div className="order-8">
            <DocumentsCard propertyId={p.id} canUpload={perms.allowed('document.write', res)} />
          </div>
          <div className="order-9">
            <ChecklistCard propertyId={p.id} canEdit={teamLead && canUpdate} />
          </div>
          <div className="order-12">
            <MapCard property={p} />
          </div>
        </div>
      </div>

      {canUpdate && <StatusModal property={p} open={statusOpen} onClose={() => setStatusOpen(false)} />}
    </div>
  );
}

export default function PropertyDetailPage() {
  const { id = '' } = useParams();
  const actor = useActor();
  const perms = usePermissions();
  const res = useLiveResult(() => svc.properties.getProperty(actor, id), [actor, id]);

  if (res.error && !res.data)
    return (
      <div className="space-y-4">
        <PageHeader title="Propiedad" back="/propiedades" />
        <ErrorState error={res.error} />
        <LinkButton to="/propiedades" variant="secondary">
          Ver todas las propiedades
        </LinkButton>
      </div>
    );
  if (!res.data || !perms.ready) return <Loading label="Cargando la ficha…" />;
  return <Detail property={res.data} perms={perms} />;
}
