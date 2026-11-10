import "server-only";
import type { Currency } from "@/lib/pasarelas";
import type { Db } from "../dto";
import { UserError } from "../errors";

/**
 * Las cuentas destino: a dónde cae el dinero de cada pasarela. Solo alias, banco o billetera y últimos 4: nunca el
 * número completo (lo valida la acción y lo vuelve a exigir la base).
 */

const NOT_FOUND_TEXT = "Esa cuenta ya no existe.";

/** Lo que se guarda de una cuenta, ya validado. Sin `id` se crea; con `id`, se edita esa. */
export type BankAccountInput = {
  id: string | null;
  alias: string;
  institution: string | null;
  last4: string | null;
  currency: Currency;
  notes: string | null;
};

/** Si la escritura no tocó ninguna fila, la cuenta no existe (o es de otro usuario: la RLS no la deja ver). */
function expectOne(rows: { id: string }[]): void {
  if (rows.length === 0) throw new UserError(NOT_FOUND_TEXT);
}

/** Crea la cuenta (sin `id`) o edita la que se indica. Devuelve su id. */
export async function saveBankAccount(supabase: Db, a: BankAccountInput): Promise<string> {
  const fields = {
    alias: a.alias,
    institution: a.institution,
    last4: a.last4,
    currency: a.currency,
    notes: a.notes,
  };
  if (a.id === null) {
    const { data } = await supabase.from("pay_bank_accounts").insert(fields).select("id").single().throwOnError();
    return data.id;
  }
  const { data } = await supabase.from("pay_bank_accounts").update(fields).eq("id", a.id).select("id").throwOnError();
  expectOne(data);
  return a.id;
}

/** Activa o desactiva la cuenta. Una cuenta inactiva no se ofrece para cobros nuevos; lo viejo la sigue mostrando. */
export async function setBankAccountActive(supabase: Db, id: string, active: boolean): Promise<void> {
  const { data } = await supabase.from("pay_bank_accounts").update({ active }).eq("id", id).select("id").throwOnError();
  expectOne(data);
}

/**
 * Borra la cuenta. No falla aunque se use: los cobros y las cuentas de pasarela que la tenían quedan sin cuenta
 * (`on delete set null`), y eso cambia el historial. Por eso la pantalla pregunta antes y ofrece desactivarla.
 */
export async function deleteBankAccount(supabase: Db, id: string): Promise<void> {
  const { data } = await supabase.from("pay_bank_accounts").delete().eq("id", id).select("id").throwOnError();
  expectOne(data);
}
