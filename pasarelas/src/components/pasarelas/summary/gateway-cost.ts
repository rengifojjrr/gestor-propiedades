import { cmp } from "@/lib/pasarelas/money";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Pct } from "@/lib/pasarelas/types";

type Gateway = CurrencySummary["byGateway"][number];

/**
 * Las pasarelas del período de la más cara a la más barata (comisiones sobre su bruto) y, aparte, las que no tienen
 * costo efectivo: sin bruto (todo reembolsado) no hay porcentaje, y no debe dibujarse como un 0 %.
 */
export function gatewaysByCost(byGateway: readonly Gateway[]): {
  costed: (Gateway & { effectiveCostPct: Pct })[];
  uncosted: Gateway[];
} {
  const costed = byGateway
    .flatMap((gateway) => {
      const { effectiveCostPct } = gateway;
      return effectiveCostPct === null ? [] : [{ ...gateway, effectiveCostPct }];
    })
    .sort((a, b) => cmp(b.effectiveCostPct, a.effectiveCostPct));
  return { costed, uncosted: byGateway.filter((gateway) => gateway.effectiveCostPct === null) };
}
