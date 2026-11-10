import { FileUp } from "lucide-react";
import type { Metadata } from "next";
import { ImportScreen } from "@/components/pasarelas/import/ImportScreen";
import { defaultExtrasKey, type ImportChoices } from "@/components/pasarelas/import/plan";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { defaultExtraIds } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { getImportMappings } from "@/server/pasarelas/queries/import";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";

export const metadata: Metadata = { title: "Importar CSV" };

const HEADER = (
  <PageHeader
    title="Importar CSV"
    description="Trae los cobros de un archivo de Stripe, PayPal u otra pasarela, sin repetir los que ya están."
  />
);

/** «Importar CSV»: lo que se puede elegir (solo lo activo) y el mapeo recordado de cada pasarela. */
export default async function ImportarPage() {
  await requireSession();
  const supabase = await createClient();
  const [cfg, saved] = await Promise.all([getPayConfig(), getImportMappings(supabase)]);

  const companies = cfg.companies.filter((company) => company.active);
  const gateways = cfg.gateways.filter((gateway) => gateway.active);
  if (companies.length === 0 || gateways.length === 0) {
    const noCompany = companies.length === 0;
    return (
      <>
        {HEADER}
        <EmptyState
          icon={<FileUp aria-hidden className="size-8" />}
          title={noCompany ? "Primero agrega una empresa" : "Primero agrega una pasarela"}
          description="Cada cobro que se importa es de una empresa y llegó por una pasarela."
          action={
            <ButtonLink href={noCompany ? "/pasarelas/empresas" : "/pasarelas/pasarelas/nueva"} variant="primary">
              {noCompany ? "Ir a Empresas" : "Agregar pasarela"}
            </ButtonLink>
          }
        />
      </>
    );
  }

  const choices: ImportChoices = {
    companies: companies.map(({ id, name }) => ({ id, name })),
    channels: cfg.channels
      .filter((channel) => channel.active)
      .map(({ id, companyId, name }) => ({ id, companyId, name })),
    gateways: gateways.map(({ id, name, extras }) => ({
      id,
      name,
      extras: extras.filter((extra) => extra.active).map((extra) => ({ id: extra.id, name: extra.name })),
    })),
    defaultExtras: Object.fromEntries(
      companies.flatMap((company) =>
        gateways.map((gateway) => [
          defaultExtrasKey(company.id, gateway.id),
          defaultExtraIds(cfg, company.id, gateway.id),
        ]),
      ),
    ),
  };

  return (
    <>
      {HEADER}
      <ImportScreen choices={choices} saved={saved} />
    </>
  );
}
