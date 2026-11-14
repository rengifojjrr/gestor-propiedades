import Link from "next/link";
import type { ReactNode } from "react";
import { cobros } from "@/components/pasarelas/tx/plural";
import { Card, Money, Stat, cn } from "@/components/ui";
import { formatDate, windowDayLabels } from "@/lib/pasarelas/dates";
import type { TransitAmount } from "@/lib/pasarelas/transit";
import type { Currency, ISODate } from "@/lib/pasarelas/types";
import type { TransitGroup, TransitView } from "@/server/pasarelas/queries/summary";
import { TransitGroups, type TransitGroupView } from "./TransitGroups";

const HEADING_ID = "dinero-en-camino";
const LINK = "inline-flex min-h-11 items-center font-semibold text-brand hover:underline";

/** Los nombres que se ven, por id. */
export type TransitNames = {
  company: (id: string) => string;
  gateway: (id: string) => string;
  /** `null`: «Sin cuenta». */
  account: (id: string | null) => string;
};

export type MoneyInTransitProps = {
  transit: TransitView;
  currency: Currency;
  today: ISODate;
  /** Hay más de una moneda: el subtítulo dice en cuál va. */
  showCurrency: boolean;
  names: TransitNames;
};

/** Una cifra grande de una fase. La tarjeta es un grupo con el nombre de la cifra; en ámbar, lo que ya debió llegar. */
function TransitCard({
  label,
  amount,
  currency,
  hint,
  warning = false,
}: {
  label: string;
  amount: TransitAmount;
  currency: Currency;
  hint: ReactNode;
  warning?: boolean;
}) {
  return (
    <Card role="group" aria-label={label} className={cn("min-w-0 p-3 sm:p-4", warning && "border-warning bg-warning-soft")}>
      <Stat label={label} value={<Money value={amount.payout} currency={currency} />} hint={hint} />
    </Card>
  );
}

/** «el jue 10 dic» o «entre el lun 16 y el mié 18 nov», con cada fecha como `<time>`. */
function releaseDays({ from, to }: { from: ISODate; to: ISODate }): ReactNode {
  const [first, last] = windowDayLabels({ from, to });
  if (last === undefined) {
    return (
      <>
        el <time dateTime={to}>{first}</time>
      </>
    );
  }
  return (
    <>
      entre el <time dateTime={from}>{first}</time> y el <time dateTime={to}>{last}</time>
    </>
  );
}

/** Un grupo para la lista: la cuenta nombrada (con su parte si va por partes) y cada cobro con sus nombres. */
function groupView(group: TransitGroup, names: TransitNames): TransitGroupView {
  const account = names.account(group.bankAccountId);
  return {
    date: group.date,
    from: group.from,
    // Un grupo de más cobros de los que se marcan de una vez va por partes: «… · parte 1 de 2».
    accountName: group.part === null ? account : `${account} · parte ${group.part.index} de ${group.part.of}`,
    payout: group.payout,
    count: group.count,
    ids: group.ids,
    overdue: group.overdue,
    phase: group.phase,
    label: group.label,
    items: group.items.map((item) => ({
      id: item.tx.id,
      title: item.tx.reference ?? `Cobro del ${formatDate(item.tx.occurredOn)}`,
      source: `${names.company(item.tx.companyId)} · ${names.gateway(item.tx.gatewayId)}`,
      payout: item.payout,
      phase: item.phase,
      label: item.label,
      window: item.window,
      progress: item.progress,
    })),
  };
}

/**
 * «Dinero en camino»: lo que está por caer AHORA, sin importar el período ni los filtros. Arriba, en grande, cuánto
 * ya debió llegar, cuánto puede llegar hoy, en los próximos 7 días y más adelante, y el total; aparte, lo detenido
 * por disputas y lo que retienen las pasarelas (no suman). Luego, por cuenta destino; la lista por fecha y cuenta,
 * con la fase y la cuenta regresiva de cada cobro; y lo marcado depositado en los últimos 30 días. Todo sale del
 * motor (`moneyInTransit`): aquí solo se pinta.
 */
