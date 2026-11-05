import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ChevronRight, Eye, EyeOff, Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatMoney } from '@/lib/money';
import { cn } from './cn';

/** Encabezado de página: título grande, subtítulo y acciones (como «Overview» de Stitch). */
export function PageHeader({ title, subtitle, actions, back, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string | boolean; eyebrow?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {back && (
          <button
            type="button"
            onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}
            className="mb-2 -ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-label-md text-on-surface-variant hover:bg-surface-low"
          >
            <ArrowLeft size={18} aria-hidden /> Volver
          </button>
        )}
        {eyebrow && <div className="mb-1">{eyebrow}</div>}
        <h1 className="text-headline-lg text-primary md:text-headline-xl">{title}</h1>
        {subtitle && <p className="mt-1 text-body-md text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Monto con su moneda. tone: income (verde), expense (rojo) o neutro. */
export function Money({ amount, currency, tone, className, whole }: { amount: number; currency: string; tone?: 'income' | 'expense' | 'auto'; className?: string; whole?: boolean }) {
  const t = tone === 'auto' ? (amount < 0 ? 'expense' : 'income') : tone;
  return <span className={cn('tabular', t === 'income' && 'text-secondary', t === 'expense' && 'text-error', className)}>{formatMoney(amount, currency, { whole })}</span>;
}

/** Fila de dato: etiqueta a la izquierda y valor a la derecha. */
export function KeyValue({ label, value, className }: { label: ReactNode; value: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 border-b border-outline-variant/40 py-2.5 last:border-b-0', className)}>
      <dt className="text-body-sm text-on-surface-variant">{label}</dt>
      <dd className="text-right text-label-md text-on-surface">{value}</dd>
    </div>
  );
}

/** Fila navegable de lista (con ícono, título, detalle y flecha), estilo «Operations» de Stitch. */
export function ListRow({ to, icon: Icon, title, subtitle, trailing, onClick, className, tone }: { to?: string; icon?: LucideIcon; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; onClick?: () => void; className?: string; tone?: 'muted' | 'plain' }) {
  const body = (
    <>
      {Icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-lowest text-primary shadow-card">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label-md text-primary">{title}</span>
        {subtitle && <span className="block truncate text-body-sm text-on-surface-variant">{subtitle}</span>}
      </span>
      {trailing}
      {(to || onClick) && <ChevronRight size={18} className="shrink-0 text-on-surface-variant" aria-hidden />}
    </>
  );
  const cls = cn('flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left', tone === 'plain' ? 'hover:bg-surface-low' : 'bg-surface-low hover:bg-surface-container', className);
  if (to)
    return (
      <Link to={to} className={cls}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}

/** Dato sensible tapado (códigos). `value` null = no se puede mostrar. `onReveal` pide destaparlo. */
export function Masked({ masked, value, onReveal, label }: { masked: string; value?: string | null; onReveal?: () => Promise<string | null | undefined> | void; label?: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const visible = value ?? shown;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn('tabular font-mono text-body-md', !visible && 'tracking-widest text-on-surface-variant')} aria-label={visible ? label : `${label ?? 'Código'} tapado`}>
        {visible ?? masked}
      </span>
      {!value && onReveal && (
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-label-sm text-primary hover:bg-surface-low"
          onClick={async () => {
            if (shown) return setShown(null);
            const v = await onReveal();
            if (v) setShown(v);
          }}
        >
          {shown ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          {shown ? 'Tapar' : 'Mostrar'}
        </button>
      )}
      {!visible && !onReveal && <Lock size={14} className="text-on-surface-variant" aria-hidden />}
    </span>
  );
}

/** Botón flotante redondo (como el «+» de Stitch). */
export function Fab({ icon: Icon, label, onClick, to, className }: { icon: LucideIcon; label: string; onClick?: () => void; to?: string; className?: string }) {
  const cls = cn(
    'fixed right-4 bottom-24 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-on-primary shadow-pop transition-transform active:scale-95 lg:bottom-8',
    className,
  );
  if (to)
    return (
      <Link to={to} className={cls} aria-label={label} title={label}>
        <Icon size={24} aria-hidden />
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={label} title={label}>
      <Icon size={24} aria-hidden />
    </button>
  );
}

/** Etiqueta pequeña en mayúsculas (como «OCCUPANCY RATE» en Stitch). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-label-sm uppercase text-on-surface-variant', className)}>{children}</p>;
}
