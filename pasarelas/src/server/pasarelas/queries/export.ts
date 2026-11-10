import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * «Exportar todo»: la copia propia del dueño, en JSON. Todas las filas de las 17 tablas `pay_*` con todas sus
 * columnas, leídas con la sesión de quien la pide (la RLS deja salir solo lo suyo; nada de `service_role`).
 * No incluye los archivos de los comprobantes: solo sus filas.
 */

export type ExportFile = {
  format: "pasarelas-export";
  version: 1;
  /** El instante de la exportación (ISO 8601). */
  exportedAt: string;
  /** Las 17 tablas `pay_*`, cada fila con todas sus columnas y el dinero como texto exacto ("90.30"). */
  tables: Record<string, Record<string, unknown>[]>;
};

type Tables = Database["public"]["Tables"];
type TableName = keyof Tables;
type RowOf<Table extends TableName> = Tables[Table] extends { Row: infer Row } ? Row : never;

/** Cómo se pide cada columna: tal cual, o con `::text` (los `numeric`: montos y porcentajes). */
const AS_IS = "as-is";
const TEXT = "text";
type ColumnRead = typeof AS_IS | typeof TEXT;

/**
 * Las columnas de cada tabla. PostgREST devuelve `numeric` como número de JSON, así que el dinero y los
 * porcentajes van con `::text` y salen tal como están guardados ("90.30", "2.9000").
 *
 * `satisfies` contra el tipo de la base: si una tabla o una columna nueva no está aquí, no compila.
 */