export function MoneyInTransit({ transit, currency, today, showCurrency, names }: MoneyInTransitProps) {
  const { buckets, total, held, retained, accounts, unassigned, deposited, links } = transit;
  return (
    <section
      aria-labelledby={HEADING_ID}
      className="flex flex-col gap-5 rounded-card border border-rule-strong bg-sunken p-3 sm:p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id={HEADING_ID} className="titulo text-xl">
          Dinero en camino
        </h2>
        <p className="text-ink-soft">Ahora mismo, sin importar el período{showCurrency ? `, en ${currency}` : null}.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <TransitCard
          label="Ya debió llegar"
          amount={buckets.atrasado}
          currency={currency}
          warning={buckets.atrasado.count > 0}
          hint={
            links.overdue === null ? (
              "Nada atrasado"
            ) : (
              <span className="flex flex-col">
                Revisa tu banco y márcalo
                <Link href={links.overdue} className={LINK}>
                  Ver {cobros(buckets.atrasado.count)}
                </Link>
              </span>
            )
          }
        />
        <TransitCard label="Puede llegar hoy" amount={buckets.hoy} currency={currency} hint={cobros(buckets.hoy.count)} />
        <TransitCard
          label="Próximos 7 días"
          amount={buckets.semana}
          currency={currency}
          hint={cobros(buckets.semana.count)}
        />
        <TransitCard
          label="Más adelante"
          amount={buckets.despues}
          currency={currency}
          hint={cobros(buckets.despues.count)}
        />
        {/* La suma de las cuatro: en el celular, a todo el ancho y en una línea con su enlace. */}
        <Card
          role="group"
          aria-label="Total en camino"
          className="col-span-2 flex min-w-0 flex-wrap items-end justify-between gap-x-3 p-3 sm:p-4 lg:col-span-1 lg:flex-col lg:items-start"
        >
          <Stat label="Total en camino" value={<Money value={total.payout} currency={currency} />} total />
          {links.total === null ? (
            <p className="text-sm text-ink-soft">Nada en camino</p>
          ) : (
            <Link href={links.total} className={cn(LINK, "text-sm")}>
              Ver {cobros(total.count)}
            </Link>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        {held.count === 0 ? null : (
          <p>
            Detenido por {held.count === 1 ? "1 disputa abierta" : `${held.count} disputas abiertas`}:{" "}
            <Money value={held.payout} currency={currency} className="font-semibold" />
          </p>
        )}
        {retained === null ? null : (
          <p>
            Retenido por las pasarelas (no llega a tu banco):{" "}
            <Money value={retained.amount} currency={currency} className="font-semibold" /> · se libera{" "}
            {releaseDays(retained)}
          </p>
        )}
        <p className="text-ink-soft">
          La app no ve tu banco: «llegó» es lo que marcas «depositado», y lo que no marcas pasa a «atrasado». Las
          fechas son estimadas con los días al depósito de cada pasarela, y cuenta todo lo por caer, esté
          «Registrado» o «En tránsito».
        </p>
      </div>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 id="dinero-por-cuenta" className="font-semibold">
            Por cuenta destino
          </h3>
          {accounts.length === 0 && unassigned === null ? (
            <p className={EMPTY}>Nada en camino.</p>
          ) : (
            <ul aria-labelledby="dinero-por-cuenta" className={LIST}>
              {accounts.map((account) => (
                <AccountRow
                  key={account.bankAccountId}
                  name={names.account(account.bankAccountId)}
                  amount={<Money value={account.total.payout} currency={currency} className="font-semibold" />}
                  detail={
                    <>
                      {cobros(account.total.count)}
                      {account.overdue.count === 0 ? null : (
                        <>
                          {" · "}
                          <span className="text-warning">
                            <Money value={account.overdue.payout} currency={currency} /> ya debió llegar
                          </span>
                        </>
                      )}
                    </>
                  }
                />
              ))}
              {unassigned === null ? null : (
                <AccountRow
                  name="Sin cuenta"
                  amount={<Money value={unassigned.total.payout} currency={currency} className="font-semibold" />}
                  detail={cobros(unassigned.total.count)}
                  className="bg-warning-soft"
                >
                  Para saber a qué cuenta llegan: en{" "}
                  <Link href="/pasarelas/empresas" className="font-semibold text-brand underline">
                    Empresas
                  </Link>
                  , ponle cuenta destino a la pasarela en esa empresa (vale para los cobros nuevos); a los que ya
                  están, «Editar» en cada cobro.
                </AccountRow>
              )}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <h3 id="dinero-depositado" className="font-semibold">
              Marcado depositado en los últimos 30 días
            </h3>
            <p className="text-sm text-ink-soft">
              Lo más cercano a «cuánto hay» que la app puede saber: lo que marcaste depositado, por cuenta.
            </p>
          </div>
          {deposited.total.count === 0 ? (
            <p className={EMPTY}>Nada marcado depositado en los últimos 30 días.</p>
          ) : (
            <div className="rounded-card border border-rule bg-surface">
              <ul aria-labelledby="dinero-depositado" className="flex flex-col divide-y divide-rule">
                {deposited.accounts.map((account) => (
                  <AccountRow
                    key={account.bankAccountId ?? "sin-cuenta"}
                    name={names.account(account.bankAccountId)}
                    amount={<Money value={account.payout} currency={currency} className="font-semibold" />}
                    detail={cobros(account.count)}
                  />
                ))}
              </ul>
              <p className="flex items-baseline justify-between gap-3 border-t border-rule-strong px-4 py-3">
                <span className="font-semibold">Total</span>
                <span className="cifra doble-raya text-lg font-semibold" data-testid="depositado-total">
                  <Money value={deposited.total.payout} currency={currency} />
                </span>
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-semibold">Por fecha y cuenta</h3>
          <p className="text-sm text-ink-soft">Lo atrasado primero. Abre un grupo para ver sus cobros.</p>
        </div>
        <TransitGroups
          soon={transit.soon.map((group) => groupView(group, names))}
          later={transit.later.map((group) => groupView(group, names))}
          currency={currency}
          today={today}
        />
      </div>
    </section>
  );
}

const LIST = "flex flex-col divide-y divide-rule overflow-hidden rounded-card border border-rule bg-surface";
const EMPTY = "rounded-card border border-rule bg-surface p-4 text-ink-soft";

/** Una cuenta: su nombre (se parte si es largo) y el monto en una línea; debajo, su detalle. */
function AccountRow({
  name,
  amount,
  detail,
  className,
  children,
}: {
  name: string;
  amount: ReactNode;
  detail: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <li className={cn("flex flex-col gap-0.5 px-4 py-3", className)}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-semibold break-words">{name}</span>
        <span className="shrink-0">{amount}</span>
      </span>
      <span className="text-sm text-ink-soft">{detail}</span>
      {children === undefined ? null : <span className="pt-1 text-sm">{children}</span>}
    </li>
  );
}
