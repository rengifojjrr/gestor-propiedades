import { Money, Percent, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { isZero } from "@/lib/pasarelas/money";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";
import { ChartFrame } from "./ChartFrame";
import { gatewaysByCost, whyUncosted } from "./gateway-cost";

export type GatewayCostProps = {
  summary: CurrencySummary;
  currency: Currency;
  /** El nombre de una pasarela por su id. */
  nameOf: (id: string) => string;
};

/** Los nombres de una lista: «Stripe», «Stripe y PayPal», «Stripe, PayPal y Zelle». */
function namesList(names: readonly string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
}

/**
 * Lo que de verdad le costó al negocio cada pasarela en el período: sus comisiones (con opciones, plataforma,
 * reembolsos y disputas) sobre el bruto de los cobros en que las pagó; las que pagaron los compradores no cuentan.
 * De la más cara a la más barata. Una sin costo efectivo no se dibuja (no es un 0 %): va al final de la tabla con su
 * motivo —sin bruto (todo reembolsado), o porque sus comisiones las pagaron los compradores— y el resumen lo dice.
 */
export function GatewayCost({ summary, currency, nameOf }: GatewayCostProps) {
  const { costed, uncosted } = gatewaysByCost(summary.byGateway);
  const dearest = costed[0];
  const cheapest = costed.at(-1);
  const names = (reason: ReturnType<typeof whyUncosted>) =>
    uncosted.filter((gateway) => whyUncosted(gateway) === reason).map((gateway) => nameOf(gateway.gatewayId));
  const [noGross, byBuyers] = [names("sin_bruto"), names("compradores")];
  const withoutGross =
    noGross.length === 0
      ? ""
      : ` ${namesList(noGross)} no ${noGross.length === 1 ? "tiene" : "tienen"} bruto en el período (todo se reembolsó): sin costo efectivo, no se ${noGross.length === 1 ? "dibuja" : "dibujan"}.`;
  const paidByBuyers =
    byBuyers.length === 0
      ? ""
      : ` Las comisiones de ${namesList(byBuyers)} las pagaron los compradores: al negocio no le ${byBuyers.length === 1 ? "costó" : "costaron"} nada.`;
  const onlyOurs = isZero(summary.totals.buyerFees)
    ? ""
    : " Solo cuentan los cobros en que pagamos nosotros la comisión.";
  return (
    <ChartFrame
      title="Costo efectivo por pasarela"
      summary={
        dearest === undefined ? (
          byBuyers.length === 0 ? (
            "Ninguna pasarela tiene bruto en el período: no hay costo efectivo que comparar."
          ) : (
            `Ninguna pasarela tiene un costo efectivo que comparar.${withoutGross}${paidByBuyers}`
          )
        ) : cheapest === undefined || cheapest === dearest ? (
          <>
            Las comisiones de {nameOf(dearest.gatewayId)} se llevaron el <Percent value={dearest.effectiveCostPct} /> del
            bruto (<Money value={dearest.fees} currency={currency} />).{withoutGross}
            {paidByBuyers}
            {onlyOurs}
          </>
        ) : (
          <>
            La más cara es {nameOf(dearest.gatewayId)}: se lleva el <Percent value={dearest.effectiveCostPct} /> del
            bruto (<Money value={dearest.fees} currency={currency} />); la más barata, {nameOf(cheapest.gatewayId)}, el{" "}
            <Percent value={cheapest.effectiveCostPct} />.{withoutGross}
            {paidByBuyers}
            {onlyOurs}
          </>
        )
      }
      chart={{
        layout: "bars",
        rows: costed.map((gateway) => ({ label: nameOf(gateway.gatewayId), values: [gateway.effectiveCostPct] })),
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
            {[...costed, ...uncosted].map((gateway) => (
              <Tr key={gateway.gatewayId}>
                <Th scope="row">{nameOf(gateway.gatewayId)}</Th>
                <Td numeric>
                  <Money value={gateway.gross} currency={currency} />
                </Td>
                <Td numeric>
                  <Money value={gateway.fees} currency={currency} />
                </Td>
                <Td numeric>
                  {gateway.effectiveCostPct !== null ? (
                    <Percent value={gateway.effectiveCostPct} />
                  ) : whyUncosted(gateway) === "compradores" ? (
                    "Las pagaron los compradores"
                  ) : (
                    "Sin bruto"
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      }
    />
  );
}
