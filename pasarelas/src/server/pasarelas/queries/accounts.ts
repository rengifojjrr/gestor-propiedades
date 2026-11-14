import "server-only";
import { dec, toMoney } from "@/lib/pasarelas";
import type { Currency, Money } from "@/lib/pasarelas";
import type { Db } from "../dto";

/**
 * Lo que pinta la pantalla de cuentas destino: cada cuenta con lo que ya cayó en ella, lo que está por caer y
 * cuánto tarda, por moneda (vista `pay_bank_account_totals`, con la definición única de «por caer»), y cuántos
 * cobros y cuentas de pasarela la usan (lo que cambia si se borra). Lo que cae es lo que llega al banco: el neto
 * menos lo que retuvieron las pasarelas (`*Payout`).
 */

const ACCOUNT_COLUMNS = "id, alias, institution, last4, currency, notes, active";
/** Dinero y días con `::text`: PostgREST devuelve `numeric` como número JSON. */
const ACCOUNT_TOTALS_COLUMNS =
  "bank_account_id, currency, deposited_count, deposited_net::text, pending_count, pending_net::text, avg_days::text, median_days::text, deposited_payout::text, pending_payout::text";

type AccountRow = {
  id: string;
  alias: string;
  institution: string | null;
  last4: string | null;
  currency: string;
  notes: string | null;
  active: boolean;
};
type AccountTotalsRow = {
  bank_account_id: string | null;
  currency: string | null;
  deposited_count: number | null;
  deposited_net: string | null;
  pending_count: number | null;
  pending_net: string | null;
  avg_days: string | null;
  median_days: string | null;
  deposited_payout: string | null;
  pending_payout: string | null;
};

/** Lo de una cuenta en una moneda. Los días son de calendario, entre el cobro y el depósito real (2 decimales). */
export type BankAccountTotals = {
  currency: Currency;
  depositedCount: number;
  depositedNet: Money;
  pendingCount: number;
  pendingNet: Money;
  /** Lo que llegó al banco de lo depositado: su neto menos lo retenido. */
  depositedPayout: Money;
  /** Lo que llega al banco de lo que está por caer: su neto menos lo retenido. */
  pendingPayout: Money;
  /** `null` si todavía no hay depósitos. */
  avgDays: string | null;
  medianDays: string | null;
};

export type BankAccountView = {
  id: string;
  alias: string;
  institution: string | null;
  last4: string | null;
  currency: Currency;
  notes: string | null;
  active: boolean;
  /** Por moneda, en orden alfabético. Vacío si no tiene cobros. */
  totals: BankAccountTotals[];
  /** Los cobros que la usan, contando los fallidos y los de la papelera: todos quedarían sin cuenta al borrarla. */
  txCount: number;
  /** Las cuentas de pasarela de las empresas que la tienen por defecto. */
  gatewayCount: number;
};

const money = (value: string | null): Money => toMoney(dec(value ?? "0"));

function toTotals(row: AccountTotalsRow): BankAccountTotals {
  return {
    currency: row.currency ?? "",
    depositedCount: row.deposited_count ?? 0,
    depositedNet: money(row.deposited_net),
    pendingCount: row.pending_count ?? 0,
    pendingNet: money(row.pending_net),
    depositedPayout: money(row.deposited_payout),
    pendingPayout: money(row.pending_payout),
    avgDays: row.avg_days,
    medianDays: row.median_days,
  };
}

/** Cuántos cobros usan la cuenta. Una petición sin filas: solo el total. */
async function txCountOf(supabase: Db, id: string): Promise<number> {
  const { count } = await supabase
    .from("pay_transactions")
    .select("id", { count: "exact", head: true })
    .eq("bank_account_id", id)
    .throwOnError();
  if (count === null) throw new Error("El conteo de cobros de una cuenta llegó sin el total (count).");
  return count;
}

/**
 * Todas las cuentas del usuario, las activas primero y por alias. Las cuentas son pocas: los cobros de cada una se
 * cuentan con una petición por cuenta, todas a la vez.
 */
export async function listBankAccounts(supabase: Db): Promise<BankAccountView[]> {
  const [accounts, totals, gateways] = await Promise.all([
    supabase
      .from("pay_bank_accounts")
      .select(ACCOUNT_COLUMNS)
      .order("active", { ascending: false })
      .order("alias")
      .order("id")
      .throwOnError(),
    supabase.from("pay_bank_account_totals").select(ACCOUNT_TOTALS_COLUMNS).order("currency").throwOnError(),
    supabase.from("pay_company_gateways").select("bank_account_id").not("bank_account_id", "is", null).throwOnError(),
  ]);
  const rows: AccountRow[] = accounts.data;
  const txCounts = await Promise.all(rows.map((row) => txCountOf(supabase, row.id)));
  const totalsRows: AccountTotalsRow[] = totals.data;
  return rows.map((row, index) => ({
    id: row.id,
    alias: row.alias,
    institution: row.institution,
    last4: row.last4,
    currency: row.currency,
    notes: row.notes,
    active: row.active,
    totals: totalsRows.filter((t) => t.bank_account_id === row.id).map(toTotals),
    txCount: txCounts[index] ?? 0,
    gatewayCount: gateways.data.filter((g) => g.bank_account_id === row.id).length,
  }));
}
