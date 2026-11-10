import { Money, Percent, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { pctOf } from "@/lib/pasarelas/money";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";
import { ChartFrame } from "./ChartFrame";

export type CompanyRankingProps = {
  summary: CurrencySummary;
  currency: Currency;
  /** El nombre de una empresa por su id. */
  nameOf: (id: string) => string;
};

/** Las empresas de mayor a menor bruto en el período, con lo que se llevaron las comisiones y lo que quedó. */
export function CompanyRanking({ summary, currency, nameOf }: CompanyRankingProps) {
  const { byCompany, totals } = summary;
  const [top] = byCompany;
  const topShare = top === undefined ? null : pctOf(top.gross, totals.gross);
  return (
    <ChartFrame
      title="Empresas por bruto"
      summary={
        top === undefined ? null : byCompany.length === 1 ? (
          <>
            Solo {nameOf(top.companyId)} cobró en el período: <Money value={top.gross} currency={currency} />.
          </>
        ) : (
          <>
            {nameOf(top.companyId)} es la que más facturó: <Money value={top.gross} currency={currency} />
            {topShare === null ? null : (
              <>
                , el <Percent value={topShare} /> del bruto
              </>
            )}
            .
          </>
        )
      }
      chart={{
        layout: "bars",
        rows: byCompany.map((company) => ({ label: nameOf(company.companyId), values: [company.gross] })),
        series: [{ name: "Bruto", color: "brand" }],
        format: { kind: "money", currency },
      }}
      table={
        <Table label="Empresas por bruto">
          <THead>
            <Tr>
              <Th>Empresa</Th>
              <Th numeric>Bruto</Th>
              <Th numeric>Comisiones</Th>
              <Th numeric>Neto</Th>
              <Th numeric>Cobros</Th>
            </Tr>
          </THead>
          <TBody>
            {byCompany.map((company) => (
              <Tr key={company.companyId}>
                <Th scope="row">{nameOf(company.companyId)}</Th>
                <Td numeric>
                  <Money value={company.gross} currency={currency} />
                </Td>
                <Td numeric>
                  <Money value={company.fees} currency={currency} />
                </Td>
                <Td numeric>
                  <Money value={company.net} currency={currency} />
                </Td>
                <Td numeric>{company.count}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      }
    />
  );
}
