"use client";

import { useActionState, useState } from "react";
import { Button, Dialog, Field, Input, Select, SubmitButton, Textarea, notify } from "@/components/ui";
import type { BeneficiaryKind } from "@/lib/pasarelas/types";
import { saveBeneficiary } from "@/server/pasarelas/actions/splits";
import { DialogActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { KIND_LABEL } from "./labels";

/** Lo que se edita de un beneficiario, como texto de formulario. */
export type BeneficiaryFormValues = {
  name: string;
  kind: BeneficiaryKind;
  accountAlias: string;
  notes: string;
};

export const EMPTY_BENEFICIARY: BeneficiaryFormValues = { name: "", kind: "persona", accountAlias: "", notes: "" };

type FormState = {
  /** Lo último que se envió: React vacía los campos al terminar la acción y vuelven con esto. */
  values: BeneficiaryFormValues;
  /** Si se cortó la red (`unsure`), no se sabe si se guardó: el aviso ofrece «Ver cómo quedó». */
  error: ActionFailure | null;
  fieldErrors: Record<string, string[] | undefined>;
};

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
};

const KINDS = Object.keys(KIND_LABEL) as BeneficiaryKind[];

/** El formulario: vive solo mientras el diálogo está abierto, así que cada vez empieza de cero. */
function BeneficiaryForm({
  id,
  initial,
  onClose,
}: {
  id: string | null;
  initial: BeneficiaryFormValues;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState(
    async (_previous: FormState, data: FormData): Promise<FormState> => {
      const values: BeneficiaryFormValues = {
        name: text(data, "name"),
        kind: text(data, "kind") as BeneficiaryKind,
        accountAlias: text(data, "accountAlias"),
        notes: text(data, "notes"),
      };
      // Con `callAction`, un corte no sube a `error.tsx`: el diálogo sigue abierto con lo escrito y la duda.
      const result = await callAction(() => saveBeneficiary({ id, ...values }));
      if (result.ok) {
        notify.success("Beneficiario guardado.");
        onClose();
        return { values, error: null, fieldErrors: {} };
      }
      return { values, error: failureOf(result), fieldErrors: result.fieldErrors ?? {} };
    },
    { values: initial, error: null, fieldErrors: {} },
  );
  const fieldError = (name: keyof BeneficiaryFormValues) => state.fieldErrors[name]?.[0];
  // Controlado: al terminar la acción React reinicia el formulario, y un `<select>` sin controlar volvería al tipo
  // con que se abrió aunque se hubiera elegido otro. El `Select` del kit mantiene el valor controlado.
  const [kind, setKind] = useState<BeneficiaryKind>(initial.kind);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <Field label="Nombre" error={fieldError("name")}>
        <Input name="name" defaultValue={state.values.name} maxLength={80} autoComplete="off" required />
      </Field>
      <Field label="Tipo" error={fieldError("kind")}>
        <Select name="kind" value={kind} onChange={(event) => setKind(event.currentTarget.value as BeneficiaryKind)}>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Alias de la cuenta"
        optional
        hint="Un nombre para saber a dónde le pagas, como «Cuenta de Grupo A». Nunca el número de cuenta."
        error={fieldError("accountAlias")}
      >
        <Input name="accountAlias" defaultValue={state.values.accountAlias} maxLength={80} autoComplete="off" />
      </Field>
      <Field label="Notas" optional error={fieldError("notes")}>
        <Textarea name="notes" defaultValue={state.values.notes} maxLength={500} />
      </Field>
      <DialogActionError failure={state.error} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <SubmitButton>Guardar beneficiario</SubmitButton>
      </div>
    </form>
  );
}

/** El diálogo para crear un beneficiario (sin `id`) o editar uno. */
export function BeneficiaryFormDialog({
  open,
  onClose,
  id = null,
  initial = EMPTY_BENEFICIARY,
}: {
  open: boolean;
  onClose: () => void;
  id?: string | null;
  initial?: BeneficiaryFormValues;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={id === null ? "Nuevo beneficiario" : "Editar beneficiario"}
      description="Quien recibe una parte de los cobros: una persona, una empresa o una cartera."
    >
      {open ? <BeneficiaryForm id={id} initial={initial} onClose={onClose} /> : null}
    </Dialog>
  );
}
