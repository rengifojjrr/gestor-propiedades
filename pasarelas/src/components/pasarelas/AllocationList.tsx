import { Badge, Money, Percent } from "@/components/ui";
import type { Breakdown } from "@/lib/pasarelas/types";

/*
 * El reparto de un cobro tal como lo calculó el motor: sobre qué se reparte y cuánto le toca a cada beneficiario.
 * Si la comisión la pagó el comprador, se reparte lo que queda (el neto) y lo dice.
 * Los nombres vienen dentro del desglose. Sin estado: se puede usar desde el servidor (detalle del cobro) o dentro
 * de la vista previa de «Registrar cobro».
 */

const BASE_LABEL = { neto: "Sobre el neto", bruto: "Sobre el bruto" } as const;

export function AllocationList({ breakdown }: { breakdown: Breakdown }) {
  const { currency, alloc } = breakdown;
  if (alloc.baseKind === null) return <p className="text-ink-soft">Este cobro no se reparte.</p>;
  return (
    <div className="flex flex-col gap-2">
      {breakdown.state.feesPaidBy === "comprador" ? (
        <p className="text-sm">Se reparte sobre lo que te queda: la comisión la pagó el comprador.</p>
      ) : null}
      <p className="text-sm text-ink-soft">
        {BASE_LABEL[alloc.baseKind]}: <Money value={alloc.baseAmount} currency={currency} />
      </p>
      <ul aria-label="Reparto" className="flex flex-col gap-2">
        {alloc.lines.map((line) => (
          <li key={line.beneficiaryId} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span>{line.name}</span>
              {line.isRemainder ? <Badge>Resto</Badge> : null}
              <Percent value={line.pct} className="text-sm text-ink-soft" />
            </span>
            <Money value={line.amount} currency={currency} />
          </li>
        ))}
      </ul>
    </div>
  );
}
