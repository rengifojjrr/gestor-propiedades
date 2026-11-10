import { Money, Percent, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { cmp } from "@/lib/pasarelas/money";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";
import { ChartFrame } from "./ChartFrame";

export type GatewayCostProps = {
  summary: CurrencySummary;
  currency: Currency;
  /** El nombre de una pasarela por su id. */
  nameOf: (id: string) => string;
};

/**
 * Lo que de verdad costó cada pasarela en el período: sus comisiones (con opciones, plataforma, reembolsos y
 * disputas) sobre su bruto. De la más cara a la más barata; una sin bruto (todo reembolsado) no tiene costo
 * efectivo y va al final.
 */
export function GatewayCost({ summary, currency, nameOf }: GatewayCostProps) {
  const gateways = [...summary.byGateway].sort((a, b) => {
    if (a.effectiveCostPct === null || b.effectiveCostPct === null) {
      return Number(a.effectiveCostPct === null) - Number(b.effectiveCostPct === null);
    }
    return cmp(b.effectiveCostPct, a.effectiveCostPct);
  });
  const costed = gateways.filter((gateway) => gateway.effectiveCostPct !== null);
  const dearest = costed[0];
  const cheapest = costed.at(-1);
  return (
    <ChartFrame
      title="Costo efectivo por pasarela"
      summary={
        dearest === undefined || dearest.effectiveCostPct === null ? (
          "Ninguna pasarela tiene bruto en el período."
        ) : cheapest === undefined || cheapest === dearest || cheapest.effectiveCostPct === null ? (
          <>
            Las comisiones de {nameOf(dearest.gatewayId)} se llevaron el <Percent value={dearest.effectiveCostPct} /> del
            bruto (<Money value={dearest.fees} currency={currency} />).
          </>
        ) : (
          <>
            La más cara es {nameOf(dearest.gatewayId)}: se lleva el <Percent value={dearest.effectiveCostPct} /> del
            bruto (<Money value={dearest.fees} currency={currency} />); la más barata, {nameOf(cheapest.gatewayId)}, el{" "}
            <Percent value={cheapest.effectiveCostPct} />.
          </>
        )
      }
      chart={{
        layout: "bars",
        rows: gateways.map((gateway) => ({
          label: nameOf(gateway.gatewayId),
          values: [gateway.effectiveCostPct ?? "0"],
        })),
        series: [{ name: "Costo efectivo", color: "brand" }],
        format: { kind: "pct" },
      }}
      table={
        <Table label="Costo efectivo por pasarela">
          <THead>
            <Tr>
              <Th>Pasarela</Th>
              <Th numeric>Bruto</Th>
              <Th numeric>Comisiones</Th>
              <Th numeric>Costo efectivo</Th>
            </Tr>
          </THead>
          <TBody>
            {gateways.map((gateway) => (
              <Tr key={gateway.gatewayId}>
                <Th scope="row">{nameOf(gateway.gatewayId)}</Th>
                <Td numeric>
                  <Money value={gateway.gross} currency={currency} />
                </Td>
                <Td numeric>
                  <Money value={gateway.fees} currency={currency} />
                </Td>
                <Td numeric>
                  {gateway.effectiveCostPct === null ? "—" : <Percent value={gateway.effectiveCostPct} />}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      }
    />
  );
}
