/** Identificadores cortos y únicos para registros nuevos. */
export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}`;
}

/** Código legible para reservas, contratos y órdenes (R-1042, C-204, OT-318). */
export function shortCode(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}
