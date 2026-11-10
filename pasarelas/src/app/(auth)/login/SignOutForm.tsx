"use client";

import { useState, type ReactNode } from "react";
import { ActionError } from "@/components/pasarelas/ActionError";
import { UNSURE_TEXT, callActionOr, type ActionFailure } from "@/components/pasarelas/callAction";
import { signOut } from "./actions";

/** Un corte al cerrar sesión: no se sabe si se cerró. */
const UNSURE: ActionFailure = { text: UNSURE_TEXT, unsure: true };

export type SignOutFormProps = {
  /** Lo de adentro del formulario: el texto y los botones de enviar (con `name="scope"` si eligen cuál). */
  children: ReactNode;
  className?: string;
};

/**
 * El formulario que cierra la sesión, en la pantalla del código y en Ajustes. Al botón pulsado le llega su `scope`
 * (`local` o `global`) a la acción, y al salir bien la acción lleva a la entrada. Si la llamada no llega o no
 * vuelve (un corte), no se sabe si se cerró: se dice debajo, con «Ver cómo quedó» (si ya se cerró, la pantalla lo
 * dice y lleva a volver a entrar).
 */
export function SignOutForm({ children, className }: SignOutFormProps) {
  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const submit = async (formData: FormData) => {
    // Al salir bien, la acción lleva a la entrada: esa redirección sigue su camino y aquí no vuelve nada.
    const failed = await callActionOr(
      async () => {
        await signOut(formData);
        return null;
      },
      () => UNSURE,
    );
    setFailure(failed);
  };

  return (
    <>
      <form action={submit} className={className}>
        {children}
      </form>
      <ActionError failure={failure} />
    </>
  );
}
