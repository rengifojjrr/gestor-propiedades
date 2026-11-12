import type { ReactNode } from "react";
import { Money, Percent } from "@/components/ui";
import { isZero } from "@/lib/pasarelas/money";
import type { Totals } from "@/lib/pasarelas/stats";
import type { Currency, Money as MoneyText } from "@/lib/pasarelas/types";

/**
 * La aclaración de «Comisiones» (las del negocio): su % de lo facturado, lo que de verdad le costó cobrar. Si nadie
 * pagó comisiones por el comprador, lo facturado es el bruto y se dice como siempre, «del bruto»; si alguien pagó,
 * «de lo facturado», y si las pagaron todas los compradores, ese 0 % lleva su razón. Sin venta (todo reembolsado) no
 * hay %, y se dice; sin nada cobrado ni comisiones, `null`: nada que aclarar.
 */
export function feesHint(totals: Pick<Totals, "feePct" | "gross" | "fees" | "buyerFees">): ReactNode {
  if (totals.feePct === null) {
    // Con un espacio duro, el «%» no queda solo en la última línea de la tarjeta.
    return isZero(totals.gross) && isZero(totals.fees) ? null : "Sin venta en el período: no hay %";
  }
  if (isZero(totals.buyerFees)) {
    return (
      <>
        <Percent value={totals.feePct} /> del bruto
      </>
    );
  }
  return (
    <>
      <Percent value={totals.feePct} /> de lo facturado
      {isZero(totals.fees) ? ": todas las pagaron los compradores" : null}
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
