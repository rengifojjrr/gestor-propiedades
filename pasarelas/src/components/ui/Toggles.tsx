"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";
import { FieldError } from "./FieldError";
import { useCheckedResetBaseline } from "./form-reset";

type ToggleProps = Omit<ComponentProps<"input">, "type" | "role" | "children"> & {
  /** El texto junto al control: es su nombre accesible. */
  label: ReactNode;
  /** Aclaración corta, debajo de la etiqueta. */
  hint?: ReactNode;
  /** Mensaje de error de este control; si viene, queda marcado como inválido y enlazado al mensaje. */
  error?: string | null | undefined;
};

const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 py-1 has-disabled:cursor-not-allowed has-disabled:opacity-55";

/**
 * Lo que el control dice de sí mismo a un lector de pantalla: su etiqueta, su ayuda y su error (lo que ya trajera
 * en `aria-labelledby` y en `aria-describedby` va primero y se suma, en vez de pisarse) y `aria-invalid` cuando
 * hay error.
 */
function toggleAria(
  id: string,
  { hint, error, labelledBy, describedBy, invalid }: Pick<ToggleProps, "hint" | "error"> & {
    labelledBy: ToggleProps["aria-labelledby"];
    describedBy: ToggleProps["aria-describedby"];
    invalid: ToggleProps["aria-invalid"];
  },
) {
  const ids = [describedBy, hint ? `${id}-ayuda` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    "aria-labelledby": [labelledBy, `${id}-etiqueta`].filter(Boolean).join(" "),
    "aria-describedby": ids || undefined,
    "aria-invalid": invalid ?? (error ? true : undefined),
  };
}

function ToggleText({ id, label, hint }: { id: string; label: ReactNode; hint?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span id={`${id}-etiqueta`}>{label}</span>
      {hint ? (
        <span id={`${id}-ayuda`} className="text-sm text-ink-soft">
          {hint}
        </span>
      ) : null}
    </span>
  );
}

export type CheckboxProps = ToggleProps;

/**
 * Casilla con su etiqueta: toda la fila (≥ 44 px) se puede tocar. Sirve para aceptar o elegir entre varias.
 * Con `error`, el mensaje va debajo de la fila. `className` se aplica al contenedor. Controlada (`checked`), sigue
 * enseñando su valor después de que React reinicie el `<form action>` que la contiene.
 */
export function Checkbox({
  label,
  hint,
  error,
  className,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ref,
  ...props
}: CheckboxProps) {
  const id = useId();
  const baselineRef = useCheckedResetBaseline(props.checked, ref);
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <label className={ROW}>
        <input
          ref={baselineRef}
          type="checkbox"
          className="size-5 shrink-0 accent-brand"
          {...props}
          {...toggleAria(id, { hint, error, labelledBy, describedBy, invalid })}
        />
        <ToggleText id={id} label={label} hint={hint} />
      </label>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

export type SwitchProps = ToggleProps;

/**
 * Interruptor (encendido / apagado) para algo que rige de inmediato o que es una opción del formulario.
 * Es un `<input type="checkbox" role="switch">`: viaja en el formulario como cualquier casilla.
 * Con `error`, el mensaje va debajo de la fila. `className` se aplica al contenedor. Controlado (`checked`), sigue
 * enseñando su valor después de que React reinicie el `<form action>` que lo contiene.
 */
export function Switch({
  label,
  hint,
  error,
  className,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ref,
  ...props
}: SwitchProps) {
  const id = useId();
  const baselineRef = useCheckedResetBaseline(props.checked, ref);
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <label className={cn(ROW, "justify-between")}>
        <ToggleText id={id} label={label} hint={hint} />
        <span className="relative inline-flex shrink-0">
          <input
            ref={baselineRef}
            type="checkbox"
            role="switch"
            className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            {...props}
            {...toggleAria(id, { hint, error, labelledBy, describedBy, invalid })}
          />
          <span
            aria-hidden
            className="h-7 w-12 rounded-full border border-rule-strong bg-sunken transition-colors peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute top-1 left-1 size-5 rounded-full bg-ink-soft transition-transform peer-checked:translate-x-5 peer-checked:bg-on-brand"
          />
        </span>
      </label>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
