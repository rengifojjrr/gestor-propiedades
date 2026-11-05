import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type Accent = 'good' | 'warn' | 'bad' | 'info' | 'dark';

const ACCENT: Record<Accent, string> = {
  good: 'border-l-4 border-l-secondary',
  warn: 'border-l-4 border-l-warning',
  bad: 'border-l-4 border-l-error',
  info: 'border-l-4 border-l-primary',
  dark: 'border-l-4 border-l-primary-container',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** dark = tarjeta marina de Stitch (ganancia neta, salud); muted = fondo azul claro. */
  tone?: 'default' | 'dark' | 'muted';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  accent?: Accent;
  as?: 'div' | 'section' | 'article';
}

/** Tarjeta blanca con sombra suave y esquinas de 16 px. */
export function Card({ tone = 'default', padding = 'md', accent, as: Tag = 'div', className, children, ...rest }: CardProps) {
  return (
    <Tag
      className={cn(
        'rounded-lg',
        tone === 'default' && 'bg-surface-lowest shadow-card border border-outline-variant/40',
        tone === 'dark' && 'bg-primary-container text-on-primary-container shadow-pop',
        tone === 'muted' && 'bg-surface-low',
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-4 md:p-5',
        padding === 'lg' && 'p-5 md:p-6',
        accent && ACCENT[accent],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="text-headline-md text-primary">{title}</h3>
        {subtitle && <p className="text-body-sm text-on-surface-variant">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** Bloque con título (ej. «Alertas recientes» con acción «Ver todo»). */
export function Section({ title, action, children, className, id }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cn('space-y-3', className)} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-headline-md text-primary">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
