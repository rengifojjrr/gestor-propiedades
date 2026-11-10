"use client";

import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from "@/components/ui";
import type { DayType } from "@/lib/pasarelas/types";
import { firstError, type FieldErrors, type GatewayDraft } from "./drafts";

export const DISPUTE_FEE_HINT = "Un solo costo, que se revierte si la disputa se gana.";

/** Los datos propios de una pasarela (los de alta y los de edición): nombre, días, reembolsos, disputa y nota. */
export function GatewayFieldsInputs({
  value,
  onChange,
  errors,
}: {
  value: GatewayDraft;
  onChange: (next: GatewayDraft) => void;
  errors: FieldErrors;
}) {
  const set = <K extends keyof GatewayDraft>(key: K, next: GatewayDraft[K]) => onChange({ ...value, [key]: next });
  return (
    <>
      <Field label="Nombre" error={firstError(errors, "name")}>
        <Input
          value={value.name}
          onChange={(event) => set("name", event.currentTarget.value)}
          maxLength={80}
          autoComplete="off"
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Días al depósito" error={firstError(errors, "payoutDays")}>
          <Input
            value={value.payoutDays}
            onChange={(event) => set("payoutDays", event.currentTarget.value)}
            inputMode="numeric"
            autoComplete="off"
            className="cifra text-right"
            required
          />
        </Field>
        <Field label="Tipo de días" error={firstError(errors, "payoutDayType")}>
          <Select
            value={value.payoutDayType}
            onChange={(event) => set("payoutDayType", event.currentTarget.value as DayType)}
          >
            <option value="habiles">Hábiles</option>
            <option value="corridos">Corridos</option>
          </Select>
        </Field>
      </div>
      <Checkbox
        label="Devuelve la comisión si reembolsas"
        hint="Si no la devuelve, lo que se queda cuenta como costo del reembolso."
        checked={value.refundsReturnFee}
        onChange={(event) => set("refundsReturnFee", event.currentTarget.checked)}
        error={firstError(errors, "refundsReturnFee")}
      />
      <Field label="Costo por disputa" hint={DISPUTE_FEE_HINT} error={firstError(errors, "disputeFee")}>
        <MoneyInput value={value.disputeFee} onChange={(event) => set("disputeFee", event.currentTarget.value)} />
      </Field>
      <Field label="Nota" optional error={firstError(errors, "notes")}>
        <Textarea value={value.notes} onChange={(event) => set("notes", event.currentTarget.value)} maxLength={500} />
      </Field>
    </>
  );
}
