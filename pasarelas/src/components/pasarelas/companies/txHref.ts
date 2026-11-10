import type { ISODate } from "@/lib/pasarelas/types";
import type { CompanyTotal } from "@/server/pasarelas/queries/companies";

/**
 * «Ver sus cobros» desde la ficha de una empresa: la lista de Cobros filtrada por ella y con TODO su historial
 * (sin período, la lista abriría solo el mes en curso). Va desde su primer cobro hasta hoy, o hasta el último si
 * hay alguno a futuro. Sin cobros, la lista de la empresa tal cual.
 */
export function companyTxHref(companyId: string, totals: readonly CompanyTotal[], today: ISODate): string {
  const base = `/pasarelas/cobros?empresa=${companyId}`;
  if (totals.length === 0) return base;
  const from = totals.map((t) => t.firstOn).reduce((a, b) => (b < a ? b : a));
  const to = totals.map((t) => t.lastOn).reduce((a, b) => (b > a ? b : a), today);
  return `${base}&periodo=personalizado&desde=${from}&hasta=${to}`;
}
