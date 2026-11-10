import { Users } from "lucide-react";
import type { Metadata } from "next";
import { SINCE_START } from "@/components/pasarelas/splits/labels";
import { SchemeEditor } from "@/components/pasarelas/splits/SchemeEditor";
import { ButtonLink, Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { addDays, todayNY } from "@/lib/pasarelas";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";

export const metadata: Metadata = { title: "Nuevo esquema" };

/** «Nuevo esquema»: rige desde el inicio salvo que se elija otra fecha. Empieza con una línea, sin porcentaje. */
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
      {first === undefined ? (
        <EmptyState
          icon={<Users aria-hidden className="size-8" />}
          title="Todavía no hay beneficiarios activos"
          description="Agrégalos en Repartos y vuelve aquí para armar el esquema."
          action={<ButtonLink href="/pasarelas/repartos">Ir a Repartos</ButtonLink>}
        />
      ) : (
        <Card className="max-w-2xl">
          <CardBody>
            <SchemeEditor
              schemeId={null}
              initial={{
                name: "",
                base: "neto",
                remainderBeneficiaryId: null,
                lines: [{ beneficiaryId: first.id, pct: "" }],
                effectiveFrom: SINCE_START,
              }}
              beneficiaries={beneficiaries}
              defaultDate={addDays(todayNY(new Date()), 1)}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
