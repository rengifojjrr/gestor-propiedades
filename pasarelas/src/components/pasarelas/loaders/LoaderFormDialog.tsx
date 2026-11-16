"use client";

import { useActionState } from "react";
import { Button, Dialog, Field, Input, SubmitButton, Textarea, notify } from "@/components/ui";
import { saveLoader } from "@/server/pasarelas/actions/loaders";
import { DialogActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";

/** Lo que se edita de un cargador, como texto de formulario. */
export type LoaderFormValues = { name: string; note: string };

const EMPTY: LoaderFormValues = { name: "", note: "" };

type FormState = {
  /** Lo último que se envió: React vacía los campos al terminar la acción y vuelven con esto. */
  values: LoaderFormValues;
  /** Si se cortó la red (`unsure`), no se sabe si se guardó: el aviso ofrece «Ver cómo quedó». */
  error: ActionFailure | null;
  fieldErrors: Record<string, string[] | undefined>;
};

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/** El formulario: vive solo mientras el diálogo está abierto, así que cada vez empieza de cero. */
function LoaderForm({ id, initial, onClose }: { id: string | null; initial: LoaderFormValues; onClose: () => void }) {
  const [state, formAction] = useActionState(
    async (_previous: FormState, data: FormData): Promise<FormState> => {
      const values: LoaderFormValues = { name: text(data, "name"), note: text(data, "note") };
      // Con `callAction`, un corte no sube a `error.tsx`: el diálogo sigue abierto con lo escrito y la duda.
      const result = await callAction(() => saveLoader({ id, ...values }));
      if (result.ok) {
        notify.success("Cargador guardado.");
        onClose();
        return { values, error: null, fieldErrors: {} };
      }
      return { values, error: failureOf(result), fieldErrors: result.fieldErrors ?? {} };
    },
    { values: initial, error: null, fieldErrors: {} },
  );
  const fieldError = (name: keyof LoaderFormValues) => state.fieldErrors[name]?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Field label="Nombre" hint="Como lo reconoces: no se repite." error={fieldError("name")}>
        <Input name="name" defaultValue={state.values.name} maxLength={80} autoComplete="off" required />
      </Field>
      <Field label="Nota" optional error={fieldError("note")}>
        <Textarea name="note" defaultValue={state.values.note} maxLength={500} />
      </Field>
      <DialogActionError failure={state.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <SubmitButton>Guardar cargador</SubmitButton>
      </div>
    </form>
  );
}

/** El diálogo para crear un cargador (sin `id`) o cambiar el nombre y la nota de uno. */
export function LoaderFormDialog({
  open,
  onClose,
  id = null,
  initial = EMPTY,
}: {
  open: boolean;
  onClose: () => void;
  id?: string | null;
  initial?: LoaderFormValues;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={id === null ? "Nuevo cargador" : "Editar cargador"}
      description="Quien te trae ventas, para reportarle las suyas."
    >
      {open ? <LoaderForm id={id} initial={initial} onClose={onClose} /> : null}
    </Dialog>
  );
}
