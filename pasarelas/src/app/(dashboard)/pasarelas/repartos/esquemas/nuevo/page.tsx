import type { Metadata } from "next";
import { SINCE_START } from "@/components/pasarelas/splits/labels";
import { SchemeEditor } from "@/components/pasarelas/splits/SchemeEditor";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { addDays, todayNY } from "@/lib/pasarelas";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";

export const metadata: Metadata = { title: "Nuevo esquema" };

/**
 * «Nuevo esquema»: rige desde el inicio salvo que se elija otra fecha. Empieza con una línea, sin porcentaje; sin
 * beneficiarios activos, sin líneas, y «Nuevo beneficiario» los agrega ahí mismo.
 */
export default async function NuevoEsquemaPage() {
  await requireSession();
  const cfg = await getPayConfig();
  const beneficiaries = cfg.beneficiaries.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name }));
  const first = beneficiaries[0];

  return (
    <>
      <PageHeader
        title="Nuevo esquema"
        description="Cómo se reparte cada cobro entre tus beneficiarios."
        back={{ href: "/pasarelas/repartos", label: "Repartos" }}
      />
      <Card className="max-w-2xl">
        <CardBody className="flex flex-col gap-4">
          {first === undefined ? (
            // Sin beneficiarios no se manda a otra pantalla: «Nuevo beneficiario» los agrega aquí mismo.
            <p className="text-ink-soft">
              Todavía no tienes beneficiarios activos: agrégalos con «Nuevo beneficiario» y quedan en el esquema.
            </p>
          ) : null}
          <SchemeEditor
            schemeId={null}
            initial={{
              name: "",
              base: "neto",
              remainderBeneficiaryId: null,
              lines: first === undefined ? [] : [{ beneficiaryId: first.id, pct: "", feeExempt: false }],
              effectiveFrom: SINCE_START,
            }}
            beneficiaries={beneficiaries}
            defaultDate={addDays(todayNY(new Date()), 1)}
          />
        </CardBody>
      </Card>
    </>
  );
}
