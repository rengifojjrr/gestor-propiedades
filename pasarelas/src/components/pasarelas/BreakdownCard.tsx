import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardTitle, Money, Percent, cn } from "@/components/ui";
import { buyerFeesOf } from "@/lib/pasarelas/breakdown";
import { isZero, sub } from "@/lib/pasarelas/money";
import type { Breakdown, BreakdownLine } from "@/lib/pasarelas/types";

/*
 * El desglose de un cobro tal como lo calculó el motor: lo cobrado, cada comisión con su cuenta, el total y el
 * neto. Si la comisión la pagó el comprador, el neto se lee «Lo que te queda» y una nota dice por qué; con un
 * reembolso o una disputa, además, qué parte de las comisiones pagó el comprador y qué parte el negocio. Solo pinta
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

/** Lo que paga el negocio aunque la comisión la pague el comprador: lo que cuesta un reembolso o una disputa. */
const isBusinessCost = (line: BreakdownLine): boolean => line.kind === "reembolso" || line.kind === "disputa";

export function BreakdownCard({ breakdown }: { breakdown: Breakdown }) {
  const { currency, state, lines } = breakdown;
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
      </CardBody>
    </Card>
  );
}
