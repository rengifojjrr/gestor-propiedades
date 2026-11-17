"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Field, Input, Select } from "@/components/ui";
import { hrefWith } from "@/components/ui/url";
import { DATE_BASES, DEPOSIT_HINT, basisChanges, periodChangesOf, periodOptions, shownPeriod } from "./period";

/** Una fecha a medio escribir con el teclado (año «0002») todavía no es un filtro. */
const isWholeDate = (value: string) => value === "" || value >= "1900-01-01";

/**
 * El período de Cobros: «Fechas de» (la venta o el depósito) y el período, con «Elegir fechas» y sus dos fechas.
 * Todo en la URL (`fechas`, `periodo`, `desde`, `hasta`) con las claves de `parseTxFilters`; cambiar algo vuelve a la
 * primera página. Con «El depósito», una línea dice qué fecha cuenta. Va dentro de `<Suspense>` (lee la URL).
 */
export function TxPeriod() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const apply = (changes: Record<string, string | null>) => {
    router.replace(hrefWith(pathname, searchParams, changes), { scroll: false });
  };
  const byDeposit = searchParams.get("fechas") === "deposito";
  const requested = searchParams.get("periodo");
  const options = periodOptions(byDeposit);
  const period = shownPeriod(requested, byDeposit);
  const from = searchParams.get("desde") ?? "";
  const to = searchParams.get("hasta") ?? "";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-3">
        <Field label="Fechas de" className="min-w-36 flex-1">
          <Select
            value={byDeposit ? "deposito" : ""}
            onChange={(event) => apply(basisChanges(event.target.value === "deposito", requested))}
          >
            {DATE_BASES.map((basis) => (
              <option key={basis.value} value={basis.value}>
                {basis.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Período" className="min-w-44 flex-1">
          <Select
            value={period}
            onChange={(event) => {
              const chosen = options.find((option) => option.value === event.target.value);
              if (chosen !== undefined) apply(periodChangesOf(chosen.value));
            }}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {period === "personalizado" ? (
          <>
            <Field label="Desde" className="min-w-36 flex-1">
              <Input
                type="date"
                defaultValue={from}
                max={to || undefined}
                onChange={(event) => {
                  if (isWholeDate(event.target.value)) apply({ desde: event.target.value });
                }}
              />
            </Field>
            <Field label="Hasta" className="min-w-36 flex-1">
              <Input
                type="date"
                defaultValue={to}
                min={from || undefined}
                onChange={(event) => {
                  if (isWholeDate(event.target.value)) apply({ hasta: event.target.value });
                }}
              />
            </Field>
          </>
        ) : null}
      </div>
      {byDeposit ? <p className="text-sm text-ink-soft">{DEPOSIT_HINT}</p> : null}
    </div>
  );
}
