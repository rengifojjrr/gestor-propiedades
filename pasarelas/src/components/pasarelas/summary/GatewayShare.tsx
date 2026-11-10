import { Money, Percent, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";
import { ChartFrame } from "./ChartFrame";

export type GatewayShareProps = {
  summary: CurrencySummary;
  currency: Currency;
  /** El nombre de una pasarela por su id. */
  nameOf: (id: string) => string;
};

/** Qué parte del bruto del período entró por cada pasarela, de mayor a menor. */
export function GatewayShare({ summary, currency, nameOf }: GatewayShareProps) {
  const { byGateway } = summary;
  const [top] = byGateway;
  return (
    <ChartFrame
      title="Reparto del bruto por pasarela"
      summary={
        top === undefined ? null : byGateway.length === 1 ? (
          <>
            Todo el bruto entró por {nameOf(top.gatewayId)}: <Money value={top.gross} currency={currency} />.
          </>
        ) : (
          <>
            Por {nameOf(top.gatewayId)} entró la mayor parte: <Money value={top.gross} currency={currency} />
            {top.sharePct === null ? null : (
              <>
                , el <Percent value={top.sharePct} /> del bruto
              </>
            )}
            .
          </>
        )
      }
      chart={{
        layout: "bars",
        rows: byGateway.map((gateway) => ({ label: nameOf(gateway.gatewayId), values: [gateway.sharePct ?? "0"] })),
        series: [{ name: "Parte del bruto", color: "brand" }],
        format: { kind: "pct" },
      }}
      table={
        <Table label="Reparto del bruto por pasarela">
          <THead>
            <Tr>
              <Th>Pasarela</Th>
              <Th numeric>Bruto</Th>
              <Th numeric>Parte del bruto</Th>
              <Th numeric>Cobros</Th>
            </Tr>
          </THead>
          <TBody>
            {byGateway.map((gateway) => (
              <Tr key={gateway.gatewayId}>
                <Th scope="row">{nameOf(gateway.gatewayId)}</Th>
                <Td numeric>
                  <Money value={gateway.gross} currency={currency} />
                </Td>
                <Td numeric>{gateway.sharePct === null ? "—" : <Percent value={gateway.sharePct} />}</Td>
                <Td numeric>{gateway.count}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      }
    />
  );
}
