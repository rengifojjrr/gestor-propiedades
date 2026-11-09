import type { ISODate } from "./types";

/**
 * La versión (tarifa o esquema) que rige en la fecha `on`: la de `effectiveFrom` más reciente que sea ≤ `on`.
 * Si todavía no rige ninguna, la más antigua; con la lista vacía, `null`. El orden de la lista no importa.
 */
export function pickVersion<T extends { effectiveFrom: ISODate }>(versions: readonly T[], on: ISODate): T | null {
  let current: T | null = null;
  let oldest: T | null = null;
  for (const version of versions) {
    if (oldest === null || version.effectiveFrom < oldest.effectiveFrom) oldest = version;
    if (version.effectiveFrom <= on && (current === null || version.effectiveFrom > current.effectiveFrom)) {
      current = version;
    }
  }
  return current ?? oldest;
}
