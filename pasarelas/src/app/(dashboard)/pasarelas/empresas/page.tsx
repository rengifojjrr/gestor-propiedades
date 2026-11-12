import { Building2, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CompanyLogo } from "@/components/pasarelas/companies/CompanyLogo";
import { Badge, ButtonLink, EmptyState, Money, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { companyLogoUrls, listCompanies } from "@/server/pasarelas/queries/companies";

export const metadata: Metadata = { title: "Empresas" };

/** Las empresas del dueño, con lo que cada una facturó en total (por moneda). Cada una lleva a su ficha. */
export default async function EmpresasPage() {
  await requireSession();
  const supabase = await createClient();
  const companies = await listCompanies(supabase);
  const logos = await companyLogoUrls(
    supabase,
    companies.flatMap((company) => (company.logoPath === null ? [] : [company.logoPath])),
  );

  const action = (
    <ButtonLink href="/pasarelas/empresas/nueva" variant="primary">
      Nueva empresa
    </ButtonLink>
  );

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Cada empresa con sus pasarelas, sus canales y lo que factura."
        actions={action}
      />
      {companies.length === 0 ? (
        <EmptyState
          icon={<Building2 aria-hidden className="size-8" />}
          title="Todavía no hay empresas"
          description="Crea la primera: sus cobros, sus pasarelas y sus canales cuelgan de ella."
          action={action}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {companies.map((company) => (
            <li key={company.id}>
              <Link
                href={`/pasarelas/empresas/${company.id}`}
                className="flex min-h-11 items-center gap-3 rounded-card border border-rule bg-surface p-4 hover:border-rule-strong"
              >
                <CompanyLogo
                  name={company.name}
                  url={company.logoPath === null ? null : (logos.get(company.logoPath) ?? null)}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="titulo text-lg leading-snug break-words">{company.name}</span>
                    {company.active ? null : <Badge>Inactiva</Badge>}
                  </span>
                  <span className="text-sm text-ink-soft">
                    {company.totals.length === 0 ? (
                      "Sin cobros todavía"
                    ) : (
                      <>
                        Facturado en total:{" "}
                        {company.totals.map((total, index) => (
                          <span key={total.currency}>
                            {index > 0 ? " · " : null}
                            <Money value={total.sale} currency={total.currency} className="text-ink" />
                          </span>
                        ))}
                      </>
                    )}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-soft" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
