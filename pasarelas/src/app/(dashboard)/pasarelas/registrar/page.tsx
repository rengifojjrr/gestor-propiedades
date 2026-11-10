import { Building2, CreditCard } from "lucide-react";
import type { Metadata } from "next";
import { RegisterForm, type RegisterSelection } from "@/components/pasarelas/registrar/RegisterForm";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { instantToLocalInput } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { lastTx } from "@/server/pasarelas/queries/transactions";

export const metadata: Metadata = { title: "Registrar cobro" };

/**
 * «Registrar cobro». La configuración llega entera al formulario: la vista previa calcula con ella en el navegador,
 * con el mismo motor que el servidor. Lo que depende del reloj o del azar (la hora de «ahora» y el id del primer
 * cobro) se calcula aquí, una vez: así el servidor y el navegador pintan lo mismo.
 */
export default async function RegistrarPage() {
  await requireSession();
  const cfg = await getPayConfig();

  const hasCompany = cfg.companies.some((company) => company.active);
  const hasGateway = cfg.gateways.some((gateway) => gateway.active);
  if (!hasCompany || !hasGateway) {
    return (
      <>
        <PageHeader title="Registrar cobro" />
        <EmptyState
          icon={hasCompany ? <CreditCard aria-hidden className="size-8" /> : <Building2 aria-hidden className="size-8" />}
          title={hasCompany ? "Falta una pasarela" : "Falta una empresa"}
          description={
            hasCompany
              ? "Para registrar un cobro hace falta al menos una pasarela, con su tarifa."
              : "Para registrar un cobro hace falta al menos una empresa: la que cobra."
          }
          action={
            <ButtonLink href={hasCompany ? "/pasarelas/pasarelas" : "/pasarelas/empresas"} variant="primary">
              {hasCompany ? "Agregar una pasarela" : "Agregar una empresa"}
            </ButtonLink>
          }
        />
      </>
    );
  }

  const tx = await lastTx(await createClient());
  const last: RegisterSelection | null =
    tx === null
      ? null
      : {
          companyId: tx.companyId,
          channelId: tx.channelId,
          gatewayId: tx.gatewayId,
          extraIds: tx.breakdown.rules.extras.map((option) => option.id),
          schemeId: tx.schemeId,
          currency: tx.currency,
        };

  return (
    <RegisterForm
      cfg={cfg}
      initialId={crypto.randomUUID()}
      now={instantToLocalInput(new Date().toISOString())}
      last={last}
    />
  );
}
