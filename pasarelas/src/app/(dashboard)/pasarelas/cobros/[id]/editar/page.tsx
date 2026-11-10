import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EditForm } from "@/components/pasarelas/tx/EditForm";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { instantToLocalInput } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { getSnapshots } from "@/server/pasarelas/queries/transactions";
import { zId } from "@/server/pasarelas/zod";

export const metadata: Metadata = { title: "Editar cobro" };

/**
 * Editar un cobro. Uno de la papelera no se edita: se vuelve a su detalle, donde se restaura. Si no existe (o no
 * es del usuario), 404.
 */
export default async function EditarCobroPage({ params }: PageProps<"/pasarelas/cobros/[id]/editar">) {
  await requireSession();
  const { id } = await params;
  const txId = zId.safeParse(id).data;
  if (txId === undefined) notFound();
  const [supabase, cfg] = await Promise.all([createClient(), getPayConfig()]);
  const [tx] = await getSnapshots(supabase, [txId]);
  if (tx === undefined) notFound();
  if (tx.deletedAt !== null) redirect(`/pasarelas/cobros/${tx.id}`);

  return (
    <>
      <PageHeader
        title="Editar cobro"
        description="Solo se vuelve a calcular lo que cambies; lo demás conserva las reglas con que se registró."
        back={{ href: `/pasarelas/cobros/${tx.id}`, label: "El cobro" }}
      />
      <EditForm cfg={cfg} tx={tx} occurredLocal={instantToLocalInput(tx.occurredAt)} />
    </>
  );
}
