import {
  CSV_ES,
  CSV_STD,
  STATUS_LABEL,
  daysBetween,
  displayStatus,
  pctOf,
  toCsv,
  type CsvFormat,
  type PayConfig,
} from "@/lib/pasarelas";
import type { TxListItem } from "@/server/pasarelas/dto";

/**
 * El CSV de la lista de cobros: una fila por cobro, con los nombres resueltos contra la configuración. Sin datos
 * de compradores (la base no los guarda). Las cuentas, el estado, el porcentaje y los días salen del motor.
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
] as const;

/** Las columnas de dinero: `toCsv` les pone el separador decimal del formato. */
const MONEY_COLUMNS = [6, 7, 8, 9, 11];

/** El formato que pide la URL (`formato=estandar`); cualquier otro valor, o ninguno, es el español. */
export function csvFormatOf(value: string | null): CsvFormat {
  return value === "estandar" ? CSV_STD : CSV_ES;
}

/** Un porcentaje como texto, con el separador decimal del formato (`toCsv` solo toca el dinero). */
const pctCell = (pct: string | null, fmt: CsvFormat): string | null =>
  pct === null ? null : pct.replace(".", fmt.decimal);

/** El nombre de cada id de una lista de la configuración. */
const namesOf = (items: readonly { id: string; name: string }[]): Map<string, string> =>
  new Map(items.map((item) => [item.id, item.name]));

/** Los cobros como CSV, en el orden en que llegan. */
export function txCsv(rows: readonly TxListItem[], cfg: PayConfig, fmt: CsvFormat): string {
  const companies = namesOf(cfg.companies);
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
    ];
  });
  return toCsv(TX_CSV_HEADER, body, fmt, MONEY_COLUMNS);
}
