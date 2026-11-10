"use client";

import { DateText, Money } from "@/components/ui";
import type { ISODate } from "@/lib/pasarelas/types";
import { StatusBadge } from "./StatusBadge";
import { SelectAllCheckbox } from "./TxBulkBar";
import { DepositDate, TxCheckbox, TxLink, type TxRowView } from "./TxTable";

/** La lista de cobros como tarjetas (en el celular), con una casilla en cada una para elegir. */
export function TxCards({ rows, today }: { rows: TxRowView[]; today: ISODate }) {
  return (
    <div className="flex flex-col gap-2">
      <SelectAllCheckbox visibleLabel />
      <ul aria-label="Cobros" className="flex flex-col gap-2">
        {rows.map((tx) => (
          <li key={tx.id} className="flex gap-2 rounded-card border border-rule bg-surface py-2 pr-3 pl-2">
            <TxCheckbox tx={tx} />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <TxLink tx={tx} className="min-w-0 truncate font-semibold text-brand hover:underline" />
                <Money value={tx.gross} currency={tx.currency} className="text-lg font-semibold" />
              </div>
              <p className="text-sm text-ink-soft">
                <DateText value={tx.occurredOn} /> · {tx.companyName} · {tx.gatewayName}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StatusBadge tx={tx} today={today} />
                <p className="text-sm">
                  <span className="text-ink-soft">Neto </span>
                  <Money value={tx.net} currency={tx.currency} />
                </p>
              </div>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <p>
                  <span className="text-ink-soft">Comisiones </span>
                  <Money value={tx.fees} currency={tx.currency} />
                </p>
                <DepositDate tx={tx} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
