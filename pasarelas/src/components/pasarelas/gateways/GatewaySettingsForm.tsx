"use client";

import { useId, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle, notify, SubmitButton } from "@/components/ui";
import { updateGateway } from "@/server/pasarelas/actions/gateways";
import { ActionError } from "../ActionError";
import { callAction, failureOf, type ActionFailure } from "../callAction";
import { savedWithRefresh } from "../tx/plural";
import { type FieldErrors, type GatewayDraft } from "./drafts";
import { GatewayFieldsInputs } from "./GatewayFieldsInputs";

/**
 * «Datos» de la pasarela: se editan aquí. Su tarifa y sus opciones van aparte. Al guardar dice cuántas fechas
 * estimadas de lo que está por caer cambiaron (si cambiaron sus días). Si se corta, lo escrito sigue aquí.
 */
export function GatewaySettingsForm({ id, initial }: { id: string; initial: GatewayDraft }) {
  const titleId = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<ActionFailure | null>(null);
  const [errors, setErrors] = useState<FieldErrors>(undefined);

  async function submit() {
    const result = await callAction(() => updateGateway({ id, ...value }));
    if (!result.ok) {
      setError(failureOf(result));
      setErrors(result.fieldErrors);
      return;
    }
    setError(null);
    setErrors(undefined);
    const said = savedWithRefresh("Cambios guardados.", result.data.refreshed);
    notify.success(said.success);
    if (said.error !== null) notify.error(said.error);
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
            <ActionError failure={error} />
            <SubmitButton className="self-start">Guardar cambios</SubmitButton>
          </form>
        </CardBody>
      </section>
    </Card>
  );
}
