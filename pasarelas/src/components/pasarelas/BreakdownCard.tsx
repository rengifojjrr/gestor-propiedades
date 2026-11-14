import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardTitle, DateText, Money, Percent, cn } from "@/components/ui";
import { buyerFeesOf, payoutOf, retentionOf, retentionReleaseOn, type Retention } from "@/lib/pasarelas/breakdown";
import { formatPct, isZero, sub } from "@/lib/pasarelas/money";
import type { Breakdown, BreakdownLine, ISODate } from "@/lib/pasarelas/types";

/*
 * El desglose de un cobro tal como lo calculó el motor: lo cobrado, cada comisión con su cuenta, el total y el
 * neto. Si la comisión la pagó el comprador, el neto se lee «Lo que te queda» y una nota dice por qué; con un
 * reembolso o una disputa, además, qué parte de las comisiones pagó el comprador y qué parte el negocio. Si la
 * pasarela retiene algo, cuánto, a quién le cae, hacia qué fecha se libera y lo que llega al banco. Solo pinta
 * lo que trae el desglose (los nombres van dentro): sirve igual para la vista previa de «Registrar cobro» que para
 * el desglose congelado del detalle. Sin estado: se puede usar desde el servidor.
 */

/**
 * Cómo se calculó una línea: «2,9 % + $0,30 de $100,00». Lo fijo no lleva cuenta. La comisión informada por la
 * pasarela se dice tal cual; con un reembolso ya no es la informada sino su parte de lo no reembolsado, y se dice
 * de cuánto era la informada.
 */
function LineRule({ line, breakdown }: { line: BreakdownLine; breakdown: Breakdown }) {
  const { currency } = breakdown;
  if (line.baseKind === "informado") {
    const informed = breakdown.rules.gateway.feeOverride;
    if (isZero(breakdown.state.refunded) || informed === undefined) return <>Informada por la pasarela</>;
    return (
      <>
        Proporcional a lo no reembolsado de la comisión informada (<Money value={informed} currency={currency} />)
      </>
    );
  }
  if (line.baseKind === "fijo") return null;
  const hasPct = !isZero(line.pct);
  const hasFixed = !isZero(line.fixed);
  return (
    <>
      {hasPct ? <Percent value={line.pct} /> : null}
      {hasPct && hasFixed ? " + " : null}
      {hasFixed ? <Money value={line.fixed} currency={currency} /> : null}
      {" de "}
      <Money value={line.baseAmount} currency={currency} />
      {line.baseKind === "despues_de_comision" ? " (después de la comisión)" : null}
    </>
  );
}

/** Una fila de cifras: lo que es a la izquierda y el monto a la derecha. */
function Row({ label, testId, strong, children }: { label: string; testId: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong && "text-lg font-semibold")}>
      <dt>{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}

/**
 * Lo que retiene la pasarela: «Retiene OTF Demo (5 %)», a quién le cae y cuánto, hacia qué fecha se libera (si se sabe
 * el día del cobro) y lo que de verdad llega al banco: el neto menos lo retenido. Sin nada retenido (un reembolso
 * total) no hay a quién le caiga ni nada que liberar: lo dice y llega el neto.
 */
