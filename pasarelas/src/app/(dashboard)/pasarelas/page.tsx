import { ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import { AccountsChart } from "@/components/pasarelas/summary/AccountsChart";
import { CompanyRanking } from "@/components/pasarelas/summary/CompanyRanking";
import { GatewayCost } from "@/components/pasarelas/summary/GatewayCost";
import { GatewayShare } from "@/components/pasarelas/summary/GatewayShare";
import { MonthChart } from "@/components/pasarelas/summary/MonthChart";
import { Notices } from "@/components/pasarelas/summary/Notices";
import { SplitsTable } from "@/components/pasarelas/summary/SplitsTable";
import { StatCards } from "@/components/pasarelas/summary/StatCards";
import { SummaryFilters } from "@/components/pasarelas/summary/SummaryFilters";
import { UpcomingDeposits } from "@/components/pasarelas/summary/UpcomingDeposits";
import { ButtonLink, DateText, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { todayNY, type PayConfig } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { loadSummary, summaryScope } from "@/server/pasarelas/queries/summary";

export const metadata: Metadata = { title: "Resumen" };

/** Un nombre por id, con un texto de respaldo para lo que ya no está en la configuración. */
function namesOf(items: readonly { id: string; name: string }[], missing: string): (id: string) => string {
  const names = new Map(items.map((item) => [item.id, item.name]));
  return (id) => names.get(id) ?? missing;
}

/** La cuenta como se reconoce: «Cuenta principal (…4321)»; los cobros sin cuenta, «Sin cuenta». */
function accountNames(cfg: PayConfig): (id: string | null) => string {
  const names = namesOf(
    cfg.bankAccounts.map((account) => ({
      id: account.id,
      name: account.last4 === null ? account.alias : `${account.alias} (…${account.last4})`,
    })),
    "Cuenta borrada",
  );
  return (id) => (id === null ? "Sin cuenta" : names(id));
}

/**
 * Las opciones de los filtros. Los canales, de la empresa elegida si la hay (con su empresa si hay varias); el
 * canal elegido va siempre, aunque sea de otra empresa: si faltara, elegir «Todos» no quitaría el filtro.
 */
function filterOptions(cfg: PayConfig, companyId: string | undefined, channelId: string | undefined) {
  const companyName = namesOf(cfg.companies, "");
  const several = cfg.companies.length > 1;
  const label = (channel: PayConfig["channels"][number]) =>
    several ? `${channel.name} · ${companyName(channel.companyId)}` : channel.name;
  const channels = cfg.channels
    .filter((channel) => companyId === undefined || channel.companyId === companyId || channel.id === channelId)
    .map((channel) => ({ value: channel.id, label: label(channel) }));
  if (channelId !== undefined && !channels.some((option) => option.value === channelId)) {
    channels.unshift({ value: channelId, label: "Canal que ya no existe" });
  }
  return {
    companies: cfg.companies.map((company) => ({ value: company.id, label: company.name })),
    channels,
    gateways: cfg.gateways.map((gateway) => ({ value: gateway.id, label: gateway.name })),
  };
}

/**
 * Resumen: los filtros (período, empresa, canal, pasarela y moneda) en la URL; las cifras y los gráficos del
 * período en una sola moneda; lo que cae en los próximos 14 días con «Marcar depositado» por grupo; los repartos
 * por beneficiario y los avisos.
 */
export default async function ResumenPage({ searchParams }: PageProps<"/pasarelas">) {
  await requireSession();
  const sp = await searchParams;
  const today = todayNY(new Date());
  const [supabase, cfg] = await Promise.all([createClient(), getPayConfig()]);
  const view = await loadSummary(supabase, sp, today, cfg);
  const { summary, currency } = view;
  const companyName = namesOf(cfg.companies, "Empresa borrada");
  const gatewayName = namesOf(cfg.gateways, "Pasarela borrada");
  const accountName = accountNames(cfg);
  const beneficiaryName = namesOf(cfg.beneficiaries, "Beneficiario borrado");
  const { filters } = summaryScope(sp, today);

  return (
    <>
      <PageHeader title="Resumen" />
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <SummaryFilters
            {...filterOptions(cfg, filters.companyId, filters.channelId)}
            currencies={view.currencies}
            defaultCurrency={view.defaultCurrency}
          />
          <p className="text-ink-soft">
            Del <DateText value={view.period.from} /> al <DateText value={view.period.to} />
            {currency !== null && view.currencies.length > 1 ? `, en ${currency}` : null}.
          </p>
        </div>

        {summary === null || currency === null ? (
          <EmptyState
            icon={<ReceiptText aria-hidden className="size-8" />}
            title="No hay cobros en este período"
            description="Cambia el período o los filtros, o registra un cobro: aquí verás cuánto entró, cuánto se fue en comisiones y cuándo cae al banco."
            action={
              <ButtonLink href="/pasarelas/registrar" variant="primary">
                Registrar cobro
              </ButtonLink>
            }
          />
        ) : (
          <>
            <section aria-label="Cifras del período">
              <StatCards totals={summary.totals} currency={currency} pendingHref={view.links.pending} />
            </section>
            <section aria-labelledby="resumen-graficos" className="flex flex-col gap-3">
              <h2 id="resumen-graficos" className="titulo text-xl">
                Gráficos
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                <MonthChart months={view.months} totals={summary.totals} currency={currency} />
                <CompanyRanking summary={summary} currency={currency} nameOf={companyName} />
                <GatewayShare summary={summary} currency={currency} nameOf={gatewayName} />
                <GatewayCost summary={summary} currency={currency} nameOf={gatewayName} />
                <AccountsChart summary={summary} currency={currency} nameOf={accountName} />
              </div>
            </section>
          </>
        )}

        <Notices notices={view.notices} />

        {currency === null ? null : (
          <>
            <UpcomingDeposits
              groups={view.deposits.map((group) => ({
                date: group.date,
                accountName: accountName(group.bankAccountId),
                net: group.net,
                count: group.count,
                ids: group.ids,
                overdue: group.overdue,
              }))}
              currency={currency}
              today={today}
              window={view.depositWindow}
            />
            <SplitsTable rows={view.splits} currency={currency} nameOf={beneficiaryName} />
          </>
        )}
      </div>
    </>
  );
}
