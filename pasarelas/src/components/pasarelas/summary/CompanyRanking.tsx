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

/**
 * Las empresas de mayor a menor lo facturado en el período (su venta: si un comprador pagó la comisión, lo que pagó
 * de más no cuenta), con lo que se llevaron sus comisiones y lo que quedó.
 */
export function CompanyRanking({ summary, currency, nameOf }: CompanyRankingProps) {
  const { byCompany, totals } = summary;
  const [top] = byCompany;
  const topShare = top === undefined ? null : pctOf(top.sale, totals.sale);
  return (
    <ChartFrame
      title="Empresas por lo facturado"
      summary={
        top === undefined ? null : byCompany.length === 1 ? (
          <>
            Solo {nameOf(top.companyId)} facturó en el período: <Money value={top.sale} currency={currency} />.
          </>
        ) : (
          <>
            {nameOf(top.companyId)} es la que más facturó: <Money value={top.sale} currency={currency} />
            {topShare === null ? null : (
              <>
                , el <Percent value={topShare} /> de lo facturado
              </>
            )}
            .
          </>
        )
      }
      chart={{
        layout: "bars",
        rows: byCompany.map((company) => ({ label: nameOf(company.companyId), values: [company.sale] })),
        series: [{ name: "Facturado", color: "brand" }],
        format: { kind: "money", currency },
      }}
      table={
        <Table label="Empresas por lo facturado">
          <THead>
            <Tr>
              <Th>Empresa</Th>
              <Th numeric>Facturado</Th>
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
                  <Money value={company.sale} currency={currency} />
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
