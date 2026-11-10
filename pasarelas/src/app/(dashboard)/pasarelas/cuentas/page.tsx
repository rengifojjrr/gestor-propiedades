import { Landmark } from "lucide-react";
import type { Metadata } from "next";
import { AccountCard } from "@/components/pasarelas/accounts/AccountCard";
import { NewAccountButton } from "@/components/pasarelas/accounts/NewAccountButton";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listBankAccounts } from "@/server/pasarelas/queries/accounts";

export const metadata: Metadata = { title: "Cuentas destino" };

/** Cuentas destino: a dónde cae el dinero, cuánto cayó, cuánto está por caer y cuánto tarda. */
export default async function CuentasPage() {
  await requireSession();
  const supabase = await createClient();
  const accounts = await listBankAccounts(supabase);

  return (
    <>
      <PageHeader
        title="Cuentas destino"
        description="A dónde cae el dinero de cada pasarela. Solo alias y últimos 4: nunca el número completo."
        actions={accounts.length > 0 ? <NewAccountButton /> : undefined}
      />
      {accounts.length === 0 ? (
        <EmptyState
          icon={<Landmark aria-hidden className="size-8" />}
          title="Todavía no hay cuentas destino"
          description="Agrega la cuenta del banco o la billetera donde te depositan, y verás cuánto cae en cada una y cuánto tarda."
          action={<NewAccountButton />}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} />
          ))}
        </div>
      )}
    </>
  );
}
