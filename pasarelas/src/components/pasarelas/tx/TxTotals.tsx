import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { Money, Stat } from "@/components/ui";
import type { Currency, totalsOf } from "@/lib/pasarelas";

export type TxTotalsProps = {
  /** `totalsOf` del motor sobre TODOS los cobros del filtro (no solo la página). */
  totals: ReturnType<typeof totalsOf>;
};

const byCode = ([a]: [Currency, unknown], [b]: [Currency, unknown]): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Los totales del filtro, una caja por moneda (nunca se suman monedas distintas): cuántos cobros, bruto,
 * comisiones y neto. Los fallidos no cuentan. Van plegados, con una línea de resumen por moneda (cuántos y el
 * neto): en el celular, la lista aparece enseguida. Si no hay nada que sumar, no pinta nada.
 */
export function TxTotals({ totals }: TxTotalsProps) {
  const titleId = useId();
  const currencies = Object.entries(totals).sort(byCode);
  if (currencies.length === 0) return null;
  return (
    <section aria-labelledby={titleId}>
      <details className="group rounded-card border border-rule bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 rounded-card px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-col gap-1">
            <span id={titleId} className="font-semibold">
              Totales del filtro
            </span>
            <span className="flex flex-wrap gap-x-3 text-sm text-ink-soft">
              {currencies.map(([currency, sums]) => (
                <span key={currency}>
                  {currency}: {sums.count} {sums.count === 1 ? "cobro" : "cobros"} · neto{" "}
                  <Money value={sums.net} currency={currency} />
                </span>
              ))}
            </span>
          </span>
          <ChevronDown aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-soft transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-5 border-t border-rule p-4">
          <p className="text-sm text-ink-soft">Todos los cobros del filtro, sin los fallidos.</p>
          {currencies.map(([currency, sums]) => (
            <section key={currency} aria-label={`Totales en ${currency}`} className="flex flex-col gap-3">
              <h3 className="font-semibold">
                {currency} · {sums.count} {sums.count === 1 ? "cobro" : "cobros"}
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Stat label="Bruto" value={<Money value={sums.gross} currency={currency} />} />
                <Stat label="Comisiones" value={<Money value={sums.fees} currency={currency} />} />
                <Stat label="Neto" value={<Money value={sums.net} currency={currency} />} total />
              </div>
            </section>
          ))}
        </div>
      </details>
    </section>
  );
}
