import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SchemeEditor } from "@/components/pasarelas/splits/SchemeEditor";
import { SchemeStatusActions } from "@/components/pasarelas/splits/SchemeStatusActions";
import { SchemeVersionSummary } from "@/components/pasarelas/splits/SchemeVersionSummary";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { addDays, pickVersion, todayNY } from "@/lib/pasarelas";
import { zId } from "@/server/pasarelas/zod";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";

export const metadata: Metadata = { title: "Esquema de reparto" };

/**
 * Un esquema de reparto: la versión que rige hoy, todas sus versiones (de la más nueva a la más vieja) y el editor de
 * una versión nueva, que parte de la última y rige por defecto desde mañana. Las versiones no se editan: cada cobro
 * guarda congelada la que usó.
 */
export default async function EsquemaPage({ params }: PageProps<"/pasarelas/repartos/esquemas/[id]">) {
  await requireSession();
  const parsed = zId.safeParse((await params).id);
  if (!parsed.success) notFound();
  const cfg = await getPayConfig();
  const scheme = cfg.schemes.find((s) => s.id === parsed.data);
  if (scheme === undefined) notFound();

  const today = todayNY(new Date());
  const current = pickVersion(scheme.versions, today);
  const latest = scheme.versions.at(-1);
  const nameOf = (id: string) => cfg.beneficiaries.find((b) => b.id === id)?.name ?? "Beneficiario borrado";
  // Se pueden elegir los activos y los que ya están en la última versión, aunque estén inactivos.
  const inLatest = new Set([...(latest?.lines.map((line) => line.beneficiaryId) ?? []), latest?.remainderBeneficiaryId]);
  const choices = cfg.beneficiaries.filter((b) => b.active || inLatest.has(b.id)).map((b) => ({ id: b.id, name: b.name }));
  const newestFirst = [...scheme.versions].reverse();

  return (
    <>
      <PageHeader
        title={scheme.name}
        description={scheme.active ? undefined : <Badge>Inactivo</Badge>}
        back={{ href: "/pasarelas/repartos", label: "Repartos" }}
        actions={<SchemeStatusActions id={scheme.id} name={scheme.name} active={scheme.active} />}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <section aria-labelledby="esquema-vigente">
              <CardHeader>
                <CardTitle id="esquema-vigente">Vigente hoy</CardTitle>
              </CardHeader>
              <CardBody>
                {current ? (
                  <SchemeVersionSummary version={current} nameOf={nameOf} />
                ) : (
                  <p className="text-ink-soft">Ninguna versión rige todavía: la primera empieza más adelante.</p>
                )}
              </CardBody>
            </section>
          </Card>
          <Card>
            <section aria-labelledby="esquema-versiones">
              <CardHeader>
                <CardTitle id="esquema-versiones">Versiones</CardTitle>
              </CardHeader>
              <CardBody>
                <ol className="flex flex-col divide-y divide-rule">
                  {newestFirst.map((version) => (
                    <li key={version.id} className="flex flex-col gap-2 py-3">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        Versión {version.version}
                        {version.id === current?.id ? <Badge tone="success">Vigente</Badge> : null}
                      </p>
                      <SchemeVersionSummary version={version} nameOf={nameOf} />
                    </li>
                  ))}
                </ol>
              </CardBody>
            </section>
          </Card>
        </div>
        <Card>
          <section aria-labelledby="esquema-nueva-version">
            <CardHeader>
              <CardTitle id="esquema-nueva-version">Versión nueva</CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <p className="text-ink-soft">
                Cambia el reparto desde una fecha. Lo ya registrado conserva el reparto con el que se registró.
              </p>
              <SchemeEditor
                // Otra clave con cada versión nueva: el editor vuelve a partir de la última guardada.
                key={latest?.id ?? "sin-versiones"}
                schemeId={scheme.id}
                initial={{
                  name: scheme.name,
                  base: latest?.base ?? "neto",
                  remainderBeneficiaryId: latest?.remainderBeneficiaryId ?? null,
                  lines: latest?.lines ?? [],
                  effectiveFrom: addDays(today, 1),
                }}
                beneficiaries={choices}
                defaultDate={addDays(today, 1)}
              />
            </CardBody>
          </section>
        </Card>
      </div>
    </>
  );
}
