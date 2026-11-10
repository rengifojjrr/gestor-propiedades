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
