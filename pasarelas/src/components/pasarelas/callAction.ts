import type { ActionResult } from "@/server/pasarelas/result";

/**
 * Lo que se dice cuando la llamada a una acción no llegó o su respuesta no volvió (sin señal, un corte): no se
 * sabe si el cambio quedó guardado. No invita a repetir a ciegas: un reembolso repetido se sumaría otra vez.
 */
export const UNSURE_TEXT =
  "No se pudo confirmar el cambio por un fallo de conexión. Puede que se haya guardado: revisa el cobro antes de " +
  "repetirlo.";

/**
 * Llama a una Server Action desde un diálogo o una barra sin que un fallo de red lo desmonte. Si la llamada lanza
 * (no llegó, o se perdió la respuesta), devuelve un error con `unsure` para pintarlo en el propio diálogo —en vez
 * de dejar que suba a `error.tsx` y se pierda lo escrito— y refresca la pantalla con `refresh` (`router.refresh`),
 * para que enseñe si el cambio se aplicó. Si el navegador sabe que no hay conexión no refresca: la recarga no
 * llegaría y la pantalla entera cambiaría por la de «sin conexión», con el aviso.
 */
export async function callAction<T>(
  action: () => Promise<ActionResult<T>>,
  refresh: () => void,
  unsure: string = UNSURE_TEXT,
): Promise<ActionResult<T>> {
  try {
    return await action();
  } catch {
    try {
      if (typeof navigator === "undefined" || navigator.onLine !== false) refresh();
    } catch {
      // Refrescar es lo de menos: el aviso ya dice que hay que revisar.
    }
    return { ok: false, error: unsure };
  }
}
