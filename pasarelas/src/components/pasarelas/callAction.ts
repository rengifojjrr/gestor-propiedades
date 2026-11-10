import { unstable_rethrow } from "next/navigation";
import type { ActionResult } from "@/server/pasarelas/result";

/**
 * Lo que se dice cuando la llamada a una acción no llegó o su respuesta no volvió (sin señal, un corte): no se
 * sabe si el cambio quedó guardado. No invita a repetir a ciegas: un reembolso repetido se sumaría otra vez. Es el
 * mismo texto en toda la app; al lado va «Ver cómo quedó» (`ActionError`).
 */
export const UNSURE_TEXT = "Se perdió la conexión y no se sabe si se guardó. Revisa cómo quedó antes de repetirlo.";

/** La llamada no llegó o no volvió: no se sabe si se guardó. */
export type UnsureResult = { ok: false; error: string; fieldErrors?: undefined; unsure: true };

/** Lo que devuelve `callAction`: lo que respondió la acción o, si no respondió, la duda. */
export type CallResult<T> = ActionResult<T> | UnsureResult;

/**
 * Llama a una Server Action desde un diálogo, una barra o un botón sin que un fallo de red lo desmonte. Si la
 * llamada lanza (no llegó, o se perdió la respuesta), devuelve un error con `unsure` para pintarlo ahí mismo —en
 * vez de dejar que suba a `error.tsx` y se pierda lo escrito—.
 *
 * No refresca la pantalla por su cuenta: con mala señal el refresco también falla, y entonces Next recarga la
 * página entera (o el navegador enseña la suya de «sin conexión») y se pierden el diálogo, lo escrito y el aviso.
 * Se refresca cuando la persona lo pide («Ver cómo quedó») o cierra el diálogo (`ActionError`).
 *
 * Una redirección de Next (la acción que borra algo y lleva a la lista) no es un fallo: sigue su camino.
 */
export async function callAction<T>(
  action: () => Promise<ActionResult<T>>,
  unsure: string = UNSURE_TEXT,
): Promise<CallResult<T>> {
  return callActionOr(action, (): UnsureResult => ({ ok: false, error: unsure, unsure: true }));
}

/** ¿Es la duda de un corte (no se sabe si se guardó)? */
export const isUnsure = <T>(result: CallResult<T>): result is UnsureResult => !result.ok && "unsure" in result;

/** Un error para pintar con `ActionError`: su texto, y si es la duda de un corte. */
export type ActionFailure = { text: string; unsure: boolean };

/** El error de una respuesta que no salió bien, listo para `ActionError`. */
export function failureOf(result: Extract<CallResult<unknown>, { ok: false }>): ActionFailure {
  return { text: result.error, unsure: "unsure" in result && result.unsure === true };
}

/**
 * Lo que se dice de un corte cuando repetir es seguro (entrar, escribir el código, empezar a activar un
 * dispositivo): no hay duda que revisar, así que no va con «Ver cómo quedó».
 */
export const RETRY_TEXT = "Se perdió la conexión. Revisa tu señal y vuelve a intentarlo.";

/**
 * `callAction` para las acciones que no devuelven el `ActionResult` del módulo (la entrada, Ajustes → Seguridad y
 * cerrar sesión): si la llamada no llega o su respuesta no vuelve, no lanza y devuelve lo que dé `onCut`. Quien
 * llama decide qué decir: que repita (`RETRY_TEXT`) o la duda (`UNSURE_TEXT`). Las redirecciones de Next siguen su
 * camino.
 */
export async function callActionOr<T, U>(action: () => Promise<T>, onCut: () => U): Promise<T | U> {
  try {
    return await action();
  } catch (error) {
    unstable_rethrow(error);
    return onCut();
  }
}
