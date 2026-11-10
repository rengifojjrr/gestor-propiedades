import { Badge, cn, type BadgeTone } from "@/components/ui";
import { STATUS_LABEL, displayStatus, isOverdue, isPartialRefund } from "@/lib/pasarelas";
import type { DisplayStatus, ISODate, LeanTx } from "@/lib/pasarelas";

const TONE: Record<DisplayStatus, BadgeTone> = {
  registrado: "neutral",
  en_transito: "info",
  depositado: "success",
  reembolsado: "neutral",
  en_disputa: "warning",
  fallido: "danger",
};

export type StatusBadgeProps = {
  /** Lo que el motor necesita para saber el estado visible, si hubo reembolso parcial y si está atrasado. */
  tx: Pick<LeanTx, "status" | "disputeState" | "refunded" | "grossOriginal" | "estimatedDepositOn">;
  /** Hoy en Nueva York: lo que está por caer con la fecha estimada anterior está atrasado. */
  today: ISODate;
  className?: string;
};

/**
 * El estado de un cobro como sellos: el visible del motor (`displayStatus`) y, aparte, «Reembolso parcial» y
 * «Atrasado» cuando corresponden. Sirve en la lista, en el detalle y en el Resumen.
 */
export function StatusBadge({ tx, today, className }: StatusBadgeProps) {
  const status = displayStatus(tx);
  return (
    <span className={cn("inline-flex flex-wrap gap-1", className)}>
      <Badge tone={TONE[status]} data-stamp>
        {STATUS_LABEL[status]}
      </Badge>
      {isPartialRefund(tx) ? (
        <Badge tone="info" data-stamp>
          Reembolso parcial
        </Badge>
      ) : null}
      {isOverdue(tx, today) ? (
        <Badge tone="warning" data-stamp>
          Atrasado
        </Badge>
      ) : null}
    </span>
  );
}
