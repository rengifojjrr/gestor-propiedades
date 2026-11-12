import type { ReactNode } from "react";
import { Money, Percent } from "@/components/ui";
import { isZero } from "@/lib/pasarelas/money";
import type { Totals } from "@/lib/pasarelas/stats";
import type { Currency, Money as MoneyText } from "@/lib/pasarelas/types";

/**
 * La aclaración de «Comisiones» (las del negocio): su % del bruto. Si hubo cobros cuya comisión pagó el comprador,
 * el % es del bruto de los cobros en que las pagamos nosotros, y así lo dice. Sin ese bruto no hay %: solo se dice
 * que todas las pagaron los compradores si el negocio no pagó nada (un cobro propio reembolsado del todo deja bruto
 * 0 y la comisión que retuvo la pasarela, igual que `whyUncosted`). `null` si no hay nada que aclarar.
 */
export function feesHint(totals: Pick<Totals, "feePct" | "fees" | "buyerFees">): ReactNode {
  const byBuyers = !isZero(totals.buyerFees);
  if (totals.feePct === null) return byBuyers && isZero(totals.fees) ? "Todas las pagaron los compradores" : null;
  return (
    <>
      <Percent value={totals.feePct} /> {byBuyers ? "del bruto en que las pagamos" : "del bruto"}
    </>
  );
}

/** «Además, los compradores pagaron $X en comisiones.», si pagaron algo; si no, nada. */
export function BuyerFeesNote({ amount, currency }: { amount: MoneyText; currency: Currency }) {
  if (isZero(amount)) return null;
  return (
    <p className="text-ink-soft">
      Además, los compradores pagaron <Money value={amount} currency={currency} className="text-ink" /> en comisiones.
    </p>
  );
}
