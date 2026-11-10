/**
 * Para `callAction` en las pantallas de comprobantes y liquidaciones: sin refresco automático tras un fallo de red.
 * Con mala señal, refrescar recargaría la página entera y se perdería el aviso. «Ver cómo quedó» refresca cuando la
 * persona lo pide (con `refreshQuietly`).
 */
export const noRefresh = (): void => undefined;

/**
 * Refresca la pantalla cuando la persona toca «Ver cómo quedó», sin que un fallo al refrescar rompa nada: si tampoco
 * llega, el aviso sigue ahí y puede volver a intentarlo.
 */
export function refreshQuietly(refresh: () => void): void {
  try {
    refresh();
  } catch {
    // Si tampoco llega, la persona puede volver a intentarlo.
  }
}
