import { Money, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { cmp } from "@/lib/pasarelas/money";
import type { Totals } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";
import type { MonthRow } from "@/server/pasarelas/queries/summary";
import { ChartFrame } from "./ChartFrame";

export type MonthChartProps = { months: MonthRow[]; totals: Totals; currency: Currency };

/** Bruto y neto de cada mes del período (los meses sin cobros, en cero), con su tabla. */
export function MonthChart({ months, totals, currency }: MonthChartProps) {
  const best = months.reduce((top, month) => (cmp(month.gross, top.gross) > 0 ? month : top));
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
