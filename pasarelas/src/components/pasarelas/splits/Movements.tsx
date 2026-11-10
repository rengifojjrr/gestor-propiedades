import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Badge, Card, CardBody, CardHeader, CardTitle, DateText, Money, Pagination, Percent } from "@/components/ui";
import { formatDate } from "@/lib/pasarelas/dates";
import { cmp, formatMoney, neg } from "@/lib/pasarelas/money";
import type { Settlement } from "@/server/pasarelas/dto";
import type { AllocationMovement } from "@/server/pasarelas/queries/splits";
import { SettlementActions } from "./SettlementActions";

/** Una tarjeta de movimientos con su lista, su vacío y su paginación (en la URL, con su propio parámetro). */
function MovementsCard({
  id,
  title,
  empty,
  total,
  page,
  pageSize,
  param,
  children,
}: {
  /** Para nombrar la sección con su título. */
  id: string;
  title: string;
  empty: string;
  total: number;
  page: number;
  pageSize: number;
  param: string;
  children: ReactNode;
}) {
  const titleId = `${id}-titulo`;
  return (
    <Card>
      <section aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>{title}</CardTitle>
          <span className="text-sm text-ink-soft">{total === 1 ? "1 movimiento" : `${total} movimientos`}</span>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          {total === 0 ? (
            <p className="text-ink-soft">{empty}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-rule">{children}</ul>
          )}
          <Suspense>
            <Pagination page={page} pageSize={pageSize} total={total} param={param} />
          </Suspense>
        </CardBody>
      </section>
    </Card>
  );
}

/** Lo que le tocó al beneficiario de cada cobro: la fecha, la empresa, el cobro y su parte. */
export function AllocationMovements({
  rows,
  total,
  page,
  pageSize,
  companyName,
}: {
  rows: readonly AllocationMovement[];
  total: number;
  page: number;
  pageSize: number;
  companyName: (companyId: string) => string;
}) {
  return (
    <MovementsCard
      id="movimientos-repartos"
      title="Repartos"
      empty="Todavía no le tocó nada de ningún cobro."
      total={total}
      page={page}
      pageSize={pageSize}
      param="repartos"
    >
      {rows.map((row) => (
        <li key={row.transactionId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Link
              href={`/pasarelas/cobros/${row.transactionId}`}
              className="-my-2 inline-flex min-h-11 items-center font-semibold text-brand hover:underline"
            >
              <DateText value={row.occurredOn} />
            </Link>
            <p className="text-sm text-ink-soft">
              {companyName(row.companyId)} · cobro de <Money value={row.txGross} currency={row.currency} />
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <Money value={row.amount} currency={row.currency} className="font-semibold" />
            <span className="text-sm text-ink-soft">
              {row.isRemainder ? (
                <>
                  Resto (<Percent value={row.pct} />)
                </>
              ) : (
                <Percent value={row.pct} />
              )}
            </span>
          </div>
        </li>
      ))}
    </MovementsCard>
  );
}

/** Lo que ya se le pagó (o lo que devolvió), con su comprobante. */
export function SettlementMovements({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: readonly Settlement[];
  total: number;
  page: number;
  pageSize: number;
}) {
  return (
    <MovementsCard
      id="movimientos-liquidaciones"
      title="Liquidaciones"
      empty="Todavía no se le ha pagado nada."
      total={total}
      page={page}
      pageSize={pageSize}
      param="liquidaciones"
    >
      {rows.map((row) => {
        const refund = cmp(row.amount, "0.00") < 0;
        const kind = refund ? "la devolución" : "el pago";
        return (
          <li key={row.id} className="flex flex-col gap-2 py-3">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  <DateText value={row.paidOn} />
                  <Badge tone={refund ? "warning" : "neutral"}>{refund ? "Devolución" : "Pago"}</Badge>
                </p>
                {row.method ? <p className="text-sm text-ink-soft">{row.method}</p> : null}
                {row.note ? <p className="text-sm break-words">{row.note}</p> : null}
              </div>
              <Money value={row.amount} currency={row.currency} className="font-semibold" />
            </div>
            <SettlementActions
              id={row.id}
              receiptMime={row.receiptPath === null ? null : row.receiptMime}
              // «la devolución de $10,00»: ya dice que es una devolución, el monto va sin el signo menos.
              description={`${kind} de ${formatMoney(refund ? neg(row.amount) : row.amount, row.currency)} del ${formatDate(row.paidOn)}`}
            />
          </li>
        );
      })}
    </MovementsCard>
  );
}
