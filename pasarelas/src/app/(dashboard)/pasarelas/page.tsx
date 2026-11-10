import { ReceiptText } from "lucide-react";
import type { Metadata } from "next";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Resumen" };

/** Resumen mínimo, para que el marco tenga a dónde ir. La pantalla completa lo reemplaza. */
export default function ResumenPage() {
  return (
    <>
      <PageHeader title="Resumen" />
      <EmptyState
        icon={<ReceiptText aria-hidden className="size-8" />}
        title="Todavía no hay cobros"
        description="Registra el primero y aquí verás cuánto entró, cuánto se fue en comisiones y cuándo cae al banco."
        action={
          <ButtonLink href="/pasarelas/registrar" variant="primary">
            Registrar cobro
          </ButtonLink>
        }
      />
    </>
  );
}
