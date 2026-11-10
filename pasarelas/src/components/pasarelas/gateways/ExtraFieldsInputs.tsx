"use client";

import { Field, Input, MoneyInput, PctInput, Select, Switch } from "@/components/ui";
import type { ExtraBase } from "@/lib/pasarelas/types";
import { DaysRangeInputs } from "./DaysRangeInputs";
import { BASE_LABEL, firstError, type ExtraDraft, type FieldErrors } from "./drafts";

/** Los datos de una opción de la pasarela (p. ej. «Pago rápido»): su costo, sobre qué se calcula y sus días. */
export function ExtraFieldsInputs({
  value,
  onChange,
  errors,
}: {
  value: ExtraDraft;
  onChange: (next: ExtraDraft) => void;
  errors?: FieldErrors;
}) {
  const set = <K extends keyof ExtraDraft>(key: K, next: ExtraDraft[K]) => onChange({ ...value, [key]: next });
  return (
    <>
      <Field label="Nombre de la opción" error={firstError(errors, "name")}>
        <Input
          value={value.name}
          onChange={(event) => set("name", event.currentTarget.value)}
          maxLength={80}
          autoComplete="off"
          required
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Porcentaje" error={firstError(errors, "pct")}>
          <PctInput value={value.pct} onChange={(event) => set("pct", event.currentTarget.value)} />
        </Field>
        <Field label="Cuota fija" error={firstError(errors, "fixed")}>
          <MoneyInput value={value.fixed} onChange={(event) => set("fixed", event.currentTarget.value)} />
        </Field>
      </div>
      <Field label="Se calcula" error={firstError(errors, "base")}>
        <Select value={value.base} onChange={(event) => set("base", event.currentTarget.value as ExtraBase)}>
          <option value="bruto">{BASE_LABEL.bruto}</option>
          <option value="despues_de_comision">{BASE_LABEL.despues_de_comision}</option>
        </Select>
      </Field>
      <DaysRangeInputs
        legend="Días al depósito con esta opción"
        optional
        hint="Vacíos: los de la pasarela. 0: el mismo día."
        value={{ min: value.payoutDaysOverride, max: value.payoutDaysOverrideMax }}
        onChange={({ min, max }) => onChange({ ...value, payoutDaysOverride: min, payoutDaysOverrideMax: max })}
        errors={{
          min: firstError(errors, "payoutDaysOverride"),
          max: firstError(errors, "payoutDaysOverrideMax"),
        }}
      />
      <Switch
        label="Encendida por defecto"
        hint="Viene marcada al registrar un cobro con esta pasarela."
        checked={value.defaultOn}
        onChange={(event) => set("defaultOn", event.currentTarget.checked)}
      />
    </>
  );
}
