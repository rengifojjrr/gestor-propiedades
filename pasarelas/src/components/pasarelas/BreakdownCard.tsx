import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardTitle, Money, Percent, cn } from "@/components/ui";
import { isZero } from "@/lib/pasarelas/money";
import type { Breakdown, BreakdownLine } from "@/lib/pasarelas/types";

/*
 * El desglose de un cobro tal como lo calculó el motor: lo cobrado, cada comisión con su cuenta, el total y el
 * neto. Solo pinta lo que trae el desglose (los nombres van dentro): sirve igual para la vista previa de
 * «Registrar cobro» que para el desglose congelado del detalle. Sin estado: se puede usar desde el servidor.
 */

/** Cómo se calculó una línea: «2,9 % + $0,30 de $100,00». Lo informado o fijo no lleva cuenta. */
function LineRule({ line, currency }: { line: BreakdownLine; currency: string }) {
  if (line.baseKind === "informado") return <>Informada por la pasarela</>;
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

export function BreakdownCard({ breakdown }: { breakdown: Breakdown }) {
  const { currency, state, lines } = breakdown;
  const refunded = !isZero(state.refunded);
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
                    <LineRule line={line} currency={currency} />
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
          <Row label="Neto" testId="neto" strong>
            <Money value={breakdown.net} currency={currency} />
          </Row>
        </dl>
      </CardBody>
    </Card>
  );
}
