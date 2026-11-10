"use client";

import { useId, useState } from "react";
import { Alert, Card, CardBody, CardHeader, CardTitle, notify, SubmitButton } from "@/components/ui";
import { updateGateway } from "@/server/pasarelas/actions/gateways";
import { type FieldErrors, type GatewayDraft } from "./drafts";
import { GatewayFieldsInputs } from "./GatewayFieldsInputs";

/** «Datos» de la pasarela: se editan aquí. Su tarifa y sus opciones van aparte. */
export function GatewaySettingsForm({ id, initial }: { id: string; initial: GatewayDraft }) {
  const titleId = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);

  async function submit() {
    const result = await updateGateway({ id, ...value });
    if (!result.ok) {
      setError(result.error);
      setErrors(result.fieldErrors);
      return;
    }
    setError(null);
    setErrors(undefined);
    notify.success("Cambios guardados");
  }

  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Datos</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={submit} className="flex flex-col gap-4" noValidate>
            <GatewayFieldsInputs value={value} onChange={setValue} errors={errors} />
            {error ? (
              <Alert tone="danger" announce>
                {error}
              </Alert>
            ) : null}
            <SubmitButton className="self-start">Guardar cambios</SubmitButton>
          </form>
        </CardBody>
      </section>
    </Card>
  );
}
