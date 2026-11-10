import type { Metadata } from "next";
import { NewGatewayForm } from "@/components/pasarelas/gateways/NewGatewayForm";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Agregar pasarela" };

/** «Agregar pasarela»: sus datos, su tarifa y sus opciones, de una vez. */
export default async function NuevaPasarelaPage() {
  await requireSession();
  return (
    <>
      <PageHeader
        title="Agregar pasarela"
        description="Su comisión, cuándo cae el dinero y lo que cobra aparte."
        back={{ href: "/pasarelas/pasarelas", label: "Pasarelas" }}
      />
      <NewGatewayForm />
    </>
  );
}
