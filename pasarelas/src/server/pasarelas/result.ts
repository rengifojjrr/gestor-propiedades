/**
 * Lo que devuelve una Server Action: el dato, o el mensaje para la persona (y, si la entrada no pasó la
 * validación, los problemas de cada campo). Solo es un tipo: se puede importar también desde el navegador.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