const EXPORT_COLUMNS = {
  pay_companies: {
    id: AS_IS,
    user_id: AS_IS,
    name: AS_IS,
    website: AS_IS,
    logo_path: AS_IS,
    currency: AS_IS,
    default_scheme_id: AS_IS,
    notes: AS_IS,
    active: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_channels: {
    id: AS_IS,
    user_id: AS_IS,
    company_id: AS_IS,
    name: AS_IS,
    url: AS_IS,
    platform_fee_pct: TEXT,
    platform_fee_fixed: TEXT,
    active: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_gateways: {
    id: AS_IS,
    user_id: AS_IS,
    name: AS_IS,
    payout_days: AS_IS,
    payout_day_type: AS_IS,
    refunds_return_fee: AS_IS,
    dispute_fee: TEXT,
    import_mapping: AS_IS,
    notes: AS_IS,
    active: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_gateway_fee_versions: {
    id: AS_IS,
    user_id: AS_IS,
    gateway_id: AS_IS,
    pct: TEXT,
    fixed: TEXT,
    effective_from: AS_IS,
    note: AS_IS,
    created_at: AS_IS,
  },
  pay_gateway_extras: {
    id: AS_IS,
    user_id: AS_IS,
    gateway_id: AS_IS,
    name: AS_IS,
    pct: TEXT,
    fixed: TEXT,
    base: AS_IS,
    default_on: AS_IS,
    payout_days_override: AS_IS,
    active: AS_IS,
    sort: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_bank_accounts: {
    id: AS_IS,
    user_id: AS_IS,
    alias: AS_IS,
    institution: AS_IS,
    last4: AS_IS,
    currency: AS_IS,
    notes: AS_IS,
    active: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_company_gateways: {
    id: AS_IS,
    user_id: AS_IS,
    company_id: AS_IS,
    gateway_id: AS_IS,
    dashboard_url: AS_IS,
    checkout_url: AS_IS,
    bank_account_id: AS_IS,
    payout_days_override: AS_IS,
    default_extra_ids: AS_IS,
    active: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_beneficiaries: {
    id: AS_IS,
    user_id: AS_IS,
    name: AS_IS,
    kind: AS_IS,
    account_alias: AS_IS,
    notes: AS_IS,
    active: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_schemes: {
    id: AS_IS,
    user_id: AS_IS,
    name: AS_IS,
    notes: AS_IS,
    active: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_scheme_versions: {
    id: AS_IS,
    user_id: AS_IS,
    scheme_id: AS_IS,
    version: AS_IS,
    base: AS_IS,
    remainder_beneficiary_id: AS_IS,
    effective_from: AS_IS,
    created_at: AS_IS,
  },
  pay_scheme_lines: {
    id: AS_IS,
    user_id: AS_IS,
    scheme_version_id: AS_IS,
    beneficiary_id: AS_IS,
    pct: TEXT,
    sort: AS_IS,
    created_at: AS_IS,
  },
  pay_transactions: {
    id: AS_IS,
    user_id: AS_IS,
    occurred_at: AS_IS,
    occurred_on: AS_IS,
    company_id: AS_IS,
    channel_id: AS_IS,
    gateway_id: AS_IS,
    currency: AS_IS,
    gross_original: TEXT,
    refunded_amount: TEXT,
    gross_amount: TEXT,
    fees_total: TEXT,
    net_amount: TEXT,
    alloc_base: AS_IS,
    alloc_base_amount: TEXT,
    breakdown: AS_IS,
    fee_version_id: AS_IS,
    scheme_id: AS_IS,
    scheme_version_id: AS_IS,
    reference: AS_IS,
    note: AS_IS,
    status: AS_IS,
    dispute_state: AS_IS,
    dispute_opened_on: AS_IS,
    dispute_closed_on: AS_IS,
    estimated_deposit_on: AS_IS,
    estimated_is_manual: AS_IS,
    deposited_on: AS_IS,
    bank_account_id: AS_IS,
    receipts_count: AS_IS,
    deleted_at: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_allocations: {
    id: AS_IS,
    user_id: AS_IS,
    transaction_id: AS_IS,
    beneficiary_id: AS_IS,
    amount: TEXT,
    base: AS_IS,
    pct: TEXT,
    is_remainder: AS_IS,
    created_at: AS_IS,
  },
  pay_transaction_receipts: {
    id: AS_IS,
    user_id: AS_IS,
    transaction_id: AS_IS,
    path: AS_IS,
    mime: AS_IS,
    size_bytes: AS_IS,
    created_at: AS_IS,
  },
  pay_transaction_events: {
    id: AS_IS,
    user_id: AS_IS,
    transaction_id: AS_IS,
    at: AS_IS,
    kind: AS_IS,
    summary: AS_IS,
    data: AS_IS,
  },
  pay_settlements: {
    id: AS_IS,
    user_id: AS_IS,
    beneficiary_id: AS_IS,
    paid_on: AS_IS,
    currency: AS_IS,
    amount: TEXT,
    method: AS_IS,
    receipt_path: AS_IS,
    receipt_mime: AS_IS,
    receipt_size: AS_IS,
    note: AS_IS,
    created_at: AS_IS,
    updated_at: AS_IS,
  },
  pay_holidays: {
    id: AS_IS,
    user_id: AS_IS,
    day: AS_IS,
    name: AS_IS,
    created_at: AS_IS,
  },
} as const satisfies { [Table in TableName]: Record<keyof RowOf<Table>, ColumnRead> };

/** La lista de columnas de una tabla para `select()`, con `::text` en las que lo piden. */
function selectList(columns: Record<string, ColumnRead>): string {
  return Object.entries(columns)
    .map(([column, read]) => (read === TEXT ? `${column}::text` : column))
    .join(", ");
}

/** El tope de filas por petición de la API. */
const PAGE_SIZE = 1000;

type Row = Record<string, unknown>;

/**
 * Todas las filas de una tabla, por tramos de 1000 en orden de `id` (único: el orden es estable entre tramos).
 * Cada tramo trae el total (`count: 'exact'`) y se pide hasta tenerlas todas. Si un tramo llega sin ese total, o
 * llega vacío antes de completarlo, se lanza: una copia a medias no se da por buena.
 */
async function readTable(supabase: SupabaseClient<Database>, table: TableName, select: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (;;) {
    const { data, count } = await supabase
      .from(table)
      .select(select, { count: "exact" })
      .order("id")
      .range(rows.length, rows.length + PAGE_SIZE - 1)
      .throwOnError();
    if (count === null) {
      throw new Error(`${table} llegó sin el total de filas (count): no se sabe si están todas.`);
    }
    rows.push(...(data as unknown as Row[]));
    if (rows.length >= count) return rows;
    if (data.length === 0) {
      throw new Error(`${table}: faltan filas (la API dice ${count} y entregó ${rows.length}).`);
    }
  }
}

/** Toda la información del usuario de la sesión de `supabase`, lista para guardarse como JSON. */
export async function exportAll(supabase: SupabaseClient<Database>, nowIso: string): Promise<ExportFile> {
  const tables = Object.keys(EXPORT_COLUMNS) as TableName[];
  const contents = await Promise.all(
    tables.map((table) => readTable(supabase, table, selectList(EXPORT_COLUMNS[table]))),
  );
  return {
    format: "pasarelas-export",
    version: 1,
    exportedAt: nowIso,
    tables: Object.fromEntries(tables.map((table, i) => [table, contents[i]!])),
  };
}
