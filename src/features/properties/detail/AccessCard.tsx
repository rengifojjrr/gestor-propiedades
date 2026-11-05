/**
 * «Entrada y manual de la casa» (textos en español) y los códigos de acceso, siempre tapados.
 * Solo propietario y administración los destapan con «Mostrar» (queda en la auditoría).
 */
import { BookOpen, DoorOpen, KeyRound, Lock, Navigation } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { ACCESS_KIND_LABEL } from '@/domain/labels';
import { svc, type PropertyView } from '@/services';
import { Card, CardHeader, Masked } from '@/ui';

function TextBlock({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary">
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0">
        <h3 className="text-label-md text-primary">{title}</h3>
        <p className="mt-1 text-body-sm whitespace-pre-line text-on-surface-variant">{text}</p>
      </div>
    </div>
  );
}

function AccessCodes({ propertyId }: { propertyId: string }) {
  const actor = useActor();
  const run = useAction();
  const codes = useLive(() => svc.properties.listAccessCodes(actor, propertyId).catch(() => null), [actor, propertyId]);
  if (!codes?.length) return null;
  return (
    <div className="mt-5 rounded-md border border-outline-variant/60 p-4">
      <h3 className="flex items-center gap-2 text-label-md text-primary">
        <KeyRound size={16} aria-hidden /> Códigos de acceso
      </h3>
      <p className="mt-1 text-body-sm text-on-surface-variant">Tapados. Cada vez que muestras uno queda registrado en la auditoría.</p>
      <ul className="mt-3 divide-y divide-outline-variant/40">
        {codes.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="min-w-0">
              <span className="block text-label-md text-on-surface">{ACCESS_KIND_LABEL[c.kind]}</span>
              {c.label && c.label !== ACCESS_KIND_LABEL[c.kind] && <span className="block text-body-sm text-on-surface-variant">{c.label}</span>}
            </span>
            <Masked
              masked={c.masked}
              value={c.value}
              label={ACCESS_KIND_LABEL[c.kind]}
              onReveal={() => run(() => svc.properties.revealAccessCode(actor, c.id))}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AccessCard({ property: p, canSeeCodes, viewingAs }: { property: PropertyView; canSeeCodes: boolean; viewingAs?: boolean }) {
  return (
    <Card padding="lg">
      <CardHeader title="Entrada y manual de la casa" subtitle="Lo que recibe el huésped (texto en español)." />
      <div className="space-y-4">
        <TextBlock icon={DoorOpen} title="Instrucciones de entrada" text={p.checkInInstructions.es} />
        <TextBlock icon={Navigation} title="Cómo llegar" text={p.directions.es} />
        <TextBlock icon={BookOpen} title="Manual de la casa" text={p.houseManual.es} />
      </div>
      {canSeeCodes ? (
        <AccessCodes propertyId={p.id} />
      ) : (
        <p className="mt-5 flex items-center gap-2 text-body-sm text-on-surface-variant">
          <Lock size={16} className="shrink-0" aria-hidden />
          {viewingAs ? 'En «Ver como…» los códigos de acceso no se muestran.' : 'Los códigos de acceso solo los ven propietario y administración.'}
        </p>
      )}
    </Card>
  );
}
