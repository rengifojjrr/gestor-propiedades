import { Money, Percent, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { formatDays } from "@/components/pasarelas/accounts/days";
import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp } from "@/lib/pasarelas/money";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";
import { ChartFrame } from "./ChartFrame";

export type AccountsChartProps = {
  summary: CurrencySummary;
  currency: Currency;
  /** El nombre de una cuenta destino por su id (`null`: los cobros sin cuenta). */
  nameOf: (id: string | null) => string;
};

/**
 * A qué cuenta destino va el neto del período, de mayor a menor, con su parte y cuánto tardan en caer sus cobros
 * ya depositados (días de calendario entre el cobro y el depósito real). Si alguna cuenta tiene pérdidas, ninguna
 * tiene parte, y el resumen dice por qué.
 */
export function AccountsChart({ summary, currency, nameOf }: AccountsChartProps) {
  const { byAccount } = summary;
  const [top] = byAccount;
  // Con pérdidas en alguna cuenta, el motor no da la parte de ninguna (pasaría del 100 % o saldría negativa).
  const losses = byAccount.filter((account) => cmp(account.net, ZERO) < 0);
  return (
    <ChartFrame
      title="Cuentas destino"
      summary={
        top === undefined ? null : (
          <>
            {byAccount.length === 1 ? "Todo el neto va a" : "La mayor parte del neto va a"} {nameOf(top.bankAccountId)}:{" "}
            <Money value={top.net} currency={currency} />
            {byAccount.length > 1 && top.sharePct !== null ? (
              <>
                {" "}
                (el <Percent value={top.sharePct} />)
              </>
            ) : null}
            {top.avgDays === null
              ? ". Todavía no hay depósitos para saber cuánto tarda."
              : `; tarda en promedio ${formatDays(top.avgDays)} en caer.`}
            {losses.length === 0
              ? null
              : ` ${losses.map((account) => nameOf(account.bankAccountId)).join(", ")} ${
                  losses.length === 1 ? "tiene" : "tienen"
                } pérdidas en el período (neto negativo): por eso no se calcula qué parte del neto va a cada cuenta.`}
          </>
        )
      }
      chart={{
        layout: "bars",
        rows: byAccount.map((account) => ({ label: nameOf(account.bankAccountId), values: [account.net] })),
        series: [{ name: "Neto", color: "brand" }],
        format: { kind: "money", currency },
      }}
      table={
        <Table label="Cuentas destino">
          <THead>
            <Tr>
              <Th>Cuenta</Th>
              <Th numeric>Neto</Th>
              <Th numeric>Parte del neto</Th>
              <Th numeric>Días promedio</Th>
              <Th numeric>Mediana</Th>
              <Th numeric>Cobros</Th>
            </Tr>
          </THead>
          <TBody>
            {byAccount.map((account) => (
              <Tr key={account.bankAccountId ?? "sin-cuenta"}>
                <Th scope="row">{nameOf(account.bankAccountId)}</Th>
                <Td numeric>
                  <Money value={account.net} currency={currency} />
                </Td>
                <Td numeric>{account.sharePct === null ? "—" : <Percent value={account.sharePct} />}</Td>
                <Td numeric>{account.avgDays === null ? "Sin depósitos" : formatDays(account.avgDays)}</Td>
                <Td numeric>{account.medianDays === null ? "—" : formatDays(account.medianDays)}</Td>
                <Td numeric>{account.count}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      }
    />
  );
}
