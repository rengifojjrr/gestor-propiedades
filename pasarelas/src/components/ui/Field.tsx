"use client";

import { createContext, isValidElement, use, useId, type ReactNode } from "react";
import { cn } from "./cn";
import { FieldError } from "./FieldError";

type FieldControl = { id: string; describedBy: string | undefined; invalid: boolean };

const FieldContext = createContext<FieldControl | null>(null);

type ControlProps = {
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" | undefined;
};

/**
 * Lo que un control toma del `Field` que lo envuelve: el `id` que apunta la etiqueta, y `aria-invalid` y
 * `aria-describedby` hacia la ayuda y el error. Su propio `id` y su propio `aria-invalid` mandan; su
 * `aria-describedby` se suma (va primero) al de la ayuda y el error.
 */
export function useFieldControl(own: ControlProps): ControlProps {
  const field = use(FieldContext);
  if (!field) return own;
  return {
    id: own.id ?? field.id,
    "aria-describedby": [own["aria-describedby"], field.describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": own["aria-invalid"] ?? (field.invalid || undefined),
  };
}

export type FieldProps = {
  /** La etiqueta visible del control. */
  label: ReactNode;
  /** Ayuda corta, debajo del control. */
  hint?: ReactNode;
  /** Mensaje de error de este campo; si viene, el control queda marcado como inválido. */
  error?: string | null | undefined;
  /** Agrega «(opcional)» a la etiqueta. */
  optional?: boolean;
  /**
   * El control: `Input`, `Textarea`, `Select`, `MoneyInput` o `PctInput` (uno solo, como hijo directo).
   * Si trae su propio `id`, la etiqueta apunta a ese.
   */
  children: ReactNode;
  className?: string;
};

/** Un campo de formulario: etiqueta + control + ayuda + error, enlazados entre sí. */
export function Field({ label, hint, error, optional, children, className }: FieldProps) {
  const fieldId = useId();
  // El `id` propio del control se lee de sus props: la etiqueta tiene que apuntar al mismo que él va a llevar.
  const ownId = isValidElement<ControlProps>(children) ? children.props.id : undefined;
  const id = ownId ?? fieldId;
  const hintId = `${fieldId}-ayuda`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-soft"> (opcional)</span> : null}
      </label>
      <FieldContext value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldContext>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
