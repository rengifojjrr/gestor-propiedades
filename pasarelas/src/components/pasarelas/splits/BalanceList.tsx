import Link from "next/link";
import { Money } from "@/components/ui";
import { cmp, isZero } from "@/lib/pasarelas/money";
import type { Currency, Money as MoneyValue } from "@/lib/pasarelas/types";

/**
 * Lo de un beneficiario en una moneda, como lo da el libro. `retained`: lo que ya le pagó la pasarela de lo que
 * retuvo; el saldo ya lo descuenta.
 */
export type BalanceRow = {
  currency: Currency;
  assigned: MoneyValue;
  settled: MoneyValue;
  /** Sin él (el Resumen, que da lo asignado y lo liquidado del período), no se pinta. */
  retained?: MoneyValue;
  balance: MoneyValue;
};

/**
 * El saldo, con su signo. Si es negativo, el beneficiario recibió más de lo que le tocaba (o se le reembolsó un
 * cobro ya liquidado): lo debe él, y se dice con palabras, no solo con el signo y el color.
 */
export function BalanceAmount({ balance, currency }: { balance: MoneyValue; currency: Currency }) {
  return (
    <span className="flex flex-col items-end">
      <Money value={balance} currency={currency} className="font-semibold" />
      {cmp(balance, "0.00") < 0 ? <span className="text-sm text-danger">a favor de la empresa</span> : null}
    </span>
  );
}

/**
 * Asignado, liquidado, retenido (si recibió algo de lo que retiene una pasarela) y saldo de cada moneda: una al lado
 * de otra, nunca sumadas.
 */
export function BalanceFigures({ rows }: { rows: readonly BalanceRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.currency} className="flex flex-col gap-1 rounded-control bg-sunken p-3">
          {rows.length > 1 ? <p className="text-sm font-semibold text-ink-soft">En {row.currency}</p> : null}
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-1">
            <dt className="text-ink-soft">Asignado</dt>
            <dd className="text-right">
              <Money value={row.assigned} currency={row.currency} />
            </dd>
            <dt className="text-ink-soft">Liquidado</dt>
            <dd className="text-right">
              <Money value={row.settled} currency={row.currency} />
            </dd>
            {row.retained === undefined || isZero(row.retained) ? null : (
              <>
                <dt className="text-ink-soft">Retenido</dt>
                <dd className="text-right" data-testid={`retenido-${row.currency}`}>
                  <Money value={row.retained} currency={row.currency} />
                </dd>
              </>
            )}
            <dt className="font-semibold">Saldo</dt>
            <dd className="text-right" data-testid={`saldo-${row.currency}`}>
              <BalanceAmount balance={row.balance} currency={row.currency} />
            </dd>
          </dl>
          {row.retained === undefined || isZero(row.retained) ? null : (
            <p className="text-sm text-ink-soft">
              Retenido: lo que una pasarela ya le pagó de lo que retuvo. El saldo lo descuenta.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** El libro: cada beneficiario con lo suyo, por moneda. Su nombre lleva a su ficha. */
export function Ledger({ entries }: { entries: readonly { id: string; name: string; rows: readonly BalanceRow[] }[] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex min-w-0 flex-col gap-2">
          <h3 className="titulo text-base leading-snug">
            <Link
              href={`/pasarelas/repartos/beneficiarios/${entry.id}`}
              className="-my-2 inline-flex min-h-11 items-center text-brand hover:underline"
            >
              {entry.name}
            </Link>
          </h3>
          <BalanceFigures rows={entry.rows} />
        </li>
      ))}
    </ul>
  );
}
