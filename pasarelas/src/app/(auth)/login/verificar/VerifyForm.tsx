"use client";

import { useActionState } from "react";
import { RETRY_TEXT, callActionOr } from "@/components/pasarelas/callAction";
import { Alert, Field, Input, SubmitButton } from "@/components/ui";
import { NEXT_PARAM } from "@/lib/auth/next-path";
import { verifyCode, type VerifyState } from "../actions";

const INITIAL: VerifyState = {};

/**
 * Comprueba el código y, si la llamada no llega o no vuelve (un corte), lo dice aquí en vez de tirar la pantalla.
 * Repetir es seguro: si el código sí había entrado, `verifyCode` lleva a donde se iba.
 */
async function verifyOrRetry(previous: VerifyState, formData: FormData): Promise<VerifyState> {
  return callActionOr(
    () => verifyCode(previous, formData),
    () => ({ error: RETRY_TEXT }),
  );
}

/** Pide el código de 6 dígitos de la app de autenticación. `next` es la ruta (ya validada) a la que se va después. */
export function VerifyForm({ next }: { next: string }) {
  const [state, action] = useActionState(verifyOrRetry, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name={NEXT_PARAM} value={next} />
      {state.error ? <Alert tone="danger" announce title={state.error} /> : null}
      <Field label="Código" hint="Los 6 dígitos que muestra tu app de autenticación.">
        <Input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          className="cifra text-lg tracking-widest"
        />
      </Field>
      <SubmitButton pendingLabel="Verificando…">Verificar</SubmitButton>
    </form>
  );
}
