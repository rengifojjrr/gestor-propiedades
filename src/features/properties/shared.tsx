/**
 * Piezas compartidas de Propiedades (y del panel): permisos en pantalla, tonos de estado y salud,
 * marcadores del mapa y pequeños bloques de datos.
 */
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, HeartPulse, ImageOff } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import type { HealthResult } from '@/domain/rules';
import type { PropertyStatus } from '@/domain/types';
import { PROPERTY_STATUS_LABEL } from '@/domain/labels';
import { formatDate, formatTime, relativeDay } from '@/lib/dates';
import { can, subjectFor, type Action, type PropertyView, type Resource } from '@/services';
import { Badge, cn, PropertyImage, type MapMarker, type Tone } from '@/ui';

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

export type Perms = ReturnType<typeof usePermissions>;

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
    <div className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary">
        <Icon size={17} aria-hidden />
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

/** «Hoy 4:00 p. m.», «Mañana 11:00 a. m.» o «sáb 7 nov 4:00 p. m.». */
export function when(date: string, today: string, time?: string): string {
  const day = relativeDay(date, today);
  const text = /^(Hoy|Mañana|Ayer)$/.test(day) ? day : formatDate(date, { weekday: true });
  return time ? `${text} ${formatTime(time)}` : text;
}

/** Fila navegable: ícono, título (con algo al lado) y una segunda línea con chip + detalle. */
export function InfoRow({
  to,
  icon: Icon,
  title,
  meta,
  badge,
  titleEnd,
  testId,
}: {
  to: string;
  icon: LucideIcon;
  title: ReactNode;
  meta: ReactNode;
  badge?: ReactNode;
  titleEnd?: ReactNode;
  testId?: string;
}) {
  return (
    <Link to={to} data-testid={testId} className="flex min-h-14 items-center gap-3 rounded-md bg-surface-low px-3 py-2.5 transition-colors hover:bg-surface-container">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-lowest text-primary shadow-card">
        <Icon size={20} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="max-w-full truncate text-label-md text-primary">{title}</span>
          {titleEnd && <span className="shrink-0">{titleEnd}</span>}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          {badge && <span className="shrink-0">{badge}</span>}
          <span className="truncate text-body-sm text-on-surface-variant" title={typeof meta === 'string' ? meta : undefined}>
            {meta}
          </span>
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-on-surface-variant" aria-hidden />
    </Link>
  );
}

/** Portada de la propiedad; si todavía no tiene fotos, un aviso en vez de un cuadro vacío. */
export function CoverPhoto({ property: p, alt, className }: { property: Pick<PropertyView, 'name' | 'photos'>; alt: string; className?: string }) {
  if (p.photos.length === 0)
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 bg-surface-container text-on-surface-variant', className)} role="img" aria-label={`${p.name}: sin foto`}>
        <ImageOff size={28} aria-hidden />
        <span className="text-label-sm">Sin foto todavía</span>
      </div>
    );
  return <PropertyImage photo={p.photos[0]} alt={alt} className={className} />;
}

/** ¿Hay una pantalla anterior dentro de la app? (react-router guarda el índice en history.state). */
export function hasAppHistory(): boolean {
  return ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
}
