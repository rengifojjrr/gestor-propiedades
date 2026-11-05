import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';

export function ProgressBar({ value, tone = 'good', className, label }: { value: number; tone?: 'good' | 'warn' | 'bad' | 'info'; className?: string; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-container', className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          tone === 'good' && 'bg-secondary',
          tone === 'warn' && 'bg-warning',
          tone === 'bad' && 'bg-error',
          tone === 'info' && 'bg-primary',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  hint?: ReactNode;
  hintTone?: 'good' | 'warn' | 'bad' | 'neutral';
  progress?: number;
  progressTone?: 'good' | 'warn' | 'bad' | 'info';
  accent?: 'good' | 'warn' | 'bad' | 'info';
  className?: string;
  testId?: string;
}

/** Cifra con etiqueta (las tarjetas «bento» del panel de Stitch). */
export function StatCard({ label, value, icon: Icon, hint, hintTone = 'neutral', progress, progressTone = 'good', accent, className, testId }: StatCardProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'rounded-lg border border-outline-variant/40 bg-surface-lowest p-4 shadow-card md:p-5',
        accent === 'good' && 'border-l-4 border-l-secondary-container',
        accent === 'warn' && 'border-l-4 border-l-warning-strong',
        accent === 'bad' && 'border-l-4 border-l-error',
        accent === 'info' && 'border-l-4 border-l-primary',
        className,
      )}
    >
      {Icon && (
        <span className="mb-2 inline-flex rounded-md bg-surface-container p-2 text-primary">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <p className="text-label-md text-on-surface-variant">{label}</p>
      <p className="tabular mt-0.5 text-headline-lg text-primary">{value}</p>
      {progress != null && <ProgressBar value={progress} tone={progressTone} className="mt-3" />}
      {hint && (
        <p
          className={cn(
            'mt-1 text-label-sm',
            hintTone === 'good' && 'text-secondary',
            hintTone === 'warn' && 'text-on-warning-container',
            hintTone === 'bad' && 'text-error',
            hintTone === 'neutral' && 'text-on-surface-variant',
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
