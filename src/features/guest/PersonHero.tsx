/** Piezas comunes de las apps del huésped e inquilino: portada con foto y saludo, y tarjetas de información. */
import type { LucideIcon } from 'lucide-react';
import { MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Photo } from '@/domain/types';
import { Card, cn, PropertyImage } from '@/ui';

export function PersonHero({
  photo,
  alt,
  place,
  title,
  subtitle,
  children,
}: {
  photo?: Photo;
  alt: string;
  place: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden rounded-lg bg-primary-container shadow-pop">
      <PropertyImage photo={photo} alt={alt} className="h-72 w-full md:h-80" />
      {/* Dos capas de sombra para que el texto blanco se lea sobre cualquier foto. */}
      <div aria-hidden className="absolute inset-0 bg-linear-to-t from-image-scrim via-image-scrim/50 to-transparent" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-4/5 bg-linear-to-t from-image-scrim via-image-scrim/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5 text-on-image md:p-7">
        <p className="flex items-center gap-1.5 text-label-md">
          <MapPin size={16} aria-hidden />
          <span className="truncate">{place}</span>
        </p>
        <h1 className="mt-1 text-headline-xl">{title}</h1>
        {subtitle && <p className="mt-1 text-body-lg font-semibold">{subtitle}</p>}
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
    </section>
  );
}

/** Chip translúcido para ir sobre la foto de la portada. */
export function HeroChip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-image-scrim px-3 py-1 text-label-md text-on-image backdrop-blur">{children}</span>;
}

/** Tarjeta con ícono redondo y título (instrucciones, manual, cómo llegar…). */
export function InfoCard({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card padding="lg" as="section" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-headline-md text-primary">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary">
            <Icon size={20} aria-hidden />
          </span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Atajos grandes (mensajes, reportar…): el texto puede ir en dos líneas sin cortarse. */
export function QuickTiles({ items, label }: { items: { to: string; icon: LucideIcon; label: string; primary?: boolean }[]; label: string }) {
  return (
    <nav className="grid grid-cols-2 gap-3" aria-label={label}>
      {items.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          className={cn(
            'flex min-h-18 items-center gap-3 rounded-lg px-4 py-3 shadow-card transition-all active:scale-[0.98]',
            it.primary ? 'bg-primary text-on-primary hover:shadow-lift' : 'border border-outline-variant bg-surface-lowest text-primary hover:bg-surface-low',
          )}
        >
          <it.icon size={26} className="shrink-0" aria-hidden />
          <span className="text-body-lg leading-tight font-semibold">{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}
