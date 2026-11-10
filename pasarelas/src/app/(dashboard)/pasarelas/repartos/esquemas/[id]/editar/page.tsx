import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SchemeEditor, SchemeNameForm } from "@/components/pasarelas/splits/SchemeEditor";
import { cobros } from "@/components/pasarelas/tx/plural";
import { Alert, ButtonLink, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import type { SchemeVersionCfg } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { countSchemeVersionTransactions } from "@/server/pasarelas/queries/splits";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { zId } from "@/server/pasarelas/zod";

export const metadata: Metadata = { title: "Editar esquema" };

/** La última versión: la que rige desde más tarde. */
function lastVersion(versions: readonly SchemeVersionCfg[]): SchemeVersionCfg | undefined {
  return versions.reduce<SchemeVersionCfg | undefined>(
    (last, version) => (last === undefined || version.effectiveFrom > last.effectiveFrom ? version : last),
    undefined,
  );
}

/**
 * Corregir la última versión de un esquema, sin crear otra. Solo si ningún cobro la usa (también los de la
 * papelera): entonces se corrige todo menos su «vigente desde», y la base la reemplaza conservando su número. Si ya
 * repartió cobros no se corrige (cambiaría lo repartido): se dice cuántos, se lleva a «Versión nueva» y se deja
 * cambiar solo el nombre. Si el esquema no existe (o es de otro usuario), 404.
 */
export default async function EditarEsquemaPage({ params }: PageProps<"/pasarelas/repartos/esquemas/[id]/editar">) {
  await requireSession();
  const parsed = zId.safeParse((await params).id);
  if (!parsed.success) notFound();
  const [supabase, cfg] = await Promise.all([createClient(), getPayConfig()]);
  const scheme = cfg.schemes.find((s) => s.id === parsed.data);
  const latest = scheme === undefined ? undefined : lastVersion(scheme.versions);
  if (scheme === undefined || latest === undefined) notFound();
  const used = await countSchemeVersionTransactions(supabase, latest.id);

  const schemeHref = `/pasarelas/repartos/esquemas/${scheme.id}`;
  // Se pueden elegir los activos y los que ya están en la versión, aunque estén inactivos.
  const inLatest = new Set([...latest.lines.map((line) => line.beneficiaryId), latest.remainderBeneficiaryId]);
  const choices = cfg.beneficiaries.filter((b) => b.active || inLatest.has(b.id)).map((b) => ({ id: b.id, name: b.name }));

  return (
    <>
      <PageHeader
        title="Editar esquema"
        description={`Versión ${latest.version} de «${scheme.name}», la última.`}
        back={{ href: schemeHref, label: "El esquema" }}
      />
      {used === 0 ? (
        <Card className="max-w-2xl">
          <CardBody className="flex flex-col gap-4">
            <Alert tone="info">Ningún cobro usa todavía esta versión: se corrige tal cual.</Alert>
            <SchemeEditor
              key={latest.id}
              schemeId={scheme.id}
              correcting
              initial={{
                name: scheme.name,
                base: latest.base,
                remainderBeneficiaryId: latest.remainderBeneficiaryId,
                lines: latest.lines,
                effectiveFrom: latest.effectiveFrom,
              }}
              beneficiaries={choices}
              defaultDate={latest.effectiveFrom}
            />
          </CardBody>
        </Card>
      ) : (
        <div className="flex max-w-2xl flex-col gap-4">
          <Alert tone="warning" title={`Esta versión ya repartió ${cobros(used)}: no se corrige.`}>
            Corregirla cambiaría lo ya repartido (también cuentan los cobros de la papelera). Para repartir distinto de
            aquí en adelante, crea una versión nueva desde una fecha.
          </Alert>
          <ButtonLink href={`${schemeHref}#esquema-nueva-version`} className="self-start">
            Ir a «Versión nueva»
          </ButtonLink>
          <Card>
            <section aria-labelledby="esquema-nombre">
              <CardHeader>
                <CardTitle id="esquema-nombre">Cambiar solo el nombre</CardTitle>
              </CardHeader>
              <CardBody className="flex flex-col gap-4">
                <p className="text-ink-soft">El nombre no cambia ningún reparto: se cambia sin crear una versión.</p>
                <SchemeNameForm schemeId={scheme.id} name={scheme.name} />
              </CardBody>
            </section>
          </Card>
        </div>
      )}
    </>
  );
}
