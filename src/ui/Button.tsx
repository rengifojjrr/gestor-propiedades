import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'tonal' | 'mint';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:shadow-lift',
  secondary: 'bg-surface-lowest text-primary border border-outline-variant hover:bg-surface-low',
  ghost: 'text-primary hover:bg-surface-low',
  success: 'bg-secondary text-on-secondary hover:shadow-lift',
  danger: 'bg-error text-on-error hover:shadow-lift',
  tonal: 'bg-surface-container text-primary hover:bg-surface-high',
  mint: 'bg-secondary-container text-on-secondary-container hover:shadow-lift',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-label-md gap-1.5',
  md: 'h-11 px-5 text-label-md gap-2',
  lg: 'h-14 px-6 text-body-md font-semibold gap-2.5',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', fullWidth = false, className = '') {
  return cn(
    'inline-flex items-center justify-center rounded-md font-semibold whitespace-nowrap transition-all active:scale-[0.98]',
    'disabled:opacity-50 disabled:active:scale-100 disabled:hover:shadow-none',
    VARIANT[variant],
    SIZE[size],
    fullWidth && 'w-full',
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  fullWidth?: boolean;
}

/** Botón de Stitch: marino (principal), con borde (secundario), verde (éxito), rojo (peligro)… */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, loading, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'lg' ? 22 : size === 'sm' ? 16 : 18;
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, fullWidth, className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={iconSize} className="animate-spin" aria-hidden /> : Icon ? <Icon size={iconSize} aria-hidden /> : null}
      {children}
      {IconRight && <IconRight size={iconSize} aria-hidden />}
    </button>
  );
});

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  fullWidth?: boolean;
}

/** Enlace con forma de botón (navegación interna). */
export function LinkButton({ variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, fullWidth, className, children, ...rest }: LinkButtonProps) {
  const iconSize = size === 'lg' ? 22 : size === 'sm' ? 16 : 18;
  return (
    <Link className={buttonClass(variant, size, fullWidth, typeof className === 'string' ? className : '')} {...rest}>
      {Icon && <Icon size={iconSize} aria-hidden />}
      {children as ReactNode}
      {IconRight && <IconRight size={iconSize} aria-hidden />}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Texto para lectores de pantalla (obligatorio). */
  label: string;
  variant?: 'ghost' | 'tonal' | 'primary' | 'secondary';
  size?: 'sm' | 'md';
  badge?: number;
}

export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', badge, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
        size === 'sm' ? 'h-9 w-9' : 'h-11 w-11',
        variant === 'ghost' && 'text-on-surface-variant hover:bg-surface-low',
        variant === 'tonal' && 'bg-surface-container text-primary hover:bg-surface-high',
        variant === 'primary' && 'bg-primary text-on-primary',
        variant === 'secondary' && 'border border-outline-variant bg-surface-lowest text-primary',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 18 : 22} aria-hidden />
      {!!badge && (
        <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-on-error">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}
