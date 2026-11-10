import { useId } from "react";
import { Card, CardBody, CardHeader, CardTitle, Money, Stat } from "@/components/ui";
import type { Currency, totalsOf } from "@/lib/pasarelas";

export type TxTotalsProps = {
  /** `totalsOf` del motor sobre TODOS los cobros del filtro (no solo la página). */
  totals: ReturnType<typeof totalsOf>;
};

const byCode = ([a]: [Currency, unknown], [b]: [Currency, unknown]): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Los totales del filtro, una caja por moneda (nunca se suman monedas distintas): cuántos cobros, bruto,
 * comisiones y neto. Los fallidos no cuentan. Si no hay nada que sumar, no pinta nada.
 */
export function TxTotals({ totals }: TxTotalsProps) {
  const titleId = useId();
  const currencies = Object.entries(totals).sort(byCode);
  if (currencies.length === 0) return null;
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>Totales del filtro</CardTitle>
        <p className="text-sm text-ink-soft">Todos los cobros del filtro, sin los fallidos.</p>
      </CardHeader>
      <CardBody className="flex flex-col gap-5">
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
      </CardBody>
    </Card>
  );
}
