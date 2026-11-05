/** Galería de fotos de la propiedad; propietario y administración agregan fotos (o una de ejemplo). */
import { ImageOff } from 'lucide-react';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { svc, type PropertyView } from '@/services';
import { Card, CardHeader, PhotoInput, PropertyImage } from '@/ui';

export function GalleryCard({ property: p, canAdd }: { property: PropertyView; canAdd: boolean }) {
  const actor = useActor();
  const run = useAction();
  return (
    <Card padding="lg">
      <CardHeader title="Fotos" subtitle={`${p.photos.length} ${p.photos.length === 1 ? 'foto' : 'fotos'}. La primera es la portada.`} />
      {p.photos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-outline-variant py-8 text-on-surface-variant">
          <ImageOff size={24} aria-hidden />
          <p className="text-body-sm">Todavía no hay fotos.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {p.photos.map((ph, i) => (
            <li key={ph.id} className="overflow-hidden rounded-md bg-surface-container">
              <PropertyImage photo={ph} alt={ph.src && ph.caption ? `${p.name}: ${ph.caption}` : `${p.name}: foto ${i + 1}`} className="aspect-4/3 w-full" />
              {ph.src && ph.caption && <p className="truncate px-2 py-1.5 text-label-sm font-normal text-on-surface-variant">{ph.caption}</p>}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <div className="mt-4">
          <PhotoInput
            camera={false}
            size="md"
            variant="secondary"
            label="Agregar foto"
            sample={{ phase: 'Propiedad', caption: p.name }}
            testId="foto-propiedad"
            onPhoto={async (blob) => {
              await run(() => svc.properties.addPropertyPhoto(actor, p.id, blob, `foto-${p.photos.length + 1}.webp`), { success: 'Foto agregada.' });
            }}
          />
        </div>
      )}
    </Card>
  );
}
