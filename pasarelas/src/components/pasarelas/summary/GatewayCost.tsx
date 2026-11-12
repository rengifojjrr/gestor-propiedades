import { Money, Percent, TBody, THead, Table, Td, Th, Tr } from "@/components/ui";
import { isZero } from "@/lib/pasarelas/money";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";
import { ChartFrame } from "./ChartFrame";
import { gatewaysByCost, paidByBuyers, whyUncosted } from "./gateway-cost";

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
 * Lo que de verdad le costó al negocio cada pasarela en el período: sus comisiones del negocio (con opciones,
 * plataforma, reembolsos y disputas) sobre su venta. Sin compradores, la venta es el bruto y todo se dice como
 * siempre; con ellos, «de lo facturado». De la más cara a la más barata: una cuyas comisiones pagaron todas los
 * compradores cuesta 0 %, y se dice por qué. Una sin venta no tiene costo efectivo y no se dibuja (no es un 0 %): va
 * al final de la tabla con su motivo —sin bruto (todo reembolsado) o sin venta— y el resumen lo dice.
 */
export function GatewayCost({ summary, currency, nameOf }: GatewayCostProps) {
  const { costed, uncosted } = gatewaysByCost(summary.byGateway);
  const dearest = costed[0];
  const cheapest = costed.at(-1);
  const byBuyers = !isZero(summary.totals.buyerFees);
  const base = byBuyers ? "de lo facturado" : "del bruto";
  const uncostedNames = (reason: ReturnType<typeof whyUncosted>) =>
    uncosted.filter((gateway) => whyUncosted(gateway) === reason).map((gateway) => nameOf(gateway.gatewayId));
  const [noGross, noSale] = [uncostedNames("sin_bruto"), uncostedNames("sin_venta")];
  const freeNames = costed.filter(paidByBuyers).map((gateway) => nameOf(gateway.gatewayId));
  const notDrawn = (count: number) => `sin costo efectivo, no se ${count === 1 ? "dibuja" : "dibujan"}.`;
  const withoutGross =
    noGross.length === 0
      ? ""
      : ` ${namesList(noGross)} no ${noGross.length === 1 ? "tiene" : "tienen"} bruto en el período (todo se reembolsó): ${notDrawn(noGross.length)}`;
  const withoutSale =
    noSale.length === 0
      ? ""
      : ` ${namesList(noSale)} no ${noSale.length === 1 ? "tiene" : "tienen"} venta en el período: ${notDrawn(noSale.length)}`;
  const paidByBuyersText =
    freeNames.length === 0
      ? ""
      : ` Las comisiones de ${namesList(freeNames)} las pagaron los compradores: al negocio no le ${freeNames.length === 1 ? "costó" : "costaron"} nada.`;
  const onlyOurs = byBuyers ? " Solo cuentan las comisiones que pagó el negocio." : "";
  return (
    <ChartFrame
      title="Costo efectivo por pasarela"
      summary={
        dearest === undefined ? (
          noSale.length === 0 ? (
            "Ninguna pasarela tiene bruto en el período: no hay costo efectivo que comparar."
          ) : (
            `Ninguna pasarela tiene un costo efectivo que comparar.${withoutGross}${withoutSale}`
          )
        ) : cheapest === undefined || cheapest === dearest ? (
          <>
            Las comisiones de {nameOf(dearest.gatewayId)} se llevaron el <Percent value={dearest.effectiveCostPct} />{" "}
            {base} (<Money value={dearest.fees} currency={currency} />).{withoutGross}
            {withoutSale}
            {paidByBuyersText}
            {onlyOurs}
          </>
        ) : (
          <>
            La más cara es {nameOf(dearest.gatewayId)}: se lleva el <Percent value={dearest.effectiveCostPct} /> {base}{" "}
            (<Money value={dearest.fees} currency={currency} />); la más barata, {nameOf(cheapest.gatewayId)}, el{" "}
            <Percent value={cheapest.effectiveCostPct} />.{withoutGross}
            {withoutSale}
            {paidByBuyersText}
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
              {/* El costo es de las comisiones sobre lo facturado: sin compradores, el bruto. */}
              <Th numeric>{byBuyers ? "Facturado" : "Bruto"}</Th>
              <Th numeric>Comisiones</Th>
              <Th numeric>Costo efectivo</Th>
            </Tr>
          </THead>
          <TBody>
            {[...costed, ...uncosted].map((gateway) => (
              <Tr key={gateway.gatewayId}>
                <Th scope="row">{nameOf(gateway.gatewayId)}</Th>
                <Td numeric>
                  <Money value={gateway.sale} currency={currency} />
                </Td>
                <Td numeric>
                  <Money value={gateway.fees} currency={currency} />
                </Td>
                <Td numeric>
                  {gateway.effectiveCostPct === null ? (
                    whyUncosted(gateway) === "sin_bruto" ? (
                      "Sin bruto"
                    ) : (
                      "Sin venta"
                    )
                  ) : (
                    <>
                      <Percent value={gateway.effectiveCostPct} />
                      {paidByBuyers(gateway) ? (
                        <span className="block text-sm text-ink-soft">las pagaron los compradores</span>
                      ) : null}
                    </>
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
