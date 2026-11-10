"use client";

import { useActionState } from "react";
import { RETRY_TEXT, callActionOr } from "@/components/pasarelas/callAction";
import { Alert, Field, Input, SubmitButton } from "@/components/ui";
import { NEXT_PARAM } from "@/lib/auth/next-path";
import { signIn, type SignInState } from "./actions";

const INITIAL: SignInState = {};

/**
 * Entra y, si la llamada no llega o no vuelve (un corte), lo dice aquí con el correo escrito en vez de tirar la
 * pantalla. Repetir es seguro: solo vuelve a entrar.
 */
async function signInOrRetry(previous: SignInState, formData: FormData): Promise<SignInState> {
  return callActionOr(
    () => signIn(previous, formData),
    () => {
      const typed = formData.get("email");
      return { error: RETRY_TEXT, email: typeof typed === "string" ? typed : "" };
    },
  );
}

/** El formulario de entrada. `next` es la ruta (ya validada) a la que se va después de entrar. */
export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInOrRetry, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name={NEXT_PARAM} value={next} />
      {state.error ? <Alert tone="danger" announce title={state.error} /> : null}
      <Field label="Correo">
        <Input
          type="email"
          name="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={state.email}
        />
      </Field>
      <Field label="Contraseña">
        <Input type="password" name="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton pendingLabel="Entrando…">Entrar</SubmitButton>
    </form>
  );
}
