import { ReceiptText } from "lucide-react";
import { Suspense } from "react";
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Money,
  Percent,
  Stat,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  UrlPeriod,
} from "@/components/ui";
import { ZERO, monthLabel } from "@/lib/pasarelas";
import type { Currency, CurrencySummary } from "@/lib/pasarelas";
import type { CompanyTotal } from "@/server/pasarelas/queries/companies";

const TITLE_ID = "lo-facturado";

export type CompanySummaryProps = {
  /** El resumen del período, por moneda (`summarize` sobre los cobros de la empresa en el período). */
  period: Record<Currency, CurrencySummary>;
  /** Lo facturado en toda la historia, por moneda (`pay_company_totals`). */
  totals: readonly CompanyTotal[];
  /** El nombre de cada pasarela, por id. */
  gatewayNames: ReadonlyMap<string, string>;
};

/** Un porcentaje que puede no existir (una parte de un total en cero). */
function OptionalPercent({ value }: { value: string | null }) {
  return value === null ? <span className="text-ink-soft">—</span> : <Percent value={value} />;
}

/** Lo de UNA moneda: la frase de lo facturado, las cifras del período y sus tablas por mes y por pasarela. */
function CurrencyBlock({
  currency,
  summary,
  total,
  gatewayNames,
  labelled,
}: {
  currency: Currency;
  summary: CurrencySummary | undefined;
  total: CompanyTotal | undefined;
  gatewayNames: ReadonlyMap<string, string>;
  /** Hay más de una moneda: cada bloque lleva su título y sus tablas, la moneda en el nombre. */
  labelled: boolean;
}) {
  const suffix = labelled ? ` (${currency})` : "";
  return (
    <div className="flex flex-col gap-4">
      {labelled ? <h3 className="titulo text-lg">En {currency}</h3> : null}
      <p className="text-lg">
        Esta empresa ha facturado{" "}
        <Money value={summary?.totals.gross ?? ZERO} currency={currency} className="font-semibold" /> en el período y{" "}
        <Money value={total?.gross ?? ZERO} currency={currency} className="font-semibold" /> en total.
      </p>
      {summary === undefined ? (
        <p className="text-ink-soft">Sin cobros en este período.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Cobros" value={summary.totals.count} />
            <Stat
              label="Comisiones"
              value={<Money value={summary.totals.fees} currency={currency} />}
              hint={
                summary.totals.feePct === null ? undefined : (
                  <>
                    <Percent value={summary.totals.feePct} /> del bruto
                  </>
                )
              }
            />
            <Stat label="Neto" value={<Money value={summary.totals.net} currency={currency} />} total />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">Por mes{suffix}</h3>
            <Table label={`Por mes${suffix}`}>
              <THead>
                <Tr>
                  <Th>Mes</Th>
                  <Th numeric>Bruto</Th>
                  <Th numeric>Comisiones</Th>
                  <Th numeric>Neto</Th>
                </Tr>
              </THead>
              <TBody>
                {summary.byMonth.map((month) => (
                  <Tr key={month.month}>
                    <Th scope="row" className="whitespace-nowrap">{monthLabel(month.month)}</Th>
                    <Td numeric>
                      <Money value={month.gross} currency={currency} />
                    </Td>
                    <Td numeric>
                      <Money value={month.fees} currency={currency} />
                    </Td>
                    <Td numeric>
                      <Money value={month.net} currency={currency} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">Por pasarela{suffix}</h3>
            <Table label={`Por pasarela${suffix}`}>
              <THead>
                <Tr>
                  <Th>Pasarela</Th>
                  <Th numeric>Bruto</Th>
                  <Th numeric>Parte</Th>
                  <Th numeric>Costo efectivo</Th>
                </Tr>
              </THead>
              <TBody>
                {summary.byGateway.map((gateway) => (
                  <Tr key={gateway.gatewayId}>
                    <Th scope="row" className="whitespace-nowrap">{gatewayNames.get(gateway.gatewayId) ?? "Pasarela"}</Th>
                    <Td numeric>
                      <Money value={gateway.gross} currency={currency} />
                    </Td>
                    <Td numeric>
                      <OptionalPercent value={gateway.sharePct} />
                    </Td>
                    <Td numeric>
                      <OptionalPercent value={gateway.effectiveCostPct} />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * El resumen propio de la empresa: lo facturado en el período (de la URL) y en toda su historia, por mes y por
 * pasarela. Cada moneda va aparte: nunca se suman monedas distintas.
 */
export function CompanySummary({ period, totals, gatewayNames }: CompanySummaryProps) {
  const currencies = [...new Set([...Object.keys(period), ...totals.map((total) => total.currency)])].sort();
  return (
    <Card>
      <section aria-labelledby={TITLE_ID}>
        <CardHeader>
          <CardTitle id={TITLE_ID}>Lo facturado</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-5">
          {/* `UrlPeriod` lee la URL en el navegador: va dentro de un límite de Suspense. */}
          <Suspense fallback={null}>
            <UrlPeriod />
          </Suspense>
          {currencies.length === 0 ? (
            <EmptyState
              icon={<ReceiptText aria-hidden className="size-8" />}
              title="Todavía no tiene cobros"
              description="Cuando registres cobros de esta empresa, aquí verás cuánto facturó, por mes y por pasarela."
              action={
                <ButtonLink href="/pasarelas/registrar" variant="primary">
                  Registrar cobro
                </ButtonLink>
              }
            />
          ) : (
            currencies.map((currency) => (
              <CurrencyBlock
                key={currency}
                currency={currency}
                summary={period[currency]}
                total={totals.find((total) => total.currency === currency)}
                gatewayNames={gatewayNames}
                labelled={currencies.length > 1}
              />
            ))
          )}
        </CardBody>
      </section>
    </Card>
  );
}
