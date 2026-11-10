import "server-only";
import { dec, normPct, toMoney } from "@/lib/pasarelas";
import type { BeneficiaryKind, Currency, ISODate, Money, Pct } from "@/lib/pasarelas";
import type { Db } from "../dto";

/**
 * Lo que leen las pantallas de Repartos: el libro (asignado, liquidado y saldo por beneficiario y moneda, de la
 * vista `pay_beneficiary_balances`), la ficha de un beneficiario y sus repartos, cada uno con su cobro. Dinero y
 * porcentajes con `::text`: PostgREST devuelve `numeric` como número JSON.
 */

/** Filas por página en los movimientos de la ficha. */
export const MOVEMENTS_PAGE_SIZE = 20;

const BALANCE_COLUMNS = "beneficiary_id, currency, assigned::text, settled::text, balance::text";
const BENEFICIARY_COLUMNS = "id, name, kind, account_alias, notes, active";
/** El reparto y, de su cobro, lo que se pinta. `!inner`: solo los repartos de cobros que se pueden ver y cuentan. */
const ALLOCATION_COLUMNS =
  "transaction_id, amount::text, pct::text, is_remainder, pay_transactions!inner(occurred_on, company_id, currency, gross_amount::text)";

/** Lo de un beneficiario en una moneda. `balance` = asignado − liquidado; negativo, lo debe a la empresa. */
export type BeneficiaryBalance = {
  beneficiaryId: string;
  currency: Currency;
  assigned: Money;
  settled: Money;
  balance: Money;
};

export type BeneficiaryView = {
  id: string;
  name: string;
  kind: BeneficiaryKind;
  accountAlias: string | null;
  notes: string | null;
  active: boolean;
};

/** Un reparto del beneficiario con su cobro: la fecha, la empresa y el bruto vigente del cobro. */
export type AllocationMovement = {
  transactionId: string;
  occurredOn: ISODate;
  companyId: string;
  currency: Currency;
  txGross: Money;
  amount: Money;
  pct: Pct;
  isRemainder: boolean;
};

export type MovementsPage<Row> = { rows: Row[]; total: number };

const money = (value: string | null): Money => toMoney(dec(value ?? "0"));

type PageResponse<Row> = {
  data: Row[] | null;
  count: number | null;
  error: { code?: string; message: string } | null;
};

/**
 * Una página (desde 1) de una lectura con su total. Pedir una página más allá de la última no es un error para la
 * persona (un enlace viejo): llega vacía, con el total. Si la lectura llega sin total, lanza: la paginación no
 * podría decir cuántas páginas hay.
 */
export async function readPage<Row>(
  read: (from: number, to: number) => PromiseLike<PageResponse<Row>>,
  page: number,
): Promise<MovementsPage<Row>> {
  const from = (Math.max(1, Math.trunc(page)) - 1) * MOVEMENTS_PAGE_SIZE;
  const { data, count, error } = await read(from, from + MOVEMENTS_PAGE_SIZE - 1);
  // PostgREST responde «Requested range not satisfiable» (PGRST103) si la página empieza después de la última fila.
  if (error?.code === "PGRST103" && from > 0) {
    const first = await read(0, 0);
    if (first.error) throw first.error;
    if (first.count === null) throw new Error("Una lectura por páginas llegó sin el total de filas (count).");
    return { rows: [], total: first.count };
  }
  if (error) throw error;
  if (count === null) throw new Error("Una lectura por páginas llegó sin el total de filas (count).");
  return { rows: data ?? [], total: count };
}

/**
 * El libro: asignado, liquidado y saldo de cada beneficiario en cada moneda (sin papelera ni cobros fallidos).
 * Nunca se mezclan monedas: una fila por beneficiario y moneda, en orden de moneda. Con `beneficiaryId`, solo las
 * suyas. Los nombres los pone la pantalla con la configuración.
 */
export async function listBalances(supabase: Db, beneficiaryId?: string): Promise<BeneficiaryBalance[]> {
  let query = supabase.from("pay_beneficiary_balances").select(BALANCE_COLUMNS);
  if (beneficiaryId !== undefined) query = query.eq("beneficiary_id", beneficiaryId);
  const { data } = await query.order("currency").order("beneficiary_id").throwOnError();
  return data.map((row) => ({
    beneficiaryId: row.beneficiary_id ?? "",
    currency: row.currency ?? "",
    assigned: money(row.assigned),
    settled: money(row.settled),
    balance: money(row.balance),
  }));
}

/**
 * Cuántos cobros usan esa versión de un esquema, también los de la papelera (los dos guardan congelado el reparto
 * con que se registraron). Solo cuenta los del usuario de la sesión.
 */
export async function countSchemeVersionTransactions(supabase: Db, versionId: string): Promise<number> {
  const { count } = await supabase
    .from("pay_transactions")
    .select("id", { count: "exact", head: true })
    .eq("scheme_version_id", versionId)
    .throwOnError();
  if (count === null) throw new Error("La cuenta de cobros de una versión llegó sin el total (count).");
  return count;
}

/** La ficha de un beneficiario, o `null` si no existe (o es de otro usuario). */
export async function getBeneficiary(supabase: Db, id: string): Promise<BeneficiaryView | null> {
  const { data } = await supabase
    .from("pay_beneficiaries")
    .select(BENEFICIARY_COLUMNS)
    .eq("id", id)
    .maybeSingle()
    .throwOnError();
  if (data === null) return null;
  return {
    id: data.id,
    name: data.name,
    kind: data.kind as BeneficiaryKind,
    accountAlias: data.account_alias,
    notes: data.notes,
    active: data.active,
  };
}

/**
 * Los repartos del beneficiario, del cobro más reciente al más viejo, por páginas. Los mismos que suma el libro:
 * sin los cobros de la papelera ni los fallidos.
 */
export async function listBeneficiaryAllocations(
  supabase: Db,
  beneficiaryId: string,
  page: number,
): Promise<MovementsPage<AllocationMovement>> {
  const result = await readPage(
    (from, to) =>
      supabase
        .from("pay_allocations")
        .select(ALLOCATION_COLUMNS, { count: "exact" })
        .eq("beneficiary_id", beneficiaryId)
        .is("pay_transactions.deleted_at", null)
        .neq("pay_transactions.status", "fallido")
        .order("pay_transactions(occurred_on)", { ascending: false })
        .order("transaction_id")
        .range(from, to),
    page,
  );
  return {
    total: result.total,
    rows: result.rows.map((row) => ({
      transactionId: row.transaction_id,
      occurredOn: row.pay_transactions.occurred_on,
      companyId: row.pay_transactions.company_id,
      currency: row.pay_transactions.currency,
      txGross: money(row.pay_transactions.gross_amount),
      amount: money(row.amount),
      pct: normPct(row.pct),
      isRemainder: row.is_remainder,
    })),
  };
}
