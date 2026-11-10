"use client";

import { useActionState } from "react";
import { Alert, Field, Input, SubmitButton, notify } from "@/components/ui";
import { addHoliday } from "@/server/pasarelas/actions/holidays";

type FormState = {
  /** Lo que se envió si no se pudo guardar; vacío tras guardar, para agregar otro. */
  values: { day: string; name: string };
  error: string | null;
  fieldErrors: Record<string, string[] | undefined>;
};

const EMPTY: FormState = { values: { day: "", name: "" }, error: null, fieldErrors: {} };

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/** Agregar un feriado a mano: un día y su nombre. La fecha se sugiere dentro del año que se está viendo. */
export function AddHolidayForm({ year }: { year: number }) {
  const [state, formAction] = useActionState(async (_previous: FormState, data: FormData): Promise<FormState> => {
    const values = { day: text(data, "day"), name: text(data, "name") };
    const result = await addHoliday(values);
    if (result.ok) {
      notify.success("Feriado agregado.");
      return EMPTY;
    }
    return { values, error: result.error, fieldErrors: result.fieldErrors ?? {} };
  }, EMPTY);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <Field label="Fecha" error={state.fieldErrors.day?.[0]}>
          <Input
            type="date"
            name="day"
            defaultValue={state.values.day}
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            required
          />
        </Field>
        <Field label="Nombre" error={state.fieldErrors.name?.[0]}>
          <Input name="name" defaultValue={state.values.name} maxLength={80} autoComplete="off" required />
        </Field>
      </div>
      {state.error ? (
        <Alert tone="danger" announce>
          {state.error}
        </Alert>
      ) : null}
      <SubmitButton className="self-start" pendingLabel="Agregando…">
        Agregar feriado
      </SubmitButton>
    </form>
  );
}
