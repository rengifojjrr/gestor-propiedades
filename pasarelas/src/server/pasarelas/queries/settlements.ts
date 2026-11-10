import "server-only";
import { SETTLEMENT_COLUMNS, toSettlement, type Db, type Settlement } from "../dto";
import { readPage, type MovementsPage } from "./splits";

/** Las liquidaciones de un beneficiario, de la más reciente a la más vieja, por páginas. */
export async function listSettlements(
  supabase: Db,
  beneficiaryId: string,
  page: number,
): Promise<MovementsPage<Settlement>> {
  const result = await readPage(
    (from, to) =>
      supabase
        .from("pay_settlements")
        .select(SETTLEMENT_COLUMNS, { count: "exact" })
        .eq("beneficiary_id", beneficiaryId)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    page,
  );
  return { total: result.total, rows: result.rows.map(toSettlement) };
}
