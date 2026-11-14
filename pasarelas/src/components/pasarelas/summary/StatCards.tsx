import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Money, Stat } from "@/components/ui";
import { isZero } from "@/lib/pasarelas/money";
import { cobros } from "@/components/pasarelas/tx/plural";
import { BuyerFeesNote, feesHint } from "./fees";
import type { Totals } from "@/lib/pasarelas/stats";
import type { Currency } from "@/lib/pasarelas/types";

export type StatCardsProps = {
  totals: Totals;
  currency: Currency;
  /** La lista de cobros con exactamente los que suma «Por caer». */
  pendingHref: string;
};

/** Una cifra en su tarjeta. La tarjeta es un grupo con el nombre de la cifra. */
function StatCard({ label, value, hint, total }: { label: string; value: ReactNode; hint?: ReactNode; total?: boolean }) {
  return (
    <Card role="group" aria-label={label} className="min-w-0 p-4">
      <Stat label={label} value={value} hint={hint} total={total} />
    </Card>
  );
}

/**
 * Las cifras del período en una moneda: bruto (todo lo cobrado), comisiones (las del negocio, y su parte del
 * bruto), neto, cobros, ticket promedio, lo que está por caer (con el enlace a esos cobros) y lo ya depositado. «Por
 * caer» y «Depositado» son lo que llega al banco: el neto menos lo que retienen las pasarelas. Si alguna retuvo
 * algo en el período, una tarjeta más lo dice. Debajo, si hubo, las comisiones que pagaron los compradores: no son
 * un costo del negocio.
 */
export function StatCards({ totals, currency, pendingHref }: StatCardsProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Bruto" value={<Money value={totals.gross} currency={currency} />} />
        <StatCard
          label="Comisiones"
          value={<Money value={totals.fees} currency={currency} />}
          hint={feesHint(totals)}
        />
        <StatCard label="Neto" value={<Money value={totals.net} currency={currency} />} total />
        <StatCard label="Cobros" value={totals.count} />
        <StatCard label="Ticket promedio" value={<Money value={totals.avgTicket} currency={currency} />} />
        <StatCard
          label="Por caer"
          value={<Money value={totals.pendingPayout} currency={currency} />}
          hint={
            totals.pendingCount === 0 ? (
              "Nada pendiente"
            ) : (
              <Link href={pendingHref} className="inline-flex min-h-11 items-center font-semibold text-brand hover:underline">
                Ver {cobros(totals.pendingCount)}
              </Link>
            )
          }
        />
        <StatCard
          label="Depositado"
          value={<Money value={totals.depositedPayout} currency={currency} />}
          hint={cobros(totals.depositedCount)}
        />
        {isZero(totals.retention) ? null : (
          <StatCard
            label="Retenido"
            value={<Money value={totals.retention} currency={currency} />}
            hint="Lo retienen las pasarelas: le cae a ciertas personas, no al banco"
          />
        )}
      </div>
      <BuyerFeesNote amount={totals.buyerFees} currency={currency} />
    </div>
  );
}
