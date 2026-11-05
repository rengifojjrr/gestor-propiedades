/**
 * Campos con letra grande para las apps del huésped y del inquilino (mismo estilo que los del kit,
 * con texto de 18 px y más alto para tocar fácil).
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/ui';

export const bigControl =
  'w-full rounded-md border border-outline-variant bg-surface-lowest px-4 text-body-lg text-on-surface placeholder:text-on-surface-variant/70 ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-60';

function BigLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-body-lg font-semibold text-on-surface">
      {children}
    </label>
  );
}

export const BigInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string }>(function BigInput(
  { label, error, id, className, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div>
      <BigLabel htmlFor={inputId}>{label}</BigLabel>
      <input ref={ref} id={inputId} aria-invalid={!!error} className={cn(bigControl, 'h-13', error && 'border-error', className)} {...rest} />
      {error && <p className="mt-1.5 text-label-md text-error">{error}</p>}
    </div>
  );
});

export const BigTextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label: ReactNode }>(function BigTextArea(
  { label, id, className, rows = 3, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <div>
      <BigLabel htmlFor={inputId}>{label}</BigLabel>
      <textarea ref={ref} id={inputId} rows={rows} className={cn(bigControl, 'py-3', className)} {...rest} />
    </div>
  );
});
