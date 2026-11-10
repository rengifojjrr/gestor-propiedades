"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn";
import { useFieldControl } from "./Field";
import { useSelectResetBaseline } from "./form-reset";

/** 16 px de letra como mínimo: con menos, iOS hace zoom al enfocar. */
const CONTROL =
  "block min-h-11 w-full min-w-0 rounded-control border border-rule-strong bg-surface px-3 py-2 text-base text-ink disabled:cursor-not-allowed disabled:opacity-55 aria-invalid:border-2 aria-invalid:border-danger";

export type InputProps = ComponentProps<"input">;

/** Campo de texto (o de fecha, correo…). Dentro de un `Field` queda enlazado a su etiqueta y a su error. */
export function Input({ className, ...props }: InputProps) {
  const field = useFieldControl(props);
  return <input className={cn(CONTROL, className)} {...props} {...field} />;
}

export type TextareaProps = ComponentProps<"textarea">;

/** Texto de varias líneas. */
export function Textarea({ className, rows = 3, ...props }: TextareaProps) {
  const field = useFieldControl(props);
  return <textarea rows={rows} className={cn(CONTROL, className)} {...props} {...field} />;
}

export type SelectProps = ComponentProps<"select">;

/**
 * Lista desplegable nativa (en el celular abre el selector del sistema). Los `<option>` van como hijos.
 * Controlada (`value`), sigue enseñando su valor después de que React reinicie el `<form action>` que la contiene.
 */
export function Select({ className, children, ref, ...props }: SelectProps) {
  const field = useFieldControl(props);
  const baselineRef = useSelectResetBaseline(props.value, ref);
  return (
    <div className="relative">
      <select ref={baselineRef} className={cn(CONTROL, "appearance-none pr-10", className)} {...props} {...field}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-ink-soft"
      />
    </div>
  );
}

export type MoneyInputProps = Omit<ComponentProps<"input">, "type" | "inputMode"> & {
  /** Código de la moneda que se muestra junto al campo, p. ej. `USD`. */
  currency?: string;
};

/**
 * Campo para escribir un monto: teclado numérico con coma o punto y cifras alineadas a la derecha.
 * Entrega el TEXTO tal cual lo escribió el usuario; convertirlo y validarlo es cosa del servidor.
 */
export function MoneyInput({ currency, className, placeholder = "0,00", ...props }: MoneyInputProps) {
  const field = useFieldControl(props);
  return (
    <div className="relative">
      {currency ? (
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-ink-soft">
          {currency}
        </span>
      ) : null}
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        className={cn(CONTROL, "cifra text-right", currency && "pl-14", className)}
        {...props}
        {...field}
      />
    </div>
  );
}

export type PctInputProps = Omit<ComponentProps<"input">, "type" | "inputMode">;

/** Campo para escribir un porcentaje (`2,9`); el signo «%» va fijo a la derecha. Entrega el texto tal cual. */
export function PctInput({ className, placeholder = "0", ...props }: PctInputProps) {
  const field = useFieldControl(props);
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        className={cn(CONTROL, "cifra pr-9 text-right", className)}
        {...props}
        {...field}
      />
      <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-soft">
        %
      </span>
    </div>
  );
}
