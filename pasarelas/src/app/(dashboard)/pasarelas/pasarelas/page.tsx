import { CreditCard, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FeeText } from "@/components/pasarelas/gateways/FeeText";
import { isOption } from "@/components/pasarelas/gateways/international";
import { LagText } from "@/components/pasarelas/gateways/LagText";
import { payoutText } from "@/components/pasarelas/gateways/days";
import { Badge, ButtonLink, Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { pickVersion, todayNY } from "@/lib/pasarelas";
import type { GatewayCfg } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { listGatewayTotals, type GatewayTotals } from "@/server/pasarelas/queries/gateways";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";

export const metadata: Metadata = { title: "Pasarelas" };

const ADD = (
  <ButtonLink href="/pasarelas/pasarelas/nueva" variant="primary">
    <Plus aria-hidden className="size-5" />
    Agregar pasarela
  </ButtonLink>
);

/** Una pasarela de la lista: su tarifa de hoy, cuándo cae el dinero y cuánto tarda de verdad. */
function GatewayItem({ gateway, totals, today }: { gateway: GatewayCfg; totals: GatewayTotals[]; today: string }) {
  const fee = pickVersion(gateway.feeVersions, today);
  // El recargo internacional no cuenta como una opción.
  const options = gateway.extras.filter((extra) => extra.active && isOption(extra)).length;
  const titleId = `pasarela-${gateway.id}`;
  return (
    <Card>
      <article aria-labelledby={titleId}>
        <CardBody className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={titleId} className="titulo text-lg leading-snug">
              <Link
                href={`/pasarelas/pasarelas/${gateway.id}`}
                className="-my-2 inline-flex min-h-11 items-center text-brand hover:underline"
              >
                {gateway.name}
              </Link>
            </h2>
            {gateway.active ? null : <Badge>Inactiva</Badge>}
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-soft">Tarifa vigente</dt>
            <dd>{fee ? <FeeText pct={fee.pct} fixed={fee.fixed} /> : "Sin tarifa"}</dd>
            <dt className="text-ink-soft">Depósito</dt>
            <dd>{payoutText(gateway.payoutDays, gateway.payoutDayType, gateway.payoutDaysMax)}</dd>
            <dt className="text-ink-soft">Tiempo real</dt>
            <dd>
              <LagText totals={totals} />
            </dd>
            <dt className="text-ink-soft">Opciones</dt>
            <dd>{options === 0 ? "Ninguna" : options === 1 ? "1 opción" : `${options} opciones`}</dd>
          </dl>
        </CardBody>
      </article>
    </Card>
  );
}

/** Pasarelas: cada una con su tarifa vigente, sus días al depósito y su tiempo real de depósito. */
export default async function PasarelasPage() {
  await requireSession();
  const supabase = await createClient();
  const [cfg, totals] = await Promise.all([getPayConfig(), listGatewayTotals(supabase)]);
  const today = todayNY(new Date());
  // Las activas primero; dentro de cada grupo, por nombre (como llegan).
  const gateways = [...cfg.gateways].sort((a, b) => Number(b.active) - Number(a.active));

  return (
    <>
      <PageHeader
        title="Pasarelas"
        description="Lo que cobra cada una y cuándo cae el dinero."
        actions={gateways.length > 0 ? ADD : undefined}
      />
      {gateways.length === 0 ? (
        <EmptyState
          icon={<CreditCard aria-hidden className="size-8" />}
          title="Todavía no hay pasarelas"
          description="Agrega la primera con su comisión y sus días al depósito para poder registrar cobros."
          action={ADD}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {gateways.map((gateway) => (
            <li key={gateway.id}>
              <GatewayItem
                gateway={gateway}
                totals={totals.filter((row) => row.gatewayId === gateway.id)}
                today={today}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
