import { ChevronDown } from "lucide-react";
import { Suspense } from "react";
import { UrlPeriod, UrlSearch, UrlSelect } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/pasarelas/status";
import type { DisplayStatus } from "@/lib/pasarelas/types";

type Option = { value: string; label: string };

export type TxFiltersProps = {
  companies: Option[];
  channels: Option[];
  gateways: Option[];
  accounts: Option[];
  currencies: Option[];
  /** Cuántos de los filtros de «Más filtros» están puestos: si hay alguno, la sección viene abierta. */
  activeMore: number;
};

/** Los estados visibles en el orden del ciclo del dinero. */
const STATUSES: DisplayStatus[] = ["registrado", "en_transito", "depositado", "reembolsado", "en_disputa", "fallido"];

/** «Por caer», «atrasados» (que salen del estado visible) y cada estado, con las claves de `parseTxFilters`. */
const STATUS_OPTIONS: Option[] = [
  { value: "por_caer", label: "Por caer" },
  { value: "atrasado", label: "Atrasados" },
  ...STATUSES.map((status) => ({ value: status, label: STATUS_LABEL[status] })),
];

const RECEIPT_OPTIONS: Option[] = [
  { value: "con", label: "Con comprobante" },
  { value: "sin", label: "Sin comprobante" },
];

/** Los cobros con alguna parte del reparto a la que le falta algo o a la que se le pagó de más. */
const PAYOUT_OPTIONS: Option[] = [{ value: "pendiente", label: "Reparto pendiente" }];

/** Los órdenes que no son el de siempre (más recientes primero, que es quitar el parámetro). */
const SORT_OPTIONS: Option[] = [
  { value: "fecha_asc", label: "Más antiguos primero" },
  { value: "monto_desc", label: "Monto: de mayor a menor" },
  { value: "monto_asc", label: "Monto: de menor a mayor" },
  { value: "estimada_asc", label: "Fecha estimada: la más próxima primero" },
];

/**
 * Búsqueda, período, orden y «Más filtros» (empresa, canal, pasarela, cuenta, moneda, estado, comprobante y
 * reparto), todo en la URL con las claves que entiende `parseTxFilters`. Cambiar un filtro vuelve a la primera página.
 */
export function TxFilters({ companies, channels, gateways, accounts, currencies, activeMore }: TxFiltersProps) {
  return (
    // Los filtros leen la URL con `useSearchParams()`: van dentro de <Suspense>.
    <Suspense fallback={null}>
      <div className="flex flex-col gap-3">
        <UrlSearch label="Buscar" placeholder="Referencia, nota, empresa o monto" />
        <div className="grid gap-3 sm:grid-cols-2">
          <UrlPeriod />
          <UrlSelect param="orden" label="Orden" allLabel="Más recientes primero" options={SORT_OPTIONS} />
        </div>
        <details open={activeMore > 0} className="group rounded-card border border-rule bg-surface">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 font-semibold [&::-webkit-details-marker]:hidden">
            Más filtros{activeMore > 0 ? ` (${activeMore})` : ""}
            <ChevronDown aria-hidden className="size-5 text-ink-soft transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            <UrlSelect param="empresa" label="Empresa" options={companies} />
            <UrlSelect param="canal" label="Canal" allLabel="Todos" options={channels} />
            <UrlSelect param="pasarela" label="Pasarela" options={gateways} />
            <UrlSelect param="cuenta" label="Cuenta destino" options={accounts} />
            <UrlSelect param="moneda" label="Moneda" options={currencies} />
            <UrlSelect param="estado" label="Estado" allLabel="Todos" options={STATUS_OPTIONS} />
            <UrlSelect param="comprobante" label="Comprobante" allLabel="Con o sin comprobante" options={RECEIPT_OPTIONS} />
            <UrlSelect param="reparto" label="Reparto" allLabel="Todos" options={PAYOUT_OPTIONS} />
          </div>
        </details>
      </div>
    </Suspense>
  );
}
