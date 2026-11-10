import type { ActionResult } from "@/server/pasarelas/result";

/** Lo que se dice cuando no se pudo pedir la URL firmada de un comprobante (la llamada no llegó o no volvió). */
export const OPEN_FAILED_TEXT = "No se pudo abrir el comprobante. Revisa la conexión y vuelve a intentarlo.";

/**
 * Abre un comprobante PDF en otra pestaña con una URL firmada pedida en ese momento (una pedida antes ya podría haber
 * caducado: vale 60 segundos).
 *
 * La pestaña se abre en el mismo toque, antes de esperar al servidor, porque abierta después el navegador la
 * bloquearía; y sin `opener`, para que el PDF no pueda tocar esta pestaña. Cuando llega la URL se lleva al PDF. Si
 * la URL no se pudo pedir, la pestaña vacía se cierra y el mensaje va a `onError`. Si el navegador no dejó abrir la
 * pestaña, el PDF se abre en esta.
 *
 * Se llama directamente desde el toque (por ejemplo, dentro de `startTransition`, que corre su función en el acto):
 * la pestaña se abre y la URL se pide antes de que esta función devuelva. Nunca lanza: si `getUrl` lanza, es como si
 * no hubiera podido pedir la URL.
 */
export async function openSignedPdf(
  getUrl: () => Promise<ActionResult<{ url: string }>>,
  onError: (message: string) => void,
): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab !== null) tab.opener = null;
  let result: ActionResult<{ url: string }>;
  try {
    result = await getUrl();
  } catch {
    result = { ok: false, error: OPEN_FAILED_TEXT };
  }
  if (!result.ok) {
    tab?.close();
    onError(result.error);
    return;
  }
  if (tab !== null) tab.location.href = result.data.url;
  else window.location.assign(result.data.url);
}
