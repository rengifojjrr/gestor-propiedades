"use client";

import { useId } from "react";
import type { FeesPaidBy } from "@/lib/pasarelas/types";
import { FEES_PAID_BY_LABEL } from "./payer";

const OPTIONS: { value: FeesPaidBy; hint: string }[] = [
  { value: "nosotros", hint: "La comisión es un costo del negocio: se resta de lo cobrado." },
  { value: "comprador", hint: "Se le cobró de más para cubrirla: lo que pagó de más no es venta del negocio." },
];

/** La ayuda del monto según quién pagó la comisión: con «El comprador», el monto es lo que pagó él. */
export const BUYER_AMOUNT_HINT = "Lo que pagó el comprador, con la comisión incluida.";

/**
 * «¿Quién paga la comisión?», al registrar o editar un cobro: «Nosotros» (lo de siempre) o «El comprador». Dos
 * botones de opción con su nombre y una ayuda; cada uno es un objetivo de 44 px. Va en formularios con `onSubmit`
 * (no `<form action>`), así que los controles nativos no se reinician solos.
 */
export function FeesPaidByChoice({
  value,
  onChange,
  disabled,
}: {
  value: FeesPaidBy;
  onChange: (next: FeesPaidBy) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" disabled={disabled}>
      <legend className="mb-1 text-sm font-semibold">¿Quién paga la comisión?</legend>
      {OPTIONS.map((option) => (
        <div key={option.value} className="flex flex-col">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-describedby={`${name}-${option.value}`}
              className="size-5 shrink-0 accent-brand"
            />
            {FEES_PAID_BY_LABEL[option.value]}
          </label>
          <p id={`${name}-${option.value}`} className="pl-8 text-sm text-ink-soft">
            {option.hint}
          </p>
        </div>
      ))}
    </fieldset>
  );
}
