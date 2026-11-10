"use client";

import { useId, type ReactNode } from "react";
import { Field, Input } from "@/components/ui";

/** Un campo de días: un número corto, alineado a la derecha. */
function DaysInput({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      inputMode="numeric"
      autoComplete="off"
      maxLength={2}
      className="cifra text-right"
      required={required}
    />
  );
}

export type DaysRangeInputsProps = {
  /** El nombre del grupo: «Días al depósito». */
  legend: string;
  /** Si se pueden dejar los dos vacíos (los días propios de una opción o de una empresa). */
  optional?: boolean;
  /** Lo que significa dejarlos vacíos, o cómo se cuentan: va debajo del grupo. */
  hint?: ReactNode;
  value: { min: string; max: string };
  onChange: (next: { min: string; max: string }) => void;
  errors?: { min?: string | undefined; max?: string | undefined };
};

/**
 * «Días al depósito: de [3] a [5]». Las pasarelas prometen una ventana, no un día: «De» es el mínimo y «A», el
 * máximo, que es opcional (vacío, un solo día). Controlados: lo escrito es texto, y lo valida el servidor.
 */
export function DaysRangeInputs({ legend, optional = false, hint, value, onChange, errors }: DaysRangeInputsProps) {
  const hintId = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={hint ? hintId : undefined}>
      <legend className="mb-1.5 text-sm font-semibold text-ink">
        {legend}
        {optional ? <span className="font-normal text-ink-soft"> (opcional)</span> : null}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <Field label="De" error={errors?.min}>
          <DaysInput value={value.min} onChange={(min) => onChange({ ...value, min })} required={!optional} />
        </Field>
        <Field label="A" optional error={errors?.max}>
          <DaysInput value={value.max} onChange={(max) => onChange({ ...value, max })} />
        </Field>
      </div>
      {hint ? (
        <p id={hintId} className="text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
