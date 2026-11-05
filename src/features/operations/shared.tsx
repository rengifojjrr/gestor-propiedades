/**
 * Piezas compartidas de Operación (equipo, limpieza y técnico): etiquetas, íconos por categoría,
 * accesos por rol, selector segmentado, galería de fotos, lista de requisitos y ayudas de fechas y mapas.
 */
import type { LucideIcon } from 'lucide-react';
import { AirVent, Bug, Circle, CircleCheck, Droplets, Hammer, KeyRound, Refrigerator, Sprout, Waves, X, Zap } from 'lucide-react';
import { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { useActor, useSession } from '@/app/session';
import { useLiveResult } from '@/data/live';
import { MAINTENANCE_CATEGORY_LABEL, PRIORITY_LABEL } from '@/domain/labels';
import { MAINTENANCE_CATEGORIES, PRIORITIES, type Incident, type MaintenanceCategory, type Priority } from '@/domain/types';
import { clock } from '@/lib/clock';
import { diffDays, formatDate, formatTime, timeAgo } from '@/lib/dates';
import { svc } from '@/services';
import { cn, FileImage, Modal, useConfirm } from '@/ui';

// ───────────────────────── Etiquetas e íconos ─────────────────────────

export const CATEGORY_ICON: Record<MaintenanceCategory, LucideIcon> = {
  plumbing: Droplets,
  electrical: Zap,
  hvac: AirVent,
  appliances: Refrigerator,
  pests: Bug,
  pool: Waves,
  garden: Sprout,
  locks: KeyRound,
  general: Hammer,
};

export const CATEGORY_OPTIONS = MAINTENANCE_CATEGORIES.map((c) => ({ value: c, label: MAINTENANCE_CATEGORY_LABEL[c] }));

export const INCIDENT_SOURCE_LABEL: Record<Incident['source'], string> = {
  guest: 'Huésped',
  tenant: 'Inquilino',
  cleaning: 'Limpieza',
  team: 'Equipo',
};

export const INCIDENT_KIND_LABEL: Record<Incident['kind'], string> = {
  damage: 'Daño',
  missing: 'Faltante',
  problem: 'Problema',
};

export const INCIDENT_STATUS_LABEL: Record<Incident['status'], string> = {
  open: 'Abierta',
  in_progress: 'En curso',
  resolved: 'Resuelta',
  dismissed: 'Descartada',
};

// ───────────────────────── Fechas, nombres y mapas ─────────────────────────

/** «Hoy», «Mañana», «Ayer» o «jue 12 nov». */
export function dayLabel(date: string, today: string): string {
  const d = diffDays(today, date);
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  if (d === -1) return 'Ayer';
  return formatDate(date, { weekday: true });
}

/** «4:00 p. m.» sin que se parta en dos líneas. */
export function timeLabel(hm: string): string {
  return formatTime(hm).replace(/\s/g, '\u00a0');
}

/** «Hoy, 10:00 a. m.» */
export function whenLabel(date: string, time: string | undefined, today: string): string {
  return `${dayLabel(date, today)}${time ? `, ${timeLabel(time)}` : ''}`;
}

/** «hace 3 h» (con el reloj de la app). */
export function ago(isoTimestamp: string): string {
  return timeAgo(isoTimestamp, clock.now());
}

/**
 * «3 nov, 11:20 p. m.» en la zona de la propiedad. (formatDateTime de @/lib/dates borra el primer
 * punto, que en español cae en «p. m.»; por eso aquí va aparte.)
 */
export function stamp(isoTimestamp: string, timezone?: string): string {
  let d = DateTime.fromISO(isoTimestamp);
  if (timezone) d = d.setZone(timezone);
  return d.setLocale('es').toFormat('d LLL, h:mm a');
}

/** Fecha (AAAA-MM-DD) de una marca de tiempo en la zona de la propiedad. */
export function isoDateIn(isoTimestamp: string, timezone: string): string {
  return DateTime.fromISO(isoTimestamp).setZone(timezone).toISODate() ?? isoTimestamp.slice(0, 10);
}

export function firstName(name?: string): string {
  return name?.trim().split(/\s+/)[0] ?? '';
}

/** Ruta en Google Maps: el último punto es el destino y los anteriores, paradas. */
export function mapsDirUrl(stops: { lat: number; lng: number }[]): string {
  const point = (s: { lat: number; lng: number }) => `${s.lat},${s.lng}`;
  const dest = stops[stops.length - 1];
  let url = `https://www.google.com/maps/dir/?api=1&destination=${point(dest)}`;
  if (stops.length > 1) url += `&waypoints=${stops.slice(0, -1).map(point).join('|')}`;
  return url;
}

/** «cada 2 semanas», «cada mes». */
export function everyLabel(every: { unit: 'week' | 'month'; count: number }): string {
  if (every.count === 1) return every.unit === 'week' ? 'Cada semana' : 'Cada mes';
  return `Cada ${every.count} ${every.unit === 'week' ? 'semanas' : 'meses'}`;
}

/** Número de un campo de texto («1,250.5» → 1250.5); undefined si está vacío o no es válido. */
export function numberOrUndefined(text: string): number | undefined {
  const clean = text.trim().replace(/[^\d.,-]/g, '');
  if (!clean) return undefined;
  const normalized = clean.includes(',') && !clean.includes('.') ? clean.replace(',', '.') : clean.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

// ───────────────────────── Accesos por rol ─────────────────────────

/**
 * Qué acciones mostrar según el rol (los servicios igual lo verifican):
 * propietario y administración gestionan; atención al cliente reporta y asigna incidencias;
 * solo el propietario aprueba gastos.
 */
export function useOpsAccess() {
  const { user } = useSession();
  const role = user?.role;
  return {
    role,
    isOwner: role === 'owner',
    canManage: role === 'owner' || role === 'admin',
    canTriage: role === 'owner' || role === 'admin' || role === 'support',
  };
}

/** Personas de limpieza, técnicos y proveedores activos (para asignar). */
export function useFieldStaff() {
  const actor = useActor();
  const team = useLiveResult(() => svc.system.listTeam(actor), [actor]);
  const vendors = useLiveResult(() => svc.operations.listVendors(actor), [actor]);
  const members = team.data ?? [];
  return {
    cleaners: members.filter((u) => u.role === 'cleaner' && u.active),
    technicians: members.filter((u) => u.role === 'technician' && u.active),
    vendors: (vendors.data ?? []).filter((v) => v.active),
    allVendors: vendors.data ?? [],
    loading: team.loading || vendors.loading,
  };
}

// ───────────────────────── Selector segmentado ─────────────────────────

export interface ChoiceOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  /** Clases del botón elegido (por defecto, marino). */
  selectedClass?: string;
  testId?: string;
}

const COLS: Record<number, string> = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' };

/** Botones grandes de una sola opción (radios nativos: flechas del teclado incluidas). */
export function SegmentedChoice<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
  size = 'lg',
  hideLabel,
  columns,
}: {
  name: string;
  label: ReactNode;
  options: ChoiceOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'md' | 'lg';
  hideLabel?: boolean;
  /** Columnas (por defecto, una por opción hasta 4). */
  columns?: 2 | 3 | 4;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={cn('mb-1.5 text-label-md text-on-surface', hideLabel && 'sr-only')}>{label}</legend>
      <div className={cn('grid gap-2', COLS[columns ?? options.length] ?? 'grid-cols-2')}>
        {options.map((o) => {
          const checked = o.value === value;
          return (
            <label
              key={o.value}
              data-testid={o.testId}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 text-center text-label-md transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
                size === 'lg' ? 'min-h-14' : 'min-h-11',
                checked ? (o.selectedClass ?? 'border-primary bg-primary text-on-primary') : 'border-outline-variant bg-surface-lowest text-on-surface-variant hover:bg-surface-low',
              )}
            >
              <input type="radio" name={name} value={o.value} checked={checked} onChange={() => onChange(o.value)} className="sr-only" />
              {o.icon && <o.icon size={18} aria-hidden />}
              <span>{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const PRIORITY_SELECTED: Record<Priority, string> = {
  urgent: 'border-error bg-error text-on-error',
  high: 'border-warning bg-warning-container text-on-warning-container',
  medium: 'border-primary bg-info-container text-on-info-container',
  low: 'border-outline bg-surface-high text-on-surface',
};

/** Urgente / Alta / Media / Baja como botones grandes. */
export function PriorityPicker({ value, onChange, name, label = 'Urgencia', testIdPrefix }: { value: Priority; onChange: (p: Priority) => void; name: string; label?: string; testIdPrefix?: string }) {
  return (
    <SegmentedChoice
      name={name}
      label={label}
      value={value}
      onChange={onChange}
      options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], selectedClass: PRIORITY_SELECTED[p], testId: testIdPrefix ? `${testIdPrefix}-${p}` : undefined }))}
    />
  );
}