function RetentionPart({
  breakdown,
  retention,
  occurredOn,
}: {
  breakdown: Breakdown;
  retention: Retention;
  occurredOn: ISODate | undefined;
}) {
  const { currency } = breakdown;
  const nothing = isZero(retention.amount);
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <dl className="flex flex-col gap-1">
        <Row label={`Retiene ${breakdown.rules.gateway.name} (${formatPct(retention.pct)})`} testId="retenido">
          <Money value={retention.amount} currency={currency} />
        </Row>
      </dl>
      {nothing ? (
        <p className="text-sm text-ink-soft">Sin nada cobrado, no retiene nada.</p>
      ) : (
        <>
          <ul aria-label="A quién le cae lo retenido" className="flex flex-col gap-1 text-sm">
            {retention.shares.map((share) => (
              <li
                key={share.beneficiaryId}
                data-testid="retencion-persona"
                className="flex items-baseline justify-between gap-3 pl-3"
              >
                <span>{share.name}</span>
                <Money value={share.amount} currency={currency} />
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink-soft">
            {occurredOn === undefined ? null : (
              <>
                Se libera hacia el <DateText value={retentionReleaseOn(occurredOn, retention.days)} />.{" "}
              </>
            )}
            La pasarela se lo paga directo a esas personas: no llega al banco.
          </p>
        </>
      )}
      <dl className="flex flex-col gap-1">
        <Row label="Llega al banco" testId="llega-al-banco" strong>
          <Money value={payoutOf(breakdown)} currency={currency} />
        </Row>
      </dl>
    </div>
  );
}

/** Lo que paga el negocio aunque la comisión la pague el comprador: lo que cuesta un reembolso o una disputa. */
const isBusinessCost = (line: BreakdownLine): boolean => line.kind === "reembolso" || line.kind === "disputa";

/**
 * `occurredOn`: el día del cobro, para decir hacia qué fecha se libera lo retenido (sin él, no se dice).
 */
export function BreakdownCard({ breakdown, occurredOn }: { breakdown: Breakdown; occurredOn?: ISODate }) {
  const { currency, state, lines } = breakdown;
  const retention = retentionOf(breakdown);
  const refunded = !isZero(state.refunded);
  const byBuyer = state.feesPaidBy === "comprador";
  // Con un reembolso o una disputa, el comprador no pagó todas las comisiones: se dice quién pagó qué.
  const split = byBuyer && lines.some(isBusinessCost);
  const buyerFees = buyerFeesOf(breakdown);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Desglose</CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <dl className="flex flex-col gap-1">
          {refunded ? (
            <>
              <Row label="Cobrado" testId="cobrado">
                <Money value={state.grossOriginal} currency={currency} />
              </Row>
              <Row label="Reembolsado" testId="reembolsado">
                <Money value={state.refunded} currency={currency} />
              </Row>
            </>
          ) : null}
          <Row label="Bruto" testId="bruto">
            <Money value={breakdown.gross} currency={currency} />
          </Row>
        </dl>

        {lines.length === 0 ? (
          <p className="text-ink-soft">Sin comisiones.</p>
        ) : (
          <ul aria-label="Comisiones" className="flex flex-col gap-2 border-t border-rule pt-3">
            {lines.map((line) => (
              <li key={`${line.kind}-${line.refId ?? line.name}`} className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span>{line.name}</span>
                  <span className="text-sm text-ink-soft">
                    <LineRule line={line} breakdown={breakdown} />
                  </span>
                </span>
                <Money value={line.amount} currency={currency} />
              </li>
            ))}
          </ul>
        )}

        <dl className="flex flex-col gap-1 border-t border-rule pt-3">
          <Row label="Comisiones" testId="comisiones">
            <Money value={breakdown.feesTotal} currency={currency} />
          </Row>
          {split ? (
            <>
              <Row label="Pagadas por el comprador" testId="pagado-comprador">
                <Money value={buyerFees} currency={currency} />
              </Row>
              <Row label="Pagadas por el negocio" testId="pagado-negocio">
                <Money value={sub(breakdown.feesTotal, buyerFees)} currency={currency} />
              </Row>
            </>
          ) : null}
          <Row label={byBuyer ? "Lo que te queda" : "Neto"} testId="neto" strong>
            <Money value={breakdown.net} currency={currency} />
          </Row>
        </dl>
        {split ? (
          <p className="text-sm text-ink-soft">
            El comprador paga las comisiones de lo que sigue pagando; lo que cuesta un reembolso o una disputa lo paga
            el negocio.
          </p>
        ) : byBuyer ? (
          <p className="text-sm text-ink-soft">La comisión la pagó el comprador: se le cobró de más para cubrirla.</p>
        ) : null}
        {retention === null ? null : (
          <RetentionPart breakdown={breakdown} retention={retention} occurredOn={occurredOn} />
        )}
      </CardBody>
    </Card>
  );
}
