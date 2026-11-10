import { ReceiptText } from "lucide-react";
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

/** Las opciones de cada filtro, con los nombres de la configuración. Los canales, de la empresa elegida si la hay. */
function filterOptions(cfg: PayConfig, filters: Filters) {
  const companyName = new Map(cfg.companies.map((company) => [company.id, company.name]));
  const severalCompanies = cfg.companies.length > 1;
  const currencies = new Set<Currency>([
    ...cfg.companies.map((company) => company.currency),
    ...cfg.bankAccounts.map((account) => account.currency),
    ...(filters.currency === undefined ? [] : [filters.currency]),
  ]);
  return {
    companies: cfg.companies.map((company) => ({ value: company.id, label: company.name })),
    channels: cfg.channels
      .filter((channel) => filters.companyId === undefined || channel.companyId === filters.companyId)
      .map((channel) => ({
        value: channel.id,
        label: severalCompanies ? `${channel.name} · ${companyName.get(channel.companyId) ?? ""}` : channel.name,
      })),
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
 * Cobros: búsqueda, filtros, orden y páginas de 50, todo en la URL; los totales de TODO el filtro por moneda;
 * la selección con sus acciones en lote; y el CSV del filtro. Tabla desde 768 px, tarjetas en el celular.
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
      <PageHeader
        title="Cobros"
        actions={
          <>
            {/* `download`: el navegador guarda el archivo. Sin `prefetch`: no se arma el CSV sin que nadie lo pida. */}
            <ButtonLink href={exportHref(null)} download prefetch={false}>
              Exportar CSV (español)
            </ButtonLink>
            <ButtonLink href={exportHref("estandar")} download prefetch={false}>
              Exportar CSV (estándar)
            </ButtonLink>
          </>
        }
      />
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

        {list.total === 0 ? (
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
        ) : rows.length === 0 ? (
          <EmptyState
            title="Esta página ya no tiene cobros"
            description="El filtro tiene menos páginas. Vuelve a la primera."
            action={<ButtonLink href={hrefWith(PATH, query, {})}>Ir a la primera página</ButtonLink>}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-ink-soft">
              Cobros {first}–{first + rows.length - 1} de {list.total}
            </p>
            {/* Con otros filtros u otra página, la selección empieza de cero. */}
            <TxSelectionProvider key={query.toString()} ids={rows.map((tx) => tx.id)}>
              <TxBulkBar transactions={rows.map(({ id, currency }) => ({ id, currency }))} today={today} />
              <div className="md:hidden">
                <TxCards rows={rows} today={today} />
              </div>
              <div className="hidden md:block">
                <TxTable rows={rows} today={today} />
              </div>
            </TxSelectionProvider>
            <Suspense fallback={null}>
              <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} />
            </Suspense>
          </div>
        )}
      </div>
    </>
  );
}
