/**
 * Piezas compartidas de Propiedades (y del panel): permisos en pantalla, tonos de estado y salud,
 * marcadores del mapa y pequeños bloques de datos.
 */
import type { LucideIcon } from 'lucide-react';
import { HeartPulse } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import type { HealthResult } from '@/domain/rules';
import type { PropertyStatus } from '@/domain/types';
import { PROPERTY_STATUS_LABEL } from '@/domain/labels';
import { can, subjectFor, type Action, type PropertyView, type Resource } from '@/services';
import { Badge, cn, type MapMarker, type Tone } from '@/ui';

/**
 * Permisos para decidir qué acciones mostrar (los servicios igual los verifican).
 * `allowed` da false mientras carga y en «Ver como…» para todo lo que escribe.
 */
export function usePermissions() {
  const actor = useActor();
  const subject = useLive(() => subjectFor(actor), [actor]);
  const allowed = useCallback((action: Action, resource?: Resource) => !!subject && can(subject, action, resource), [subject]);
  return { ready: !!subject, allowed, role: actor.user.role, readOnly: actor.readOnly };
}

export const STATUS_MARKER_TONE: Record<PropertyStatus, MapMarker['tone']> = {
  occupied: 'good',
  vacant: 'info',
  maintenance: 'bad',
  blocked: 'neutral',
};

export function propertyMarker(p: Pick<PropertyView, 'id' | 'lat' | 'lng' | 'name' | 'city' | 'status'>, link = true): MapMarker {
  return {
    id: p.id,
    lat: p.lat,
    lng: p.lng,
    label: p.name,
    sublabel: `${PROPERTY_STATUS_LABEL[p.status]} · ${p.city}`,
    tone: STATUS_MARKER_TONE[p.status],
    to: link ? `/propiedades/${p.id}` : undefined,
  };
}

export const HEALTH_TONE: Record<HealthResult['tone'], Tone> = { good: 'good', warn: 'warn', bad: 'bad' };

/** Nota de salud (0–100) en una píldora con el color de su estado. */
export function HealthChip({ health, withLabel, className }: { health: HealthResult; withLabel?: boolean; className?: string }) {
  return (
    <Badge tone={HEALTH_TONE[health.tone]} icon={HeartPulse} className={className}>
      <span className="tabular">{health.score}</span>
      {withLabel && <span className="font-normal"> · {health.label}</span>}
    </Badge>
  );
}

/** Dato con ícono en círculo (cuartos, baños, capacidad…), como en las tarjetas de Stitch. */
export function Fact({ icon: Icon, label, value, className }: { icon: LucideIcon; label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary">
        <Icon size={18} aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-label-sm text-on-surface-variant uppercase">{label}</p>
        <p className="truncate text-label-md text-on-surface">{value}</p>
      </div>
    </div>
  );
}

/** «1 baño», «2.5 baños»… */
export function plural(n: number, one: string, many: string): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? one : many}`;
}
