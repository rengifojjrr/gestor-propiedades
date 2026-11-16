import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, CardBody, CardHeader, CardTitle, Money } from "@/components/ui";
import type { CurrencySales, LoaderSales, LoaderView } from "@/server/pasarelas/queries/loaders";
import { LoaderActions } from "./LoaderActions";

/** Una cifra con su nombre; el grupo lleva el nombre de la cifra. */
function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col">
      <span className="text-sm text-ink-soft">{label}</span>
      <span className="cifra text-lg font-semibold break-words">{children}</span>
    </div>
  );
}

/**
 * Las ventas de una moneda en el período: cuántos cobros, bruto, comisiones (las del negocio), neto y lo que llega
 * al banco (el neto menos lo que retienen las pasarelas), por caer y ya depositado. Son las cifras del motor, las
 * mismas del Resumen.
 */
function CurrencyFigures({ sales, showCurrency }: { sales: CurrencySales; showCurrency: boolean }) {
  const { currency, totals } = sales;
  return (
    <div className="flex flex-col gap-2">
      {showCurrency ? <p className="text-sm font-semibold text-ink-soft">{currency}</p> : null}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Figure label="Cobros">{totals.count}</Figure>
        <Figure label="Bruto">
          <Money value={totals.gross} currency={currency} />
        </Figure>
        <Figure label="Comisiones">
          <Money value={totals.fees} currency={currency} />
        </Figure>
        <Figure label="Neto">
          <Money value={totals.net} currency={currency} />
        </Figure>
        <Figure label="Por caer">
          <Money value={totals.pendingPayout} currency={currency} />
        </Figure>
        <Figure label="Depositado">
          <Money value={totals.depositedPayout} currency={currency} />
        </Figure>
      </div>
    </div>
  );
}

/** Las ventas del período de una fila del reporte, por moneda, y el enlace a esos cobros en la lista. */
function Sales({ sales, link }: { sales: LoaderSales; link: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      {sales.sales.length === 0 ? (
        <p className="text-ink-soft">Sin cobros en este período.</p>
      ) : (
        <>
          {sales.sales.map((item) => (
            <CurrencyFigures key={item.currency} sales={item} showCurrency={sales.sales.length > 1} />
          ))}
          <p className="text-sm text-ink-soft">«Por caer» y «Depositado» son lo que llega al banco.</p>
        </>
      )}
      <Link href={sales.href} className="inline-flex min-h-11 items-center self-start font-semibold text-brand hover:underline">
        {link}
      </Link>
    </div>
  );
}

/**
 * Un cargador: su nombre (y si está desactivado), su nota, sus ventas del período con el enlace a esos cobros (desde
 * donde se exportan) y sus acciones.
 */
export function LoaderCard({ loader }: { loader: LoaderView & LoaderSales }) {
  const titleId = `cargador-${loader.id}`;
  return (
    <Card>
      <section aria-labelledby={titleId} className="flex h-full flex-col">
        <CardHeader>
          <CardTitle id={titleId} className="min-w-0 break-words">
            {loader.name}
          </CardTitle>
          {loader.active ? null : <Badge>Desactivado</Badge>}
        </CardHeader>
        <CardBody className="flex flex-1 flex-col gap-4">
          {loader.note ? <p className="text-sm break-words whitespace-pre-line">{loader.note}</p> : null}
          <Sales
            sales={loader}
            link={
              <>
                Ver los cobros<span className="sr-only"> de {loader.name}</span>
              </>
            }
          />
          <div className="mt-auto">
            <LoaderActions
              id={loader.id}
              active={loader.active}
              txCount={loader.txCount}
              values={{ name: loader.name, note: loader.note ?? "" }}
            />
          </div>
        </CardBody>
      </section>
    </Card>
  );
}

/** Los cobros del período que todavía no tienen cargador: lo que falta asignar. */
export function UnassignedCard({ sales }: { sales: LoaderSales }) {
  return (
    <Card>
      <section aria-labelledby="sin-cargador" className="flex h-full flex-col">
        <CardHeader>
          <CardTitle id="sin-cargador">Sin cargador</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-1 flex-col gap-4">
          <p className="text-sm text-ink-soft">
            Lo que falta asignar: en Cobros, elígelos y usa «Asignar cargador…».
          </p>
          <Sales sales={sales} link="Ver los cobros sin cargador" />
        </CardBody>
      </section>
    </Card>
  );
}
