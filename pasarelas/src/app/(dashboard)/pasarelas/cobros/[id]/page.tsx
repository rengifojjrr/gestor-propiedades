import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TxDetail } from "@/components/pasarelas/tx/TxDetail";
import { PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { formatMoney, todayNY } from "@/lib/pasarelas";
import { createClient } from "@/lib/supabase/server";
import { getPayConfig } from "@/server/pasarelas/queries/session-config";
import { getTx } from "@/server/pasarelas/queries/transactions";

export const metadata: Metadata = { title: "Cobro" };

/**
 * El detalle de un cobro: el desglose congelado, el reparto, los comprobantes, el historial y lo que se puede hacer
 * con él según su estado. Un cobro de la papelera también se ve, para restaurarlo. Si no existe (o no es del
 * usuario), 404.
 */
export default async function CobroPage({ params }: PageProps<"/pasarelas/cobros/[id]">) {
  await requireSession();
  const { id } = await params;
  const [supabase, cfg] = await Promise.all([createClient(), getPayConfig()]);
  const tx = await getTx(supabase, id);
  if (tx === null) notFound();
  const trashed = tx.deletedAt !== null;

  return (
    <>
      <PageHeader
        title={`Cobro de ${formatMoney(tx.grossOriginal, tx.currency)}`}
        description={tx.reference === null ? undefined : <span className="break-all">{tx.reference}</span>}
        back={trashed ? { href: "/pasarelas/papelera", label: "Papelera" } : { href: "/pasarelas/cobros", label: "Cobros" }}
      />
      <TxDetail tx={tx} cfg={cfg} today={todayNY(new Date())} />
    </>
  );
}
