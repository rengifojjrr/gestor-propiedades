import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExtrasCard } from "@/components/pasarelas/gateways/ExtrasCard";
import { FeeVersionsCard } from "@/components/pasarelas/gateways/FeeVersionsCard";
import { GatewaySettingsForm } from "@/components/pasarelas/gateways/GatewaySettingsForm";
import { GatewayStatusActions } from "@/components/pasarelas/gateways/GatewayStatusActions";
import { InternationalCard } from "@/components/pasarelas/gateways/InternationalCard";
import { activeInternational } from "@/components/pasarelas/gateways/international";
import { LagText } from "@/components/pasarelas/gateways/LagText";
import { daysDraft, moneyDraft } from "@/components/pasarelas/gateways/drafts";
import { payoutText } from "@/components/pasarelas/gateways/days";
import { Badge, Card, CardBody, CardHeader, CardTitle, Money, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { addDays, pickVersion, todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { zId } from "@/server/pasarelas/zod";
import { getGateway, listGatewayTotals, type GatewayTotals } from "@/server/pasarelas/queries/gateways";

export const metadata: Metadata = { title: "Pasarela" };

/** Lo que pasó por la pasarela en toda la historia (sin papelera ni fallidos) y cuánto tardó en caer. */
function TotalsCard({ totals, payout }: { totals: GatewayTotals[]; payout: string }) {
  return (
    <Card>
      <section aria-labelledby="pasarela-tiempo-real">
        <CardHeader>
          <CardTitle id="pasarela-tiempo-real">Tiempo real de depósito</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            <dt className="text-ink-soft">Configurado</dt>
            <dd>{payout}</dd>
            <dt className="text-ink-soft">Real</dt>
            <dd>
              <LagText totals={totals} />
            </dd>
          </dl>
          {totals.length === 0 ? (
            <p className="text-ink-soft">Todavía no hay cobros con esta pasarela.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {totals.map((row) => (
                <li key={row.currency} className="flex flex-col gap-1 rounded-control bg-sunken p-3">
                  <p className="font-semibold">
                    {row.txCount === 1 ? "1 cobro" : `${row.txCount} cobros`} en {row.currency} ·{" "}
                    {row.depositedCount === 1 ? "1 depositado" : `${row.depositedCount} depositados`}
                  </p>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                    <dt className="text-ink-soft">Bruto</dt>
                    <dd className="text-right">
                      <Money value={row.gross} currency={row.currency} />
                    </dd>
                    <dt className="text-ink-soft">Comisiones</dt>
                    <dd className="text-right">
                      <Money value={row.fees} currency={row.currency} />
                    </dd>
                    <dt className="text-ink-soft">Neto</dt>
                    <dd className="text-right">
                      <Money value={row.net} currency={row.currency} />
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </section>
    </Card>
  );
}

/**
 * La ficha de una pasarela: sus tarifas con «vigente desde», su recargo a los pagos internacionales, sus opciones,
 * sus datos y su tiempo real.
 */
export default async function PasarelaPage({ params }: PageProps<"/pasarelas/pasarelas/[id]">) {
  await requireSession();
  const parsed = zId.safeParse((await params).id);
  if (!parsed.success) notFound();
  const supabase = await createClient();
  const [gateway, allTotals] = await Promise.all([getGateway(supabase, parsed.data), listGatewayTotals(supabase)]);
  if (gateway === null) notFound();

  const today = todayNY(new Date());
  const current = pickVersion(gateway.feeVersions, today);
  const totals = allTotals.filter((row) => row.gatewayId === gateway.id);
  const payout = payoutText(gateway.payoutDays, gateway.payoutDayType, gateway.payoutDaysMax);
  const international = activeInternational(gateway);

  return (
    <>
      <PageHeader
        title={gateway.name}
        description={gateway.active ? undefined : <Badge>Inactiva</Badge>}
        back={{ href: "/pasarelas/pasarelas", label: "Pasarelas" }}
        actions={<GatewayStatusActions id={gateway.id} name={gateway.name} active={gateway.active} />}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <FeeVersionsCard
            gatewayId={gateway.id}
            versions={gateway.feeVersions}
            currentId={current?.id ?? null}
            defaultFrom={addDays(today, 1)}
          />
          <InternationalCard
            // Otra clave si cambia lo guardado: la tarjeta vuelve a partir de ahí (también al agregarlo o quitarlo).
            key={
              international === null
                ? "sin-recargo"
                : [
                    international.id,
                    international.pct,
                    international.fixed,
                    international.payoutDaysOverride,
                    international.payoutDaysOverrideMax,
                  ].join("|")
            }
            gatewayId={gateway.id}
            dayType={gateway.payoutDayType}
            fee={current === null ? null : { pct: current.pct, fixed: current.fixed }}
            international={international}
          />
          <ExtrasCard gatewayId={gateway.id} dayType={gateway.payoutDayType} extras={gateway.extras} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <TotalsCard totals={totals} payout={payout} />
          <GatewaySettingsForm
            // Otra clave si cambian los datos guardados: el formulario vuelve a partir de lo guardado.
            key={[
              gateway.name,
              gateway.payoutDays,
              gateway.payoutDaysMax,
              gateway.payoutDayType,
              gateway.refundsReturnFee,
              gateway.disputeFee,
              gateway.notes ?? "",
            ].join("|")}
            id={gateway.id}
            initial={{
              name: gateway.name,
              payoutDays: String(gateway.payoutDays),
              payoutDaysMax: daysDraft(gateway.payoutDaysMax),
              payoutDayType: gateway.payoutDayType,
              refundsReturnFee: gateway.refundsReturnFee,
              disputeFee: moneyDraft(gateway.disputeFee),
              notes: gateway.notes ?? "",
            }}
          />
        </div>
      </div>
    </>
  );
}
