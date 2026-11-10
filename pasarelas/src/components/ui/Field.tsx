"use client";

import { Children, createContext, isValidElement, use, useId, type ReactNode } from "react";
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

/**
 * El `id` que el control hijo trae por su cuenta, si lo trae. Se mira con `Children.toArray` y no en
 * `children.props` a secas: el hijo que pasa un Server Component puede llegar aquí todavía sin resolver, y
 * leerlo directo daría una etiqueta en el servidor y otra en el navegador. Con más de un hijo no se adivina.
 */
function ownIdOf(children: ReactNode): string | undefined {
  const [control, ...others] = Children.toArray(children);
  return others.length === 0 && isValidElement<ControlProps>(control) ? control.props.id : undefined;
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
  // La etiqueta tiene que apuntar al mismo `id` que el control va a llevar: el suyo, si trae uno.
  const id = ownIdOf(children) ?? fieldId;
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
