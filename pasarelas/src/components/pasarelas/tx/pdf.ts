/*
 * Las direcciones del PDF de cobros. Viven fuera de `PdfButton` (de cliente): una constante que exporta un módulo
 * `"use client"` le llega al servidor como referencia de cliente, no como texto.
 */

/** La ruta que arma el PDF de cobros. */
export const PDF_PATH = "/pasarelas/cobros/pdf";

/** El PDF de esos cobros elegidos: un `id` por cobro, en su orden. */
export function selectedPdfHref(ids: readonly string[]): string {
  return `${PDF_PATH}?${new URLSearchParams(ids.map((id) => ["id", id])).toString()}`;
}
