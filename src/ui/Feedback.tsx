import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export function Loading({ label = 'Cargando…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-10 text-body-sm text-on-surface-variant', className)} role="status">
      <Loader2 size={18} className="animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-container', className)} aria-hidden />;
}

export function EmptyState({ icon: Icon = Info, title, body, action, className }: { icon?: LucideIcon; title: ReactNode; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed border-outline-variant px-6 py-10 text-center', className)}>
      <span className="rounded-full bg-surface-container p-3 text-primary">
        <Icon size={24} aria-hidden />
      </span>
      <p className="text-label-md text-primary">{title}</p>
      {body && <p className="max-w-sm text-body-sm text-on-surface-variant">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, className }: { error: Error | string; className?: string }) {
  return (
    <div className={cn('flex items-start gap-3 rounded-lg bg-error-container p-4 text-on-error-container', className)} role="alert">
      <AlertTriangle size={20} className="mt-0.5 shrink-0" aria-hidden />
      <p className="text-body-sm">{typeof error === 'string' ? error : error.message}</p>
    </div>
  );
}

/** Franja informativa (demo, «Ver como…», avisos de la pantalla). */
export function Banner({ tone = 'info', icon: Icon = Info, children, action, className }: { tone?: 'info' | 'warn' | 'bad' | 'good'; icon?: LucideIcon; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md px-4 py-3 text-body-sm',
        tone === 'info' && 'bg-info-container text-on-info-container',
        tone === 'warn' && 'bg-warning-container text-on-warning-container',
        tone === 'bad' && 'bg-error-container text-on-error-container',
        tone === 'good' && 'bg-secondary-container text-on-secondary-container',
        className,
      )}
      role="status"
    >
      <Icon size={18} className="shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
