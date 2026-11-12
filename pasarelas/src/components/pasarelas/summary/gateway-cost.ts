import { cmp, isZero } from "@/lib/pasarelas/money";
import type { CurrencySummary } from "@/lib/pasarelas/stats";
import type { Pct } from "@/lib/pasarelas/types";

type Gateway = CurrencySummary["byGateway"][number];

/**
 * Las pasarelas del período de la más cara a la más barata (sus comisiones del negocio sobre su venta) y, aparte,
 * las que no tienen costo efectivo: sin venta no hay porcentaje, y no debe dibujarse como un 0 % (`whyUncosted` dice
 * por qué). Una cuyas comisiones pagaron todas los compradores sí lo tiene: 0 % (`paidByBuyers`).
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
 * Por qué una pasarela no tiene costo efectivo: no le quedó bruto en el período (todo se reembolsó), o le quedó pero
 * no venta (lo que pagaron los compradores se llevó lo poco que quedó cobrado). De una a la que le quedó bruto nunca
 * se dice que todo se reembolsó.
 */
export function whyUncosted(gateway: Pick<Gateway, "gross">): "sin_bruto" | "sin_venta" {
  return isZero(gateway.gross) ? "sin_bruto" : "sin_venta";
}

/** Todas sus comisiones las pagaron los compradores: al negocio no le costó nada, y su costo efectivo es 0 %. */
export function paidByBuyers(gateway: Pick<Gateway, "fees" | "buyerFees">): boolean {
  return isZero(gateway.fees) && !isZero(gateway.buyerFees);
}
