import { Money, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { cmp, isZero } from "@/lib/pasarelas/money";
import type { Totals } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";
import type { MonthRow } from "@/server/pasarelas/queries/summary";
import { ChartFrame } from "./ChartFrame";

export type MonthChartProps = { months: MonthRow[]; totals: Totals; currency: Currency };

/**
 * Bruto y neto de cada mes del período (los meses sin cobros, en cero), con su tabla. Las comisiones de la tabla son
 * las del negocio; si en el período hubo comisiones que pagaron los compradores, van en su propia columna, para que
 * se lea Bruto − Comisiones − De los compradores = Neto.
 */
export function MonthChart({ months, totals, currency }: MonthChartProps) {
  const best = months.reduce((top, month) => (cmp(month.gross, top.gross) > 0 ? month : top));
  const byBuyers = !isZero(totals.buyerFees);
  return (
    <ChartFrame
      title="Bruto y neto por mes"
      className="md:col-span-2"
      summary={
        <>
          En el período entraron <Money value={totals.gross} currency={currency} /> de bruto y quedaron{" "}
          <Money value={totals.net} currency={currency} /> de neto.
          {months.length > 1 ? (
            <>
              {" "}
              El mes con más bruto fue {best.label}: <Money value={best.gross} currency={currency} />.
            </>
          ) : null}
        </>
      }
      chart={{
        layout: "columns",
        rows: months.map((month) => ({ label: month.label, values: [month.gross, month.net] })),
        series: [
          { name: "Bruto", color: "brand" },
          { name: "Neto", color: "info" },
        ],
        format: { kind: "money", currency },
      }}
      table={
        <Table label="Bruto y neto por mes">
          <THead>
            <Tr>
              <Th>Mes</Th>
              <Th numeric>Bruto</Th>
              <Th numeric>Comisiones</Th>
              {byBuyers ? <Th numeric>De los compradores</Th> : null}
              <Th numeric>Neto</Th>
              <Th numeric>Cobros</Th>
            </Tr>
          </THead>
          <TBody>
            {months.map((month) => (
              <Tr key={month.month}>
                <Th scope="row">{month.label}</Th>
                <Td numeric>
                  <Money value={month.gross} currency={currency} />
                </Td>
                <Td numeric>
                  <Money value={month.fees} currency={currency} />
                </Td>
                {byBuyers ? (
                  <Td numeric>
                    <Money value={month.buyerFees} currency={currency} />
                  </Td>
                ) : null}
                <Td numeric>
                  <Money value={month.net} currency={currency} />
                </Td>
                <Td numeric>{month.count}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      }
    />
  );
}
