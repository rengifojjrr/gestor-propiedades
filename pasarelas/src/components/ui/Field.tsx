"use client";

import { CircleAlert } from "lucide-react";
import { createContext, use, useId, type ReactNode } from "react";
import { cn } from "./cn";

type FieldControl = { id: string; describedBy: string | undefined; invalid: boolean };

const FieldContext = createContext<FieldControl | null>(null);

type ControlProps = {
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" | undefined;
};

/**
 * Lo que un control toma del `Field` que lo envuelve: el `id` que apunta la etiqueta, y `aria-invalid` y
 * `aria-describedby` hacia la ayuda y el error. Lo que el control reciba por props manda.
 */
export function useFieldControl(own: ControlProps): ControlProps {
  const field = use(FieldContext);
  if (!field) return own;
  return {
    id: own.id ?? field.id,
    "aria-describedby": own["aria-describedby"] ?? field.describedBy,
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
  /** El control: `Input`, `Textarea`, `Select`, `MoneyInput` o `PctInput` (uno solo). */
  children: ReactNode;
  className?: string;
};

/** Un campo de formulario: etiqueta + control + ayuda + error, enlazados entre sí. */
export function Field({ label, hint, error, optional, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-ayuda`;
  const errorId = `${id}-error`;
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
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-semibold text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
