import { cmp, isZero } from "@/lib/pasarelas/money";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Pct } from "@/lib/pasarelas/types";

type Gateway = CurrencySummary["byGateway"][number];

/**
 * Las pasarelas del período de la más cara a la más barata (las comisiones del negocio sobre el bruto en que las
 * pagó) y, aparte, las que no tienen costo efectivo: sin ese bruto no hay porcentaje, y no debe dibujarse como un
 * 0 % (`whyUncosted` dice por qué).
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

/**
 * Por qué una pasarela no tiene costo efectivo: no le quedó bruto en el período (todo se reembolsó), o todas sus
 * comisiones las pagaron los compradores y al negocio no le costó nada.
 */
export function whyUncosted(gateway: Pick<Gateway, "fees" | "buyerFees">): "sin_bruto" | "compradores" {
  return isZero(gateway.fees) && !isZero(gateway.buyerFees) ? "compradores" : "sin_bruto";
}
