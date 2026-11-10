import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

type ToggleProps = Omit<ComponentProps<"input">, "type" | "role" | "children"> & {
  /** El texto junto al control: es su nombre accesible. */
  label: ReactNode;
  /** Aclaración corta, debajo de la etiqueta. */
  hint?: ReactNode;
};

const ROW =
  "flex min-h-11 cursor-pointer items-center gap-3 py-1 has-disabled:cursor-not-allowed has-disabled:opacity-55";

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

/** Casilla con su etiqueta: toda la fila (≥ 44 px) se puede tocar. Sirve para aceptar o elegir entre varias. */
export function Checkbox({ label, hint, className, ...props }: CheckboxProps) {
  const id = useId();
  return (
    <label className={cn(ROW, className)}>
      <input
        type="checkbox"
        className="size-5 shrink-0 accent-brand"
        aria-labelledby={`${id}-etiqueta`}
        aria-describedby={hint ? `${id}-ayuda` : undefined}
        {...props}
      />
      <ToggleText id={id} label={label} hint={hint} />
    </label>
  );
}

export type SwitchProps = ToggleProps;

/**
 * Interruptor (encendido / apagado) para algo que rige de inmediato o que es una opción del formulario.
 * Es un `<input type="checkbox" role="switch">`: viaja en el formulario como cualquier casilla.
 */
export function Switch({ label, hint, className, ...props }: SwitchProps) {
  const id = useId();
  return (
    <label className={cn(ROW, "justify-between", className)}>
      <ToggleText id={id} label={label} hint={hint} />
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-labelledby={`${id}-etiqueta`}
          aria-describedby={hint ? `${id}-ayuda` : undefined}
          {...props}
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
  );
}
