"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Field, Input, Select, SubmitButton, Textarea, notify } from "@/components/ui";
import { saveCompany } from "@/server/pasarelas/actions/companies";
import { useActionForm } from "./useActionForm";

export type CompanyFormValues = {
  name: string;
  website: string;
  currency: string;
  defaultSchemeId: string;
  notes: string;
};

export type CompanyFormProps = {
  /** La empresa que se edita; sin ella, el formulario crea una y lleva a su ficha. */
  company?: { id: string } & CompanyFormValues;
  /** Los esquemas de reparto que se pueden elegir (los activos y, si es otro, el que ya tiene). */
  schemes: readonly { id: string; name: string }[];
  /** Al guardar una edición (p. ej. para cerrar el diálogo). */
  onSaved?: () => void;
};

const EMPTY: CompanyFormValues = { name: "", website: "", currency: "USD", defaultSchemeId: "", notes: "" };

/** La ficha de una empresa: nombre, web, moneda, esquema por defecto y notas. Los campos son controlados. */
export function CompanyForm({ company, schemes, onSaved }: CompanyFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<CompanyFormValues>(company ?? EMPTY);
  const { submit, formError, errorOf } = useActionForm();
  const set = (field: keyof CompanyFormValues) => (event: { currentTarget: { value: string } }) => {
    const { value } = event.currentTarget;
    setValues((current) => ({ ...current, [field]: value }));
  };

  async function save() {
    const result = await submit(() =>
      saveCompany({ ...values, id: company?.id, defaultSchemeId: values.defaultSchemeId || null }),
    );
    if (!result.ok) return;
    if (company) {
      notify.success("Ficha guardada");
      onSaved?.();
    } else {
      notify.success("Empresa creada");
      router.push(`/pasarelas/empresas/${result.data.id}`);
    }
  }

  return (
    <form action={save} noValidate className="flex flex-col gap-4">
      <Field label="Nombre" error={errorOf("name")}>
        <Input value={values.name} onChange={set("name")} autoComplete="organization" maxLength={120} />
      </Field>
      <Field label="Web" optional hint="Empieza por https://" error={errorOf("website")}>
        <Input value={values.website} onChange={set("website")} inputMode="url" autoComplete="url" maxLength={300} />
      </Field>
      <Field
        label="Moneda"
        hint="Tres letras, como USD. Es la de sus cobros si no eliges otra."
        error={errorOf("currency")}
      >
        <Input
          value={values.currency}
          onChange={set("currency")}
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={3}
          className="max-w-32 uppercase"
        />
      </Field>
      <Field
        label="Esquema de reparto por defecto"
        optional
        hint={
          schemes.length === 0 ? (
            <>
              Todavía no hay esquemas.{" "}
              <Link href="/pasarelas/repartos" className="font-semibold text-brand underline">
                Créalos en Repartos
              </Link>
              .
            </>
          ) : (
            "Se propone al registrar un cobro de esta empresa."
          )
        }
        error={errorOf("defaultSchemeId")}
      >
        <Select value={values.defaultSchemeId} onChange={set("defaultSchemeId")}>
          <option value="">Sin esquema</option>
          {schemes.map((scheme) => (
            <option key={scheme.id} value={scheme.id}>
              {scheme.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notas" optional error={errorOf("notes")}>
        <Textarea value={values.notes} onChange={set("notes")} maxLength={2000} />
      </Field>
      {formError ? (
        <Alert tone="danger" announce>
          {formError}
        </Alert>
      ) : null}
      <SubmitButton className="self-start">{company ? "Guardar ficha" : "Crear empresa"}</SubmitButton>
    </form>
  );
}
