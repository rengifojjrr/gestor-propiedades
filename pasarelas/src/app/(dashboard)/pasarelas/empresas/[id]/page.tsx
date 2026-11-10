import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyCard } from "@/components/pasarelas/companies/CompanyCard";
import { CompanySummary } from "@/components/pasarelas/companies/CompanySummary";
import { ChannelsCard } from "@/components/pasarelas/companies/ChannelsCard";
import { GatewaysCard } from "@/components/pasarelas/companies/GatewaysCard";
import { Badge, ButtonLink, PageHeader } from "@/components/ui";
import { summarize, todayNY } from "@/lib/pasarelas";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { companyLogoUrls, getCompany } from "@/server/pasarelas/queries/companies";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { leanTx, parseTxFilters } from "@/server/pasarelas/queries/transactions";

export const metadata: Metadata = { title: "Empresa" };

/**
 * La ficha de una empresa: lo facturado (en el período de la URL y en total, por mes y por pasarela), sus datos y
 * su logo, sus pasarelas con los links al panel y de pago, y sus canales de venta con su costo.
 */
export default async function EmpresaPage({ params, searchParams }: PageProps<"/pasarelas/empresas/[id]">) {
  await requireSession();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const [company, cfg] = await Promise.all([getCompany(supabase, id), getPayConfig()]);
  if (company === null) notFound();

  const today = todayNY(new Date());
  // Del filtro de la URL solo vale el período: la empresa es esta.
  const { from, to } = parseTxFilters(sp, today).filters;
  const [rows, logos] = await Promise.all([
    leanTx(supabase, { companyId: company.id, from, to }, today, cfg),
    companyLogoUrls(supabase, company.logoPath === null ? [] : [company.logoPath]),
  ]);
  const period = summarize(rows, today);

  const scheme = cfg.schemes.find((option) => option.id === company.defaultSchemeId) ?? null;
  const schemes = cfg.schemes.filter((option) => option.active || option.id === company.defaultSchemeId);
  const gateways = cfg.gateways.map((gateway) => ({
    id: gateway.id,
    name: gateway.name,
    active: gateway.active,
    payoutDays: gateway.payoutDays,
    payoutDayType: gateway.payoutDayType,
    extras: gateway.extras.map(({ id: extraId, name, defaultOn, active }) => ({
      id: extraId,
      name,
      defaultOn,
      active,
    })),
  }));
  const bankAccounts = cfg.bankAccounts.map((account) => ({
    id: account.id,
    label: account.last4 ? `${account.alias} ··${account.last4}` : account.alias,
    active: account.active,
  }));

  return (
    <>
      <PageHeader
        title={company.name}
        back={{ href: "/pasarelas/empresas", label: "Empresas" }}
        description={company.active ? undefined : <Badge>Inactiva</Badge>}
        actions={
          <ButtonLink href={`/pasarelas/cobros?empresa=${company.id}`} variant="primary">
            Ver sus cobros
          </ButtonLink>
        }
      />
      <div className="flex flex-col gap-4">
        <CompanySummary
          period={period}
          totals={company.totals}
          gatewayNames={new Map(cfg.gateways.map((gateway) => [gateway.id, gateway.name]))}
        />
        <CompanyCard
          company={{
            id: company.id,
            active: company.active,
            name: company.name,
            website: company.website ?? "",
            currency: company.currency,
            defaultSchemeId: company.defaultSchemeId ?? "",
            notes: company.notes ?? "",
          }}
          logoUrl={company.logoPath === null ? null : (logos.get(company.logoPath) ?? null)}
          schemeName={scheme?.name ?? null}
          schemes={schemes.map(({ id: schemeId, name }) => ({ id: schemeId, name }))}
        />
        <GatewaysCard
          companyId={company.id}
          accounts={company.gateways}
          gateways={gateways}
          bankAccounts={bankAccounts}
        />
        <ChannelsCard companyId={company.id} currency={company.currency} channels={company.channels} />
      </div>
    </>
  );
}
