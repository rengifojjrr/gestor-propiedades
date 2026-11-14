import "server-only";
import { businessFigures, dec, toMoney } from "@/lib/pasarelas";
import type { Currency, GatewayCfg, Money } from "@/lib/pasarelas";
import {
  EXTRA_COLUMNS,
  FEE_VERSION_COLUMNS,
  GATEWAY_COLUMNS,
  RETENTION_RECIPIENT_COLUMNS,
  toGatewayCfg,
  type Db,
  type GatewayRow,
} from "../dto";

/**
 * Las lecturas de la pantalla Pasarelas que no cubre la configuración (`getPayConfig`): la ficha de una pasarela
 * con su nota, y los totales de toda la historia de la vista `pay_gateway_totals` (que no cuenta la papelera ni los
 * fallidos). El dinero y los días se piden con `::text`.
 *
 * En la vista, `gross` es todo lo cobrado, `fees` todas las comisiones y `net` el neto, como siempre; `buyer_fees`,
 * lo que pagaron los compradores. Lo facturado y las comisiones del negocio se derivan aquí (`businessFigures`).
 */

const GATEWAY_DETAIL_COLUMNS = `${GATEWAY_COLUMNS}, notes` as const;
const GATEWAY_TOTALS_COLUMNS =
  "gateway_id, currency, tx_count, gross::text, fees::text, net::text, deposited_count, avg_days::text, median_days::text, buyer_fees::text";

type GatewayDetailRow = GatewayRow & { notes: string | null };
type GatewayTotalsRow = {
  gateway_id: string;
  currency: string;
  tx_count: number | null;
  gross: string | null;
  fees: string | null;
  net: string | null;
  deposited_count: number | null;
  avg_days: string | null;
  median_days: string | null;
  buyer_fees: string | null;
};

/**
 * La pasarela con su nota, sus tarifas (de la más antigua a la más nueva), sus opciones (en su orden) y su retención
 * con sus personas (en su orden).
 */
export type GatewayDetail = GatewayCfg & { notes: string | null };

/** Lo de una pasarela en una moneda, de toda la historia. Los días, con 2 decimales («3.67»); sin depósitos, `null`. */
export type GatewayTotals = {
  gatewayId: string;
  currency: Currency;
  txCount: number;
  /** Todo lo cobrado por la pasarela: lo facturado más lo que pagaron los compradores (cuadra con la pasarela). */
  gross: Money;
  /** Lo facturado: la venta del negocio, todo lo cobrado menos lo que pagaron los compradores. */
  sale: Money;
  /** Las comisiones del negocio: todas menos las que pagaron los compradores. */
  fees: Money;
  /** Las comisiones que pagaron los compradores. */
  buyerFees: Money;
  net: Money;
  depositedCount: number;
  avgDays: string | null;
  medianDays: string | null;
};

const money = (value: string | null): Money => toMoney(dec(value ?? "0"));

/** La pasarela con ese id, o `null` si no existe (o es de otro usuario). */
export async function getGateway(supabase: Db, id: string): Promise<GatewayDetail | null> {
  const [gateway, feeVersions, extras, recipients] = await Promise.all([
    supabase.from("pay_gateways").select(GATEWAY_DETAIL_COLUMNS).eq("id", id).maybeSingle().throwOnError(),
    supabase
      .from("pay_gateway_fee_versions")
      .select(FEE_VERSION_COLUMNS)
      .eq("gateway_id", id)
      .order("effective_from")
      .order("id")
      .throwOnError(),
    supabase
      .from("pay_gateway_extras")
      .select(EXTRA_COLUMNS)
      .eq("gateway_id", id)
      .order("sort")
      .order("name")
      .order("id")
      .throwOnError(),
    supabase
      .from("pay_gateway_retention_recipients")
      .select(RETENTION_RECIPIENT_COLUMNS)
      .eq("gateway_id", id)
      .order("sort")
      .order("id")
      .throwOnError(),
  ]);
  const row = gateway.data as GatewayDetailRow | null;
  if (row === null) return null;
  return { ...toGatewayCfg(row, feeVersions.data, extras.data, recipients.data), notes: row.notes };
}

/** Los totales de cada pasarela en cada moneda: una fila por pasarela y moneda que tenga cobros. */
export async function listGatewayTotals(supabase: Db): Promise<GatewayTotals[]> {
  const { data } = await supabase
    .from("pay_gateway_totals")
    .select(GATEWAY_TOTALS_COLUMNS)
    .order("gateway_id")
    .order("currency")
    .throwOnError();
  return (data as GatewayTotalsRow[]).map((row) => {
    const gross = money(row.gross);
    return {
      gatewayId: row.gateway_id,
      currency: row.currency,
      txCount: row.tx_count ?? 0,
      gross,
      ...businessFigures({ gross, fees: money(row.fees), buyerFees: money(row.buyer_fees) }),
      net: money(row.net),
      depositedCount: row.deposited_count ?? 0,
      avgDays: row.avg_days,
      medianDays: row.median_days,
    };
  });
}
