import { Badge, Card, CardBody, CardHeader, CardTitle, Money, Stat } from "@/components/ui";
import { cmp } from "@/lib/pasarelas/money";
import type { BankAccountTotals, BankAccountView } from "@/server/pasarelas/queries/accounts";
import { AccountActions } from "./AccountActions";
import { formatDays } from "./days";

const count = (n: number) => `${n} ${n === 1 ? "cobro" : "cobros"}`;

/** Cuánto tarda en caer, de lo ya depositado: el promedio y la mediana. */
function lagText(totals: BankAccountTotals): string {
  if (totals.avgDays === null || totals.medianDays === null) return "Todavía sin depósitos: no se sabe cuánto tarda.";
  return `Tarda ${formatDays(totals.avgDays)} en promedio · mediana ${formatDays(totals.medianDays)}.`;
}

/**
 * Lo de la cuenta en una moneda: lo depositado, lo que está por caer y cuánto tarda. Lo que cae es lo que llega al
 * banco: el neto menos lo que retienen las pasarelas (si alguna retuvo algo, lo dice).
 */
function CurrencyTotals({ totals, showCurrency }: { totals: BankAccountTotals; showCurrency: boolean }) {
  const retained =
    cmp(totals.depositedPayout, totals.depositedNet) !== 0 || cmp(totals.pendingPayout, totals.pendingNet) !== 0;
  return (
    <div className="flex flex-col gap-3">
      {showCurrency ? <p className="text-sm font-semibold text-ink-soft">{totals.currency}</p> : null}
      {/* Lado a lado si caben; si una cifra es larga (miles en otra moneda), la segunda baja: nada se desborda. */}
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <Stat
          label="Depositado"
          value={<Money value={totals.depositedPayout} currency={totals.currency} />}
          hint={count(totals.depositedCount)}
        />
        <Stat
          label="Por caer"
          value={<Money value={totals.pendingPayout} currency={totals.currency} />}
          hint={count(totals.pendingCount)}
        />
      </div>
      {retained ? (
        <p className="text-sm text-ink-soft">
          Sin lo que retienen las pasarelas: eso le cae a otras personas, no a esta cuenta.
        </p>
      ) : null}
      <p className="text-sm text-ink-soft">{lagText(totals)}</p>
    </div>
  );
}

/** Una cuenta destino: sus datos, lo que cae en ella por moneda y sus acciones. */
export function AccountCard({ account }: { account: BankAccountView }) {
  const titleId = `cuenta-${account.id}`;
  return (
    <Card>
      <section aria-labelledby={titleId} className="flex h-full flex-col">
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <CardTitle id={titleId} className="break-words">
              {account.alias}
            </CardTitle>
            <p className="text-sm text-ink-soft">
              {account.institution ? <>{account.institution} · </> : null}
              {account.last4 ? (
                <>
                  <span aria-hidden>•••• </span>
                  <span className="sr-only">terminada en </span>
                  {account.last4} ·{" "}
                </>
              ) : null}
              {account.currency}
            </p>
          </div>
          {account.active ? null : <Badge>Inactiva</Badge>}
        </CardHeader>
        <CardBody className="flex flex-1 flex-col gap-5">
          {account.totals.length === 0 ? (
            <p className="text-ink-soft">Todavía no hay cobros con esta cuenta.</p>
          ) : (
            account.totals.map((totals) => (
              <CurrencyTotals key={totals.currency} totals={totals} showCurrency={account.totals.length > 1} />
            ))
          )}
          {account.notes ? <p className="text-sm break-words whitespace-pre-line">{account.notes}</p> : null}
          <div className="mt-auto">
            <AccountActions
              id={account.id}
              active={account.active}
              txCount={account.txCount}
              gatewayCount={account.gatewayCount}
              values={{
                alias: account.alias,
                institution: account.institution ?? "",
                last4: account.last4 ?? "",
                currency: account.currency,
                notes: account.notes ?? "",
              }}
            />
          </div>
        </CardBody>
      </section>
    </Card>
  );
}
