import "server-only";
import { ZERO, dec, payoutStatus, toMoney } from "@/lib/pasarelas";
import type { BeneficiaryAmount, Currency, ISODate, Money, PayoutStatus } from "@/lib/pasarelas";
import { SETTLEMENT_COLUMNS, toSettlement, type Db, type Settlement } from "../dto";
import { EXACT_COUNT, readAll } from "./paging";
import { readPage, type MovementsPage } from "./splits";
import { chunked } from "./transactions";

/**
 * Las liquidaciones y lo que se le pagó a cada parte del reparto de cada cobro. Una liquidación puede estar ligada a
 * sus cobros (`pay_settlement_items`: de qué cobro es y cuánto): así se marca, cobro por cobro, que ya se le pagó a
 * cada parte. Dinero con `::text`: PostgREST devuelve `numeric` como número JSON.
 */

/** Un cobro que paga una liquidación: cuánto de él, y lo que se pinta del cobro (su fecha, lo cobrado y su referencia). */
export type SettlementItemView = {
  transactionId: string;
  amount: Money;
  occurredOn: ISODate;
  currency: Currency;
  grossOriginal: Money;
  reference: string | null;
};

/** Una liquidación con los cobros que paga (ninguno si es de las de siempre, registrada a mano). */
export type SettlementView = Settlement & { items: SettlementItemView[] };

/** Lo pagado ligado a un cobro, liquidación por liquidación: lo que hace falta para «Deshacer». */
export type TxPayout = {
  settlementId: string;
  beneficiaryId: string;
  paidOn: ISODate;
  method: string | null;
  currency: Currency;
  /** El total de la liquidación. */
  amount: Money;
  /** Lo de este cobro. */
  here: Money;
  /** Los otros cobros que paga la misma liquidación: «Deshacer» también los desmarca. */
  others: SettlementItemView[];
};

/** Las partes de una liquidación con su cobro. `!inner`: solo las de cobros que se pueden ver. */
const ITEM_COLUMNS =
  "transaction_id, amount::text, pay_transactions!inner(occurred_on, currency, gross_original::text, reference)";

type ItemRow = {
  transaction_id: string;
  amount: string;
  pay_transactions: { occurred_on: string; currency: string; gross_original: string; reference: string | null };
};

const money = (value: string): Money => toMoney(dec(value));

function toItem(row: ItemRow): SettlementItemView {
  return {
    transactionId: row.transaction_id,
    amount: money(row.amount),
    occurredOn: row.pay_transactions.occurred_on,
    currency: row.pay_transactions.currency,
    grossOriginal: money(row.pay_transactions.gross_original),
    reference: row.pay_transactions.reference,
  };
}

/** Del cobro más viejo al más nuevo (y por id, para que el orden sea estable). */
const byDate = (a: SettlementItemView, b: SettlementItemView): number =>
  a.occurredOn.localeCompare(b.occurredOn) || a.transactionId.localeCompare(b.transactionId);

/**
 * Las liquidaciones de un beneficiario, de la más reciente a la más vieja, por páginas, cada una con los cobros que
 * paga (del más viejo al más nuevo).
 */
export async function listSettlements(
  supabase: Db,
  beneficiaryId: string,
  page: number,
): Promise<MovementsPage<SettlementView>> {
  const result = await readPage(
    (from, to) =>
      supabase
        .from("pay_settlements")
        .select(`${SETTLEMENT_COLUMNS}, pay_settlement_items(${ITEM_COLUMNS})`, { count: "exact" })
        .eq("beneficiary_id", beneficiaryId)
        .order("paid_on", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    page,
  );
  return {
    total: result.total,
    rows: result.rows.map(({ pay_settlement_items: items, ...row }) => ({
      ...toSettlement(row),
      items: items.map(toItem).sort(byDate),
    })),
  };
}

/** Lo que se lee de cada tabla para el estado de pago: el cobro, el beneficiario y el monto. */
type AmountRow = { transaction_id: string; beneficiary_id: string; amount: string };

/** Las filas de esos cobros, agrupadas por cobro, como montos del motor. */
function byTx(rows: readonly AmountRow[]): Map<string, BeneficiaryAmount[]> {
  const grouped = new Map<string, BeneficiaryAmount[]>();
  for (const row of rows) {
    const line = { beneficiaryId: row.beneficiary_id, amount: money(row.amount) };
    grouped.set(row.transaction_id, [...(grouped.get(row.transaction_id) ?? []), line]);
  }
  return grouped;
}

const AMOUNT_COLUMNS = "transaction_id, beneficiary_id, amount::text";

/**
 * Lo que se le debe a cada parte del reparto de esos cobros (`payoutStatus` del motor), por cobro: con el reparto
 * (`pay_allocations`), lo que la pasarela ya le retuvo a cada persona (`pay_retention_shares`) y lo ya pagado ligado
 * a cada cobro (`pay_settlement_items`). `null` para los que no tienen nada que decir: sin reparto, fallidos o en la
 * papelera. Los ids van por tramos (no caben en la URL) y cada tramo se lee entero.
 */
export async function payoutStatuses(
  supabase: Db,
  txs: readonly { id: string; status: string; deletedAt: string | null }[],
): Promise<Map<string, PayoutStatus | null>> {
  const ids = [...new Set(txs.map((tx) => tx.id))];
  const read = (table: "pay_allocations" | "pay_retention_shares" | "pay_settlement_items") =>
    Promise.all(
      chunked(ids).map((chunk) =>
        readAll(
          (from, to) =>
            supabase
              .from(table)
              .select(AMOUNT_COLUMNS, EXACT_COUNT)
              .in("transaction_id", chunk)
              .order("id")
              .range(from, to)
              .throwOnError(),
          `de ${table}`,
        ),
      ),
    ).then((pages) => byTx(pages.flat()));
  const [allocations, retained, paid] = await Promise.all([
    read("pay_allocations"),
    read("pay_retention_shares"),
    read("pay_settlement_items"),
  ]);
  return new Map(
    txs.map((tx) => [
      tx.id,
      payoutStatus({
        counts: tx.deletedAt === null && tx.status !== "fallido",
        allocations: allocations.get(tx.id) ?? [],
        retained: retained.get(tx.id) ?? [],
        paid: paid.get(tx.id) ?? [],
      }),
    ]),
  );
}

/**
 * Lo pagado ligado a un cobro: cada liquidación que lo paga, con lo de este cobro y los otros cobros que paga (para
 * que «Deshacer» diga cuáles se desmarcan y cuánto). De la más reciente a la más vieja.
 */
export async function listTxPayouts(supabase: Db, txId: string): Promise<TxPayout[]> {
  const { data: links } = await supabase
    .from("pay_settlement_items")
    .select("settlement_id")
    .eq("transaction_id", txId)
    .throwOnError();
  if (links.length === 0) return [];
  const { data } = await supabase
    .from("pay_settlements")
    .select(`id, beneficiary_id, paid_on, method, currency, amount::text, pay_settlement_items(${ITEM_COLUMNS})`)
    .in(
      "id",
      links.map((link) => link.settlement_id),
    )
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .throwOnError();
  return data.map((row) => {
    const items = row.pay_settlement_items.map(toItem).sort(byDate);
    return {
      settlementId: row.id,
      beneficiaryId: row.beneficiary_id,
      paidOn: row.paid_on,
      method: row.method,
      currency: row.currency,
      amount: money(row.amount),
      here: items.find((item) => item.transactionId === txId)?.amount ?? ZERO,
      others: items.filter((item) => item.transactionId !== txId),
    };
  });
}
