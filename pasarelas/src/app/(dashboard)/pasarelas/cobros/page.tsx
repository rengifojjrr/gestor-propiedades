import { ChevronDown, ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TxBulkBar, TxSelectionProvider } from "@/components/pasarelas/tx/TxBulkBar";
import { TxCards } from "@/components/pasarelas/tx/TxCards";
import { TxFilters } from "@/components/pasarelas/tx/TxFilters";
import { TxTable, type TxRowView } from "@/components/pasarelas/tx/TxTable";
import { TxTotals } from "@/components/pasarelas/tx/TxTotals";
import { ButtonLink, DateText, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { hrefWith } from "@/components/ui/url";
import { requireSession } from "@/lib/auth/session";
import { todayNY, totalsOf, type Currency, type PayConfig } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { leanTx, listTx, parseTxFilters, type TxFilters as Filters } from "@/server/pasarelas/queries/transactions";

export const metadata: Metadata = { title: "Cobros" };

const PATH = "/pasarelas/cobros";
const EXPORT_PATH = "/pasarelas/cobros/exportar";
const PAGE_SIZE = 50;
/**
 * El contador de la lista (o, si no hay cobros, el aviso de la lista vacía): recibe el foco tras una acción en lote,
 * que se lleva la barra con el botón pulsado y puede vaciar la lista.
 */
const COUNTER_ID = "cobros-contador";

/** Los filtros que van en «Más filtros». */
const MORE_FILTERS = [
  "companyId",
  "channelId",
  "gatewayId",
  "bankAccountId",
  "currency",
  "status",
  "receipt",
] as const satisfies readonly (keyof Filters)[];

type SearchParams = Record<string, string | string[] | undefined>;

/** Los parámetros de la URL tal como llegaron, para armar enlaces que los conserven. */
function queryOf(sp: SearchParams): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    for (const item of [value].flat()) if (item !== undefined) query.append(key, item);
  }
  return query;
}

/**
 * Las opciones de cada filtro, con los nombres de la configuración. Los canales, de la empresa elegida si la hay;
 * pero el canal elegido va siempre, aunque sea de otra empresa (se cambió la empresa después de elegirlo) o ya no
 * esté en la configuración: si faltara, su select enseñaría «Todos» con el filtro puesto, y elegir «Todos» no lo
 * quitaría (para el navegador ya está elegida). Igual con la moneda elegida.
 */
function filterOptions(cfg: PayConfig, filters: Filters) {
  const companyName = new Map(cfg.companies.map((company) => [company.id, company.name]));
  const severalCompanies = cfg.companies.length > 1;
  const currencies = new Set<Currency>([
    ...cfg.companies.map((company) => company.currency),
    ...cfg.bankAccounts.map((account) => account.currency),
    ...(filters.currency === undefined ? [] : [filters.currency]),
  ]);
  const channelLabel = (channel: PayConfig["channels"][number]) =>
    severalCompanies ? `${channel.name} · ${companyName.get(channel.companyId) ?? ""}` : channel.name;
  const channels = cfg.channels
    .filter((channel) => filters.companyId === undefined || channel.companyId === filters.companyId)
    .map((channel) => ({ value: channel.id, label: channelLabel(channel) }));
  const chosen = filters.channelId;
  if (chosen !== undefined && !channels.some((option) => option.value === chosen)) {
    const channel = cfg.channels.find((item) => item.id === chosen);
    // Fuera de la empresa elegida lleva siempre su empresa: es lo que explica que la lista salga vacía.
    const label =
      channel === undefined ? "Canal que ya no existe" : `${channel.name} · ${companyName.get(channel.companyId) ?? ""}`;
    channels.unshift({ value: chosen, label });
  }
  return {
    companies: cfg.companies.map((company) => ({ value: company.id, label: company.name })),
    channels,
    gateways: cfg.gateways.map((gateway) => ({ value: gateway.id, label: gateway.name })),
    accounts: cfg.bankAccounts.map((account) => ({
      value: account.id,
      label: account.last4 === null ? account.alias : `${account.alias} (…${account.last4})`,
    })),
    currencies: [...currencies].sort().map((currency) => ({ value: currency, label: currency })),
  };
}

/** Los nombres de empresa, canal y pasarela de cada cobro de la página. */
function withNames(cfg: PayConfig) {
  const names = (items: readonly { id: string; name: string }[]) => new Map(items.map((item) => [item.id, item.name]));
  const companies = names(cfg.companies);
  const channels = names(cfg.channels);
  const gateways = names(cfg.gateways);
  return <T extends { companyId: string; channelId: string | null; gatewayId: string }>(tx: T) => ({
    ...tx,
    companyName: companies.get(tx.companyId) ?? "—",
    channelName: tx.channelId === null ? null : (channels.get(tx.channelId) ?? null),
    gatewayName: gateways.get(tx.gatewayId) ?? "—",
  });
}

