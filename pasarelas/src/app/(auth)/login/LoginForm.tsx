"use client";

import { useActionState } from "react";
import { Alert, Field, Input, SubmitButton } from "@/components/ui";
import { NEXT_PARAM } from "@/lib/auth/next-path";
import { signIn, type SignInState } from "./actions";

const INITIAL: SignInState = {};

/** El formulario de entrada. `next` es la ruta (ya validada) a la que se va después de entrar. */
export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name={NEXT_PARAM} value={next} />
      {state.error ? <Alert tone="danger" title={state.error} /> : null}
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
