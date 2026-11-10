import type { GatewayTotals } from "@/server/pasarelas/queries/gateways";
import { formatDays } from "./days";

function daysText(days: string): string {
  const text = formatDays(days);
  return `${text} ${text === "1" ? "día" : "días"}`;
}

/**
 * El tiempo real de depósito de una pasarela: promedio y mediana de días de calendario entre el cobro y el depósito,
 * por moneda (la moneda solo se dice si hay más de una). Sin depósitos, lo dice.
 */
export function LagText({ totals }: { totals: GatewayTotals[] }) {
  const lags = totals.flatMap(({ currency, avgDays, medianDays }) =>
    avgDays === null || medianDays === null ? [] : [{ currency, avgDays, medianDays }],
  );
  if (lags.length === 0) return <span className="text-ink-soft">Sin depósitos todavía</span>;
  return (
    <span className="flex flex-col">
      {lags.map((lag) => (
        <span key={lag.currency}>
          {lags.length > 1 ? `${lag.currency}: ` : null}
          Promedio {daysText(lag.avgDays)} · mediana {daysText(lag.medianDays)}
        </span>
      ))}
    </span>
  );
}
