"use client";

import { useActionState } from "react";
import { Alert, Button, Dialog, Field, Input, SubmitButton, Textarea, notify } from "@/components/ui";
import { saveBankAccount } from "@/server/pasarelas/actions/accounts";

/** Lo que se edita de una cuenta, como texto de formulario. */
export type AccountFormValues = {
  alias: string;
  institution: string;
  last4: string;
  currency: string;
  notes: string;
};

export const EMPTY_ACCOUNT: AccountFormValues = { alias: "", institution: "", last4: "", currency: "USD", notes: "" };

type FormState = {
  /** Lo último que se envió: React vacía los campos al terminar la acción y vuelven con esto. */
  values: AccountFormValues;
  error: string | null;
  fieldErrors: Record<string, string[] | undefined>;
};

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

/** El formulario: vive solo mientras el diálogo está abierto, así que cada vez empieza de cero. */
function AccountForm({
  id,
  initial,
  onClose,
}: {
  id: string | null;
  initial: AccountFormValues;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(
    async (_previous: FormState, data: FormData): Promise<FormState> => {
      const values: AccountFormValues = {
        alias: text(data, "alias"),
        institution: text(data, "institution"),
        last4: text(data, "last4"),
        currency: text(data, "currency"),
        notes: text(data, "notes"),
      };
      const result = await saveBankAccount({ id, ...values });
      if (result.ok) {
        notify.success("Cuenta guardada.");
        onClose();
        return { values, error: null, fieldErrors: {} };
      }
      return { values, error: result.error, fieldErrors: result.fieldErrors ?? {} };
    },
    { values: initial, error: null, fieldErrors: {} },
  );
  const fieldError = (name: keyof AccountFormValues) => state.fieldErrors[name]?.[0];

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Field
        label="Alias"
        hint="Un nombre para reconocerla, como «Cuenta principal». Nunca el número de cuenta."
        error={fieldError("alias")}
      >
        <Input name="alias" defaultValue={state.values.alias} maxLength={80} autoComplete="off" required />
      </Field>
      <Field label="Banco o billetera" optional error={fieldError("institution")}>
        <Input name="institution" defaultValue={state.values.institution} maxLength={80} autoComplete="off" />
      </Field>
      <Field label="Últimos 4" optional hint="Solo los 4 últimos dígitos, para distinguirla." error={fieldError("last4")}>
        <Input
          name="last4"
          defaultValue={state.values.last4}
          inputMode="numeric"
          maxLength={4}
          autoComplete="off"
          className="max-w-32"
        />
      </Field>
      <Field label="Moneda" hint="Tres letras: USD, EUR, MXN…" error={fieldError("currency")}>
        <Input
          name="currency"
          defaultValue={state.values.currency}
          maxLength={3}
          autoComplete="off"
          autoCapitalize="characters"
          className="max-w-32 uppercase"
          required
        />
      </Field>
      <Field label="Notas" optional error={fieldError("notes")}>
        <Textarea name="notes" defaultValue={state.values.notes} maxLength={500} />
      </Field>
      {state.error ? (
        <Alert tone="danger" announce>
          {state.error}
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <SubmitButton>Guardar cuenta</SubmitButton>
      </div>
    </form>
  );
}

/** El diálogo para crear una cuenta (sin `id`) o editar una. */
export function AccountFormDialog({
  open,
  onClose,
  id = null,
  initial = EMPTY_ACCOUNT,
}: {
  open: boolean;
  onClose: () => void;
  id?: string | null;
  initial?: AccountFormValues;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={id === null ? "Nueva cuenta destino" : "Editar cuenta destino"}
      description="Solo alias, banco y últimos 4: nunca guardes el número completo."
    >
      {open ? <AccountForm id={id} initial={initial} onClose={onClose} /> : null}
    </Dialog>
  );
}
