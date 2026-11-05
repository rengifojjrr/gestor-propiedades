/** Tarjeta de sección de Ajustes (título con ícono y línea abajo, como Stitch) y la nota «solo propietario». */
import type { LucideIcon } from 'lucide-react';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useActor } from '@/app/session';
import { cn } from '@/ui';

export function SettingsSection({ id, icon: Icon, title, subtitle, action, children, className }: { id: string; icon: LucideIcon; title: string; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className={cn('scroll-mt-36 rounded-lg border border-outline-variant/40 bg-surface-lowest p-5 shadow-card md:p-6 xl:scroll-mt-24', className)}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant/60 pb-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon size={22} className="mt-0.5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 id={`${id}-titulo`} className="text-headline-md text-primary">
              {title}
            </h2>
            {subtitle && <p className="text-body-sm text-on-surface-variant">{subtitle}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Nota para Administración en lo que solo cambia el propietario (los servicios también lo impiden). */
export function OwnerOnlyNote({ children = 'Solo el propietario puede cambiar esto.' }: { children?: ReactNode }) {
  return (
    <p className="mb-4 flex items-center gap-2 rounded-md bg-surface-low px-3 py-2 text-body-sm text-on-surface-variant">
      <Lock size={16} className="shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/** Quién mira y qué puede tocar en Ajustes. */
export function useSettingsPerms() {
  const actor = useActor();
  const role = actor.user.role;
  return {
    actor,
    isOwner: role === 'owner',
    /** Ajustes del sistema (empresa, monedas, umbral, datos privados): solo el propietario. */
    canSystem: role === 'owner' && !actor.readOnly,
    /** Checklists, categorías y equipo: propietario y administración. */
    canManage: (role === 'owner' || role === 'admin') && !actor.readOnly,
    readOnly: actor.readOnly,
  };
}

/**
 * Botón redondo de ícono con color propio (rojo para borrar o desactivar, verde para reactivar).
 * IconButton del kit fija su color; este lo deja elegir sin pelear con las clases.
 */
export function ToneIconButton({ icon: Icon, label, tone, onClick, disabled }: { icon: LucideIcon; label: string; tone: 'danger' | 'good'; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
        tone === 'danger' ? 'text-error hover:bg-error-container/60' : 'text-secondary hover:bg-secondary-container/50',
      )}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
