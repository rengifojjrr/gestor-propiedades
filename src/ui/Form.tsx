import { Search } from 'lucide-react';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const control =
  'w-full rounded-md border border-outline-variant bg-surface-lowest px-3 text-body-md text-on-surface placeholder:text-on-surface-variant/70 ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60';

export function Field({ label, hint, error, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-label-md text-on-surface">
        {label}
      </label>
      {children}
      {error ? <p className="text-label-sm text-error">{error}</p> : hint ? <p className="text-label-sm font-normal text-on-surface-variant">{hint}</p> : null}
    </div>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
}

/** Campo de texto (también número, fecha, hora: pasa `type`). */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ label, hint, error, className, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const input = <input ref={ref} id={inputId} className={cn(control, 'h-11', error && 'border-error', className)} aria-invalid={!!error} {...rest} />;
  if (!label) return input;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      {input}
    </Field>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, hint, error, className, id, rows = 3, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const area = <textarea ref={ref} id={inputId} rows={rows} className={cn(control, 'py-2.5', error && 'border-error', className)} aria-invalid={!!error} {...rest} />;
  if (!label) return area;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      {area}
    </Field>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, options, placeholder, className, id, ...rest }, ref) {
  const auto = useId();
  const inputId = id ?? auto;
  const select = (
    <select ref={ref} id={inputId} className={cn(control, 'h-11 pr-8', error && 'border-error', className)} aria-invalid={!!error} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (!label) return select;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      {select}
    </Field>
  );
});

/** Interruptor accesible (role="switch"). */
export function Toggle({ checked, onChange, label, description, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean; id?: string }) {
  const auto = useId();
  const tid = id ?? auto;
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={tid} className="text-label-md text-on-surface">
          {label}
        </label>
        {description && <p className="text-body-sm text-on-surface-variant">{description}</p>}
      </div>
      <button
        id={tid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-secondary' : 'bg-outline-variant')}
      >
        <span className={cn('absolute top-1 left-0 h-5 w-5 rounded-full bg-surface-lowest shadow-card transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-1 text-body-md', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input type="checkbox" className="h-5 w-5 shrink-0 accent-[var(--color-secondary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={cn(checked && 'text-on-surface-variant line-through')}>{label}</span>
    </label>
  );
}

/** Pestañas / control segmentado. */
export function Tabs<T extends string>({ tabs, value, onChange, className, ariaLabel }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (id: T) => void; className?: string; ariaLabel?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('scrollbar-none flex gap-1 overflow-x-auto rounded-md bg-surface-container p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-label-md transition-colors',
            value === t.id ? 'bg-surface-lowest text-primary shadow-card' : 'text-on-surface-variant hover:text-primary',
          )}
        >
          {t.label}
          {t.count != null && <span className="rounded-full bg-surface-high px-1.5 text-label-sm">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Buscar…', className, label = 'Buscar' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-on-surface-variant" aria-hidden />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(control, 'h-11 rounded-full bg-surface-low pl-10')}
      />
    </div>
  );
}
