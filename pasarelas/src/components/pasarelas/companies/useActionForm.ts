"use client";

import { useState } from "react";
import type { ActionResult } from "@/server/pasarelas/result";

const NETWORK_TEXT = "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.";

/**
 * Lo que necesita un formulario que llama a una Server Action: corre la llamada y guarda el error de cada campo
 * (`errorOf`) y el general (`formError`). Una llamada que no llega (sin conexión) da un error general.
 */
export function useActionForm() {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function submit<T>(call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
    let result: ActionResult<T>;
    try {
      result = await call();
    } catch {
      result = { ok: false, error: NETWORK_TEXT };
    }
    setFieldErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    setFormError(result.ok ? null : result.error);
    return result;
  }

  return { submit, formError, errorOf: (field: string): string | undefined => fieldErrors[field]?.[0] };
}
