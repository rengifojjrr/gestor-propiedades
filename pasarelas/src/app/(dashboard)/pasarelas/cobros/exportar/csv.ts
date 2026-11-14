import {
  CSV_ES,
  CSV_STD,
  STATUS_LABEL,
  daysBetween,
  depositWindowOf,
  displayStatus,
  isZero,
  pctOf,
  toCsv,
  type CsvFormat,
  type Money,
  type PayConfig,
} from "@/lib/pasarelas";
import { FEES_PAID_BY_LABEL } from "@/components/pasarelas/tx/payer";
import type { TxListItem } from "@/server/pasarelas/dto";

/**
 * El CSV de la lista de cobros: una fila por cobro, con los nombres resueltos contra la configuración. Sin datos
 * de compradores (la base no los guarda). Las cuentas, el estado, el porcentaje y los días salen del motor.
 *
 * «Fecha estimada» es la más tardía de la ventana de depósito (la de siempre) y «Fecha estimada (desde)», la más
 * temprana (la misma, si es un solo día). «Comisión pagada por» dice si la comisión la pagó el negocio o el
 * comprador, y «Comisiones pagadas por los compradores», cuánto de «Comisiones» pagaron ellos (el resto, el negocio:
 * el costo de un reembolso o de una disputa). «Retenido» es lo que retuvo la pasarela (no llega al banco) y «Retenido
 * para», lo que le cae a cada persona («Titular A 25,00 · Titular B 25,00»). Van al final para no mover las columnas
 * de quien ya usa el archivo.
 */

export const TX_CSV_HEADER = [
  "Fecha",
  "Empresa",
  "Canal",
  "Pasarela",
  "Referencia",
  "Moneda",
  "Bruto original",
  "Reembolsado",
  "Bruto",
  "Comisiones",
  "% de comisiones",
  "Neto",
  "Estado",
  "Fecha estimada",
  "Fecha del depósito",
  "Días hasta el depósito",
  "Cuenta destino",
  "Comprobantes",
  "Nota",
  "Fecha estimada (desde)",
  "Comisión pagada por",
  "Comisiones pagadas por los compradores",
  "Retenido",
  "Retenido para",
] as const;

/** Las columnas de dinero: `toCsv` les pone el separador decimal del formato. */
const MONEY_COLUMNS = [6, 7, 8, 9, 11, 21, 22];

/** Lo que le cae a una persona de lo retenido en un cobro (`pay_retention_shares`). */
export type RetentionShareCell = { beneficiaryId: string; amount: Money };

/** El formato que pide la URL (`formato=estandar`); cualquier otro valor, o ninguno, es el español. */
export function csvFormatOf(value: string | null): CsvFormat {
  return value === "estandar" ? CSV_STD : CSV_ES;
}

/** Un porcentaje como texto, con el separador decimal del formato (`toCsv` solo toca el dinero). */
const pctCell = (pct: string | null, fmt: CsvFormat): string | null =>
  pct === null ? null : pct.replace(".", fmt.decimal);

/**
 * «Titular A 25,00 · Titular B 25,00»: cada persona con lo suyo, por nombre; vacío si no le cayó nada a nadie (no
 * retuvo, o un reembolso total dejó lo retenido en 0).
 */
function sharesCell(
  shares: readonly RetentionShareCell[],
  names: ReadonlyMap<string, string>,
  fmt: CsvFormat,
): string | null {
  const received = shares.filter((share) => !isZero(share.amount));
  if (received.length === 0) return null;
  return received
    .map((share) => ({ name: names.get(share.beneficiaryId) ?? "Beneficiario borrado", amount: share.amount }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((share) => `${share.name} ${share.amount.replace(".", fmt.decimal)}`)
    .join(" · ");
}

/** El nombre de cada id de una lista de la configuración. */
const namesOf = (items: readonly { id: string; name: string }[]): Map<string, string> =>
  new Map(items.map((item) => [item.id, item.name]));

/**
 * Los cobros como CSV, en el orden en que llegan. `shares`: lo que le cayó a cada persona de lo retenido en cada
 * cobro, por id (sin él, la celda va vacía).
 */
export function txCsv(
  rows: readonly TxListItem[],
  cfg: PayConfig,
  fmt: CsvFormat,
  shares: ReadonlyMap<string, readonly RetentionShareCell[]> = new Map(),
): string {
  const companies = namesOf(cfg.companies);
  const beneficiaries = namesOf(cfg.beneficiaries);
  const channels = namesOf(cfg.channels);
  const gateways = namesOf(cfg.gateways);
  const accounts = new Map(cfg.bankAccounts.map((account) => [account.id, account.alias]));
  const nameIn = (names: Map<string, string>, id: string | null): string | null =>
    id === null ? null : (names.get(id) ?? null);

  const body = rows.map((tx) => {
    const deposited = tx.status === "depositado" && tx.depositedOn !== null ? tx.depositedOn : null;
    return [
      tx.occurredOn,
      nameIn(companies, tx.companyId),
      nameIn(channels, tx.channelId),
      nameIn(gateways, tx.gatewayId),
      tx.reference,
      tx.currency,
      tx.grossOriginal,
      tx.refunded,
      tx.gross,
      tx.fees,
      pctCell(pctOf(tx.fees, tx.gross), fmt),
      tx.net,
      STATUS_LABEL[displayStatus(tx)],
      tx.estimatedDepositOn,
      deposited,
      deposited === null ? null : String(daysBetween(tx.occurredOn, deposited)),
      nameIn(accounts, tx.bankAccountId),
      String(tx.receiptsCount),
      tx.note,
      depositWindowOf(tx)?.from ?? null,
      FEES_PAID_BY_LABEL[tx.feesPaidBy],
      tx.buyerFees,
      tx.retention,
      sharesCell(shares.get(tx.id) ?? [], beneficiaries, fmt),
    ];
  });
  return toCsv(TX_CSV_HEADER, body, fmt, MONEY_COLUMNS);
}
