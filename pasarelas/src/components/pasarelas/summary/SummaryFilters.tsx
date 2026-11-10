import { Suspense } from "react";
import { UrlPeriod, UrlSelect } from "@/components/ui";
import type { Currency } from "@/lib/pasarelas/types";

type Option = { value: string; label: string };

export type SummaryFiltersProps = {
  companies: Option[];
  channels: Option[];
  gateways: Option[];
  /** Todas las monedas de la pantalla. El selector solo aparece si hay más de una. */
  currencies: Currency[];
  /** La que rige sin elegir: la de más bruto. */
  defaultCurrency: Currency | null;
};

/**
 * Los filtros del Resumen, en la URL con las claves que entiende `parseTxFilters` (las mismas que la lista de
 * cobros): período, empresa, canal, pasarela y, si hay más de una, la moneda en que se pinta todo.
 */
export function SummaryFilters({ companies, channels, gateways, currencies, defaultCurrency }: SummaryFiltersProps) {
  const others = currencies.filter((currency) => currency !== defaultCurrency);
  return (
    // Los filtros leen la URL con `useSearchParams()`: van dentro de <Suspense>.
    <Suspense fallback={null}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <UrlPeriod className="col-span-2 lg:col-span-4" />
        <UrlSelect param="empresa" label="Empresa" options={companies} />
        <UrlSelect param="canal" label="Canal" allLabel="Todos" options={channels} />
        <UrlSelect param="pasarela" label="Pasarela" options={gateways} />
        {currencies.length > 1 && defaultCurrency !== null ? (
          <UrlSelect
            param="moneda"
            label="Moneda"
            allLabel={defaultCurrency}
            options={others.map((currency) => ({ value: currency, label: currency }))}
          />
        ) : null}
      </div>
    </Suspense>
  );
}
