import { formatDate } from "@/lib/pasarelas/dates";
import { STATUS_LABEL } from "@/lib/pasarelas/status";
import type { ISODate, PayConfig } from "@/lib/pasarelas/types";
import { parseTxFilters, type TxFilters, type TxSort } from "../queries/transactions";
import { zId } from "../zod";

/*
 * Qué cobros entran en el PDF, cómo se dice lo que abarca y cómo se llama el archivo. Sin base ni reloj: `today`
 * (hoy en Nueva York) entra como parámetro.
 */

/** Cuántos cobros admite un PDF. Con más, no se arma: se pide acotar. */
export const PDF_MAX = 300;

/**
 * Los cobros elegidos en la lista (por id, en su orden), o los del filtro de la lista con su orden.
 */
export type PdfRequest = { kind: "elegidos"; ids: string[] } | { kind: "filtro"; filters: TxFilters; sort: TxSort };

/**
 * Lo que pide la URL de `/pasarelas/cobros/pdf`:
 * - con `id` (uno por cobro), los elegidos: cada id válido una vez, en su orden. Lo que no es un id se ignora;
 * - sin `id`, las mismas claves que la lista y el CSV (`parseTxFilters`; la página no cuenta). Además
 *   `periodo=hoy`: solo el día de hoy en Nueva York (`desde` y `hasta` no cuentan).
 * Todo valor es entrada no confiable: nunca lanza.
 */
export function pdfRequestOf(params: URLSearchParams, today: ISODate): PdfRequest {
  if (params.has("id")) {
    const ids = params.getAll("id").flatMap((value) => zId.safeParse(value).data ?? []);
    return { kind: "elegidos", ids: [...new Set(ids)] };
  }
  // Un parámetro repetido llega como lista: `parseTxFilters` se queda con el primero, igual que en la pantalla.
  const sp: Record<string, string[]> = Object.fromEntries(
    [...new Set(params.keys())].map((key) => [key, params.getAll(key)]),
  );
  if (sp.periodo?.[0] === "hoy") Object.assign(sp, { periodo: ["personalizado"], desde: [today], hasta: [today] });
  const { filters, sort } = parseTxFilters(sp, today);
  return { kind: "filtro", filters, sort };
}

/** «Hoy, sáb 14 nov 2026», «El vie 13 nov 2026» o «Del dom 1 nov 2026 al sáb 14 nov 2026». */
function periodText(from: ISODate, to: ISODate, today: ISODate): string {
  if (from !== to) return `Del ${formatDate(from)} al ${formatDate(to)}`;
  return from === today ? `Hoy, ${formatDate(from)}` : `El ${formatDate(from)}`;
}

const STATUS_FILTER_LABEL: Record<NonNullable<TxFilters["status"]>, string> = {
  ...STATUS_LABEL,
  por_caer: "Por caer",
  atrasado: "Atrasados",
};

const RECEIPT_LABEL: Record<NonNullable<TxFilters["receipt"]>, string> = {
  con: "Con comprobante",
  sin: "Sin comprobante",
};

/** «Empresa: Tienda Demo», o «Empresa que ya no existe» si no está en la configuración. */
function named(items: readonly { id: string; name: string }[], id: string, label: string, gone: string): string {
  const name = items.find((item) => item.id === id)?.name;
  return name === undefined ? gone : `${label}: ${name}`;
}

/** Cada filtro puesto, en palabras y en el orden de la pantalla. */
function filterTexts(f: TxFilters, cfg: PayConfig): string[] {
  const account = cfg.bankAccounts.find((item) => item.id === f.bankAccountId);
  return [
    f.companyId === undefined ? null : named(cfg.companies, f.companyId, "Empresa", "Empresa que ya no existe"),
    f.channelId === undefined ? null : named(cfg.channels, f.channelId, "Canal", "Canal que ya no existe"),
    f.gatewayId === undefined ? null : named(cfg.gateways, f.gatewayId, "Pasarela", "Pasarela que ya no existe"),
    f.bankAccountId === undefined
      ? null
      : account === undefined
        ? "Cuenta que ya no existe"
        : `Cuenta destino: ${account.alias}${account.last4 === null ? "" : ` ··${account.last4}`}`,
    f.currency === undefined ? null : `Moneda: ${f.currency}`,
    f.status === undefined ? null : `Estado: ${STATUS_FILTER_LABEL[f.status]}`,
    f.receipt === undefined ? null : RECEIPT_LABEL[f.receipt],
    f.estimatedOn === undefined ? null : `Caen el ${formatDate(f.estimatedOn)}`,
    f.q === undefined ? null : `Búsqueda: «${f.q}»`,
  ].filter((text) => text !== null);
}

/**
 * Lo que abarca el PDF: «Seleccionados (12)» (los que salen) o el período y los filtros, en palabras: «Del dom 1 nov
 * 2026 al sáb 14 nov 2026 · Empresa: Tienda Demo · Estado: Depositado».
 */
export function scopeText(request: PdfRequest, count: number, cfg: PayConfig, today: ISODate): string {
  if (request.kind === "elegidos") return `Seleccionados (${count})`;
  const { filters } = request;
  // `parseTxFilters` siempre pone las dos fechas del período.
  const period = periodText(filters.from ?? today, filters.to ?? today, today);
  return [period, ...filterTexts(filters, cfg)].join(" · ");
}

/** `cobros-AAAA-MM-DD.pdf` (hoy en Nueva York), o `cobros-elegidos-AAAA-MM-DD.pdf`. */
export function pdfFileName(request: PdfRequest, today: ISODate): string {
  return request.kind === "elegidos" ? `cobros-elegidos-${today}.pdf` : `cobros-${today}.pdf`;
}

/** «Son 412 cobros; el PDF admite hasta 300. Acota el filtro.» (o «Elige menos.» con los elegidos). */
export function tooManyText(request: PdfRequest, count: number): string {
  const fix = request.kind === "elegidos" ? "Elige menos." : "Acota el filtro.";
  return `Son ${count} cobros; el PDF admite hasta ${PDF_MAX}. ${fix}`;
}
