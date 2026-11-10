/**
 * Reconocer de qué pasarela es un archivo por sus encabezados. Los encabezados reales y sus fuentes están en
 * `presets.ts`.
 */
import { requiredColumns } from "./presets";

export type ImportFormat = "stripe_pagos" | "stripe_saldo" | "paypal_actividad" | "otro";

/** Un nombre de columna tal como se compara: sin la marca BOM, sin espacios alrededor y en minúsculas. */
export function normalizeHeader(header: string): string {
  return header.replace(/^﻿/, "").trim().toLowerCase();
}

const KNOWN = ["stripe_pagos", "stripe_saldo", "paypal_actividad"] as const;

/**
 * El formato cuyo mapeo por defecto encuentra todas sus columnas en el archivo (le pueden sobrar otras). Así, un
 * archivo reconocido siempre se puede importar sin tocar el mapeo. Si no es ninguno, «otro».
 */
export function detectFormat(headers: readonly string[]): ImportFormat {
  const present = new Set(headers.map(normalizeHeader));
  return KNOWN.find((format) => requiredColumns(format).every((c) => present.has(normalizeHeader(c)))) ?? "otro";
}
