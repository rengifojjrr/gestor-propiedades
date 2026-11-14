import { Badge, Money } from "@/components/ui";
import { neg } from "@/lib/pasarelas/money";
import type { PayoutPart } from "@/lib/pasarelas/payouts";
import type { Currency } from "@/lib/pasarelas/types";

/**
 * El estado de pago de una parte del reparto en un cobro: «Pagado», «Falta $25,00» o «Se le pagó de más $10,00»
 * (lo que tiene que devolver). Sin estado (preview de «Registrar», cobro fallido o en la papelera) no se pinta.
 */
export function PayoutBadge({ part, currency }: { part: PayoutPart; currency: Currency }) {
  switch (part.state) {
    case "pagado":
      return <Badge tone="success">Pagado</Badge>;
    case "falta":
      return (
        <Badge tone="warning">
          Falta <Money value={part.owed} currency={currency} />
        </Badge>
      );
    case "de_mas":
      return (
        <Badge tone="danger">
          Se le pagó de más <Money value={neg(part.owed)} currency={currency} />
        </Badge>
      );
  }
}
