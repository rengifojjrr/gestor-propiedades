import { Percent } from "@/components/ui/Figures";
import { formatAmount } from "@/lib/pasarelas/money";
import type { Money, Pct } from "@/lib/pasarelas/types";

/**
 * Una tarifa: «2,9 % + 0,30». La cuota fija va sin símbolo de moneda: se cobra en la moneda de cada cobro, y una
 * pasarela no tiene moneda propia.
 */
export function FeeText({ pct, fixed }: { pct: Pct; fixed: Money }) {
  return (
    <span className="whitespace-nowrap">
      <Percent value={pct} /> + <span className="cifra">{formatAmount(fixed)}</span>
    </span>
  );
}