/**
 * «Exportar CSV»: un menú plegable con los dos formatos de TODO el filtro (no solo la página). `download`: el
 * navegador guarda el archivo. Sin `prefetch`: no se arma el CSV sin que nadie lo pida. «En español»: punto y coma y
 * coma decimal; «estándar»: coma y punto.
 */
function ExportMenu({ href }: { href: (formato: string | null) => string }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control border border-rule-strong bg-surface px-4 py-2 font-semibold hover:bg-sunken [&::-webkit-details-marker]:hidden">
        Exportar CSV
        <ChevronDown aria-hidden className="size-5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <ButtonLink href={href(null)} download prefetch={false}>
          CSV en español
        </ButtonLink>
        <ButtonLink href={href("estandar")} download prefetch={false}>
          CSV estándar
        </ButtonLink>
      </div>
    </details>
  );
}

/**
 * Cobros: búsqueda, filtros, orden y páginas de 50, todo en la URL; los totales de TODO el filtro por moneda
 * (plegados, con una línea de resumen); la selección con sus acciones en lote; y el CSV del filtro, en un menú.
 * Tabla desde 768 px, tarjetas en el celular.
 */
export default async function CobrosPage({ searchParams }: PageProps<"/pasarelas/cobros">) {
  await requireSession();
  const sp = await searchParams;
  const today = todayNY(new Date());
  const { filters, sort, page } = parseTxFilters(sp, today);
  const [supabase, cfg] = await Promise.all([createClient(), getPayConfig()]);
  const [list, lean] = await Promise.all([
    listTx(supabase, filters, sort, page, today, PAGE_SIZE, cfg),
    leanTx(supabase, filters, today, cfg),
  ]);
  const totals = totalsOf(lean);
  const rows: TxRowView[] = list.rows.map(withNames(cfg));
  const query = queryOf(sp);
  const exportHref = (formato: string | null) => hrefWith(EXPORT_PATH, query, { formato });
  const first = (page - 1) * PAGE_SIZE + 1;

  return (
    <>
      <PageHeader title="Cobros" actions={<ExportMenu href={exportHref} />} />
      <div className="flex flex-col gap-5">
        <TxFilters
          {...filterOptions(cfg, filters)}
          activeMore={MORE_FILTERS.filter((key) => filters[key] !== undefined).length}
        />
        {filters.estimatedOn === undefined ? null : (
          <p className="flex flex-wrap items-center gap-x-2 text-ink-soft">
            <span>
              Solo los que caen el <DateText value={filters.estimatedOn} />.
            </span>
            <Link
              href={hrefWith(PATH, query, { estimada: null })}
              className="inline-flex min-h-11 items-center font-semibold text-brand hover:underline"
            >
              Quitar este filtro
            </Link>
          </p>
        )}
        <TxTotals totals={totals} />

        {/* Con otros filtros u otra página, la selección empieza de cero. Va por fuera de la lista: si una acción en
            lote la vacía, lleva el foco al aviso de la lista vacía. */}
        <TxSelectionProvider key={query.toString()} ids={rows.map((tx) => tx.id)} focusAfterId={COUNTER_ID}>
          {list.total === 0 ? (
            <div id={COUNTER_ID} tabIndex={-1}>
              <EmptyState
                icon={<ReceiptText aria-hidden className="size-8" />}
                title="No hay cobros con estos filtros"
                description="Cambia el período, la búsqueda o los filtros, o registra un cobro nuevo."
                action={
                  <ButtonLink href="/pasarelas/registrar" variant="primary">
                    Registrar cobro
                  </ButtonLink>
                }
              />
            </div>
          ) : rows.length === 0 ? (
            <div id={COUNTER_ID} tabIndex={-1}>
              <EmptyState
                title="Esta página ya no tiene cobros"
                description="El filtro tiene menos páginas. Vuelve a la primera."
                action={<ButtonLink href={hrefWith(PATH, query, {})}>Ir a la primera página</ButtonLink>}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p id={COUNTER_ID} tabIndex={-1} className="text-ink-soft">
                Cobros {first}–{first + rows.length - 1} de {list.total}
              </p>
              <TxBulkBar transactions={rows.map(({ id, currency }) => ({ id, currency }))} today={today} />
              <div className="md:hidden">
                <TxCards rows={rows} today={today} />
              </div>
              <div className="hidden md:block">
                <TxTable rows={rows} today={today} />
              </div>
              <Suspense fallback={null}>
                <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} />
              </Suspense>
            </div>
          )}
        </TxSelectionProvider>
      </div>
    </>
  );
}
