"use client";

import { useActionState } from "react";
import { Field, Input, SubmitButton, notify } from "@/components/ui";
import { addHoliday } from "@/server/pasarelas/actions/holidays";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { savedWithRefresh } from "../tx/plural";

type FormState = {
  /** Lo que se envió si no se pudo guardar; vacío tras guardar, para agregar otro. */
  values: { day: string; name: string };
  error: ActionFailure | null;
  fieldErrors: Record<string, string[] | undefined>;
};

const EMPTY: FormState = { values: { day: "", name: "" }, error: null, fieldErrors: {} };

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Agregar un feriado a mano: un día y su nombre. La fecha se sugiere dentro del año que se está viendo. Al
 * agregarlo dice cuántas fechas estimadas de lo que está por caer cambiaron; si se corta, lo escrito sigue ahí.
 */
export function AddHolidayForm({ year }: { year: number }) {
  const [state, formAction] = useActionState(async (_previous: FormState, data: FormData): Promise<FormState> => {
    const values = { day: text(data, "day"), name: text(data, "name") };
    const result = await callAction(() => addHoliday(values));
    if (result.ok) {
      const said = savedWithRefresh("Feriado agregado.", result.data.refreshed);
      notify.success(said.success);
      if (said.error !== null) notify.error(said.error);
      return EMPTY;
    }
    return { values, error: failureOf(result), fieldErrors: result.fieldErrors ?? {} };
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
      <ActionError failure={state.error} />
      <SubmitButton className="self-start" pendingLabel="Agregando…">
        Agregar feriado
      </SubmitButton>
    </form>
  );
}
