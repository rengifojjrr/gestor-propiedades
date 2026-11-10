import type { Metadata } from "next";
import { CompanyForm } from "@/components/pasarelas/companies/CompanyForm";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";

export const metadata: Metadata = { title: "Nueva empresa" };

/** Crear una empresa. Al guardarla se va a su ficha, donde se le agregan pasarelas, canales y logo. */
export default async function NuevaEmpresaPage() {
  await requireSession();
  const cfg = await getPayConfig();
  const schemes = cfg.schemes.filter((scheme) => scheme.active).map(({ id, name }) => ({ id, name }));

  return (
    <>
      <PageHeader
        title="Nueva empresa"
        back={{ href: "/pasarelas/empresas", label: "Empresas" }}
        description="Después, en su ficha, le agregas sus pasarelas, sus canales de venta y su logo."
      />
      <Card className="max-w-xl">
        <CardBody>
          <CompanyForm schemes={schemes} />
        </CardBody>
      </Card>
    </>
  );
}