// ───────────────────────── Fotos ─────────────────────────

/** Cuadrícula de fotos guardadas: se amplían al tocarlas y, si hay `onRemove`, se pueden quitar. */
export function PhotoGrid({
  fileIds,
  alt,
  onRemove,
  emptyText,
  size = 'md',
  className,
}: {
  fileIds: string[];
  alt: string;
  onRemove?: (fileId: string) => Promise<unknown> | void;
  emptyText?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const confirm = useConfirm();
  if (!fileIds.length) return emptyText ? <p className={cn('text-body-sm text-on-surface-variant', className)}>{emptyText}</p> : null;
  return (
    <>
      <ul className={cn('grid gap-2', size === 'sm' ? 'grid-cols-4 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-4', className)}>
        {fileIds.map((id, i) => (
          <li key={id} className="relative">
            <button type="button" onClick={() => setZoom(id)} className="block w-full overflow-hidden rounded-md" aria-label={`Ampliar ${alt.toLowerCase()} ${i + 1}`}>
              <FileImage fileId={id} alt={`${alt} ${i + 1}`} className="aspect-square w-full" />
            </button>
            {onRemove && (
              <button
                type="button"
                aria-label={`Quitar ${alt.toLowerCase()} ${i + 1}`}
                title="Quitar foto"
                onClick={async () => {
                  if (await confirm({ title: '¿Quitar esta foto?', confirmLabel: 'Quitar', danger: true })) await onRemove(id);
                }}
                className="absolute top-1 right-1 flex h-9 w-9 items-center justify-center rounded-full bg-scrim text-on-image"
              >
                <X size={18} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      <Modal open={!!zoom} onClose={() => setZoom(null)} title={alt} size="lg">
        {zoom && <FileImage fileId={zoom} alt={alt} className="h-auto w-full rounded-md" />}
      </Modal>
    </>
  );
}

// ───────────────────────── Requisitos y filas ─────────────────────────

/** Lista de lo que falta (✓ hecho / ○ pendiente), para botones que se habilitan al cumplirla. */
export function Requirements({ items, className }: { items: { ok: boolean; label: ReactNode }[]; className?: string }) {
  return (
    <ul className={cn('space-y-2', className)}>
      {items.map((it, i) => (
        <li key={i} className={cn('flex items-center gap-2 text-body-md', it.ok ? 'text-on-surface-variant' : 'text-on-surface')}>
          {it.ok ? <CircleCheck size={22} className="shrink-0 text-secondary" aria-hidden /> : <Circle size={22} className="shrink-0 text-outline" aria-hidden />}
          <span className={cn(it.ok && 'line-through')}>{it.label}</span>
          <span className="sr-only">{it.ok ? '(listo)' : '(falta)'}</span>
        </li>
      ))}
    </ul>
  );
}

/** Línea con ícono (dato corto de una tarjeta). `tone` la pinta de rojo (falta algo) o ámbar (pronto). */
export function InfoLine({ icon: Icon, children, className, tone }: { icon: LucideIcon; children: ReactNode; className?: string; tone?: 'bad' | 'warn' }) {
  return (
    <p className={cn('flex min-w-0 items-center gap-2 text-body-sm', tone === 'bad' ? 'text-error' : tone === 'warn' ? 'text-on-warning-container' : 'text-on-surface-variant', className)}>
      <Icon size={18} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

/** Cuadro con el ícono de la categoría (como los de Stitch). */
export function CategoryTile({ category, className }: { category: MaintenanceCategory; className?: string }) {
  const Icon = CATEGORY_ICON[category];
  return (
    <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-container text-primary', className)} title={MAINTENANCE_CATEGORY_LABEL[category]}>
      <Icon size={22} aria-hidden />
    </span>
  );
}
