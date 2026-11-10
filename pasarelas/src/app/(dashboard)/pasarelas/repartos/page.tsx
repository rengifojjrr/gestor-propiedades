import { Plus, Split } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Ledger, type BalanceRow } from "@/components/pasarelas/splits/BalanceList";
import { KIND_LABEL } from "@/components/pasarelas/splits/labels";
import { NewBeneficiaryButton } from "@/components/pasarelas/splits/NewBeneficiaryButton";
import { SchemeVersionSummary } from "@/components/pasarelas/splits/SchemeVersionSummary";
import { Badge, ButtonLink, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { pickVersion, todayNY } from "@/lib/pasarelas";
import type { PayConfig, SchemeCfg } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { listBalances } from "@/server/pasarelas/queries/splits";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";

export const metadata: Metadata = { title: "Repartos" };

const NEW_SCHEME = (
  <ButtonLink href="/pasarelas/repartos/esquemas/nuevo">
    <Plus aria-hidden className="size-5" />
    Nuevo esquema
  </ButtonLink>
);

/** Un esquema de la lista: la versión que rige hoy (o, si todavía no rige ninguna, la primera que va a regir). */
function SchemeItem({ scheme, today, nameOf }: { scheme: SchemeCfg; today: string; nameOf: (id: string) => string }) {
  const version = pickVersion(scheme.versions, today) ?? scheme.versions[0];
  return (
    <li className="flex min-w-0 flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="titulo text-base leading-snug">
          <Link
            href={`/pasarelas/repartos/esquemas/${scheme.id}`}
            className="-my-2 inline-flex min-h-11 items-center text-brand hover:underline"
          >
            {scheme.name}
          </Link>
        </h3>
        {scheme.active ? null : <Badge>Inactivo</Badge>}
      </div>
      {version ? <SchemeVersionSummary version={version} nameOf={nameOf} /> : null}
    </li>
  );
}

/** El libro: los beneficiarios con movimientos, en el orden de la configuración (por nombre). */
function ledgerEntries(cfg: PayConfig, balances: Awaited<ReturnType<typeof listBalances>>) {
  return cfg.beneficiaries
    .map((beneficiary) => ({
      id: beneficiary.id,
      name: beneficiary.name,
      rows: balances.filter((row) => row.beneficiaryId === beneficiary.id) satisfies BalanceRow[],
    }))
    .filter((entry) => entry.rows.length > 0);
}

/** Repartos: el libro por beneficiario y moneda, los esquemas de reparto y los beneficiarios. */
export default async function RepartosPage() {
  await requireSession();
  const supabase = await createClient();
  const [cfg, balances] = await Promise.all([getPayConfig(), listBalances(supabase)]);
  const today = todayNY(new Date());
  const nameOf = (id: string) => cfg.beneficiaries.find((b) => b.id === id)?.name ?? "Beneficiario borrado";
  const entries = ledgerEntries(cfg, balances);
  const schemes = [...cfg.schemes].sort((a, b) => Number(b.active) - Number(a.active));
  const beneficiaries = [...cfg.beneficiaries].sort((a, b) => Number(b.active) - Number(a.active));

  return (
    <>
      <PageHeader
        title="Repartos"
        description="Lo que le toca a cada beneficiario de los cobros, lo que ya se le pagó y cómo se reparte cada cobro."
      />
      <div className="flex flex-col gap-4">
        <Card>
          <section aria-labelledby="repartos-libro">
            <CardHeader>
              <CardTitle id="repartos-libro">Libro</CardTitle>
            </CardHeader>
            <CardBody>
              {entries.length === 0 ? (
                <p className="text-ink-soft">
                  Todavía no hay repartos ni liquidaciones. Cuando registres un cobro con esquema, aquí verás lo que le
                  toca a cada uno.
                </p>
              ) : (
                <Ledger entries={entries} />
              )}
            </CardBody>
          </section>
        </Card>

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <section aria-labelledby="repartos-esquemas">
              <CardHeader>
                <CardTitle id="repartos-esquemas">Esquemas</CardTitle>
                {schemes.length > 0 && beneficiaries.length > 0 ? NEW_SCHEME : null}
              </CardHeader>
              <CardBody>
                {schemes.length === 0 ? (
                  <EmptyState
                    icon={<Split aria-hidden className="size-8" />}
                    title="Todavía no hay esquemas"
                    description={
                      beneficiaries.length === 0
                        ? "Primero agrega los beneficiarios; después arma cómo se reparte cada cobro entre ellos."
                        : "Arma cómo se reparte cada cobro entre tus beneficiarios, por ejemplo 50/30/20."
                    }
                    action={beneficiaries.length === 0 ? undefined : NEW_SCHEME}
                  />
                ) : (
                  <ul className="flex flex-col divide-y divide-rule">
                    {schemes.map((scheme) => (
                      <SchemeItem key={scheme.id} scheme={scheme} today={today} nameOf={nameOf} />
                    ))}
                  </ul>
                )}
              </CardBody>
            </section>
          </Card>

          <Card>
            <section aria-labelledby="repartos-beneficiarios">
              <CardHeader>
                <CardTitle id="repartos-beneficiarios">Beneficiarios</CardTitle>
                <NewBeneficiaryButton />
              </CardHeader>
              <CardBody>
                {beneficiaries.length === 0 ? (
                  <p className="text-ink-soft">
                    Todavía no hay beneficiarios: agrega a quienes reciben una parte de los cobros.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-rule">
                    {beneficiaries.map((beneficiary) => (
                      <li key={beneficiary.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <Link
                          href={`/pasarelas/repartos/beneficiarios/${beneficiary.id}`}
                          className="inline-flex min-h-11 items-center font-semibold text-brand hover:underline"
                        >
                          {beneficiary.name}
                        </Link>
                        <span className="flex items-center gap-2 text-sm text-ink-soft">
                          {KIND_LABEL[beneficiary.kind]}
                          {beneficiary.active ? null : <Badge>Inactivo</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </section>
          </Card>
        </div>
      </div>
    </>
  );
}
