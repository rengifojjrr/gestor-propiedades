import { ChevronDown } from "lucide-react";
import { useId } from "react";
import { Money } from "@/components/ui";
import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp } from "@/lib/pasarelas/money";
import type { PartyTotal, PayoutPart } from "@/lib/pasarelas/payouts";
import type { Currency, ISODate } from "@/lib/pasarelas/types";
import type { CurrencySplit, FilterSplit } from "@/server/pasarelas/queries/filter-split";
import { PayoutBadge } from "./PayoutState";
import { splitLine, tooManyForSplitText } from "./splitText";
import { TxSplitPay } from "./TxSplitPay";

export type TxSplitProps = {
  /** `filterSplit` sobre TODOS los cobros del filtro (no solo la página). */
  split: FilterSplit;
  /** La URL de la lista (sus parámetros), para «Pagar…». */
  query: string;
  /** Hoy en Nueva York: la fecha que propone «Pagar…». */
  today: ISODate;
};

/** El título de cada moneda: recibe el foco tras pagar (el botón «Pagar…» puede irse con la lista nueva). */
const headingId = (currency: Currency) => `reparto-del-filtro-${currency}`;

/** El estado de pago de una parte en los cobros del filtro, con las palabras del detalle (`PayoutBadge`). */
function asPart(party: PartyTotal): PayoutPart {
  const sign = cmp(party.owed, ZERO);
  return { ...party, state: sign === 0 ? "pagado" : sign > 0 ? "falta" : "de_mas" };
}

/** Una cifra chica con su nombre: «Le toca $630,75». */
function Figure({ label, value, currency }: { label: string; value: PartyTotal["allocated"]; currency: Currency }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="cifra">
        <Money value={value} currency={currency} />
      </dd>
    </div>
  );
}

/** Lo de cada parte en una moneda: lo que falta (a la vista), lo que le toca, lo retenido y lo pagado, y «Pagar…». */
function CurrencyBlock({ split, query, today }: { split: CurrencySplit; query: string; today: ISODate }) {
  const { currency, parties, advances } = split;
  return (
    <section aria-labelledby={headingId(currency)} className="flex flex-col gap-3">
      <h3 id={headingId(currency)} tabIndex={-1} className="font-semibold">
        {currency} · {splitLine(parties, currency)}
      </h3>
      {parties.length === 0 ? null : (
        <ul
          aria-label={`Partes en ${currency}`}
          className="flex flex-col divide-y divide-rule rounded-card border border-rule"
        >
          {parties.map((party) => (
            <li key={party.beneficiaryId} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 font-semibold break-words">{party.name}</span>
                  <PayoutBadge part={asPart(party)} currency={currency} />
                </div>
                <dl className="grid max-w-md grid-cols-3 gap-x-3 text-sm">
                  <Figure label="Le toca" value={party.allocated} currency={currency} />
                  <Figure label="Retenido" value={party.retained} currency={currency} />
                  <Figure label="Pagado" value={party.paid} currency={currency} />
                </dl>
              </div>
              {cmp(party.owed, ZERO) > 0 ? (
                <div className="flex justify-end md:shrink-0">
                  <TxSplitPay
                    query={query}
                    beneficiaryId={party.beneficiaryId}
                    name={party.name}
                    currency={currency}
                    today={today}
                    focusAfterId={headingId(currency)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {advances.map((advance) => (
        <p key={advance.beneficiaryId} className="text-sm">
          {advance.name} recibió <Money value={advance.amount} currency={currency} /> de la retención sin estar en el
          reparto de estos cobros: es un adelanto y su saldo baja.
        </p>
      ))}
    </section>
  );
}

/**
 * «Reparto del filtro»: lo de cada parte en TODOS los cobros del filtro, sin los fallidos ni la papelera, igual que el
 * PDF. Un bloque por moneda (nunca se suman monedas): lo que le toca, lo retenido (la pasarela se lo pagó directo: ya
 * lo recibió), lo ya pagado y lo que falta, con «Pagar…» a quien le falta algo. Va plegado, con una línea por moneda
 * («Falta pagar $X a N partes» o «Todo pagado»). Con más cobros de los que suma, lo dice y no pinta ninguna cifra. Sin
 * nadie a quien repartir, no pinta nada.
 */
export function TxSplit({ split, query, today }: TxSplitProps) {
  const titleId = useId();
  if (!split.ok) {
    return (
      <section
        aria-labelledby={titleId}
        className="flex flex-col gap-1 rounded-card border border-rule bg-surface px-4 py-3"
      >
        <h2 id={titleId} className="font-semibold">
          Reparto del filtro
        </h2>
        <p className="text-sm text-ink-soft">{tooManyForSplitText(split.count)}</p>
      </section>
    );
  }
  if (split.currencies.length === 0) return null;
  return (
    <section aria-labelledby={titleId}>
      <details className="group rounded-card border border-rule bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 rounded-card px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-col gap-1">
            <span id={titleId} className="font-semibold">
              Reparto del filtro
            </span>
            <span className="flex flex-col text-sm text-ink-soft">
              {split.currencies.map(({ currency, parties }) => (
                <span key={currency}>
                  {currency}: {splitLine(parties, currency)}
                </span>
              ))}
            </span>
          </span>
          <ChevronDown
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-ink-soft transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="flex flex-col gap-5 border-t border-rule p-4">
          <p className="text-sm text-ink-soft">
            Todos los cobros del filtro, sin los fallidos. «Retenido» es lo que la pasarela le pagó directo: ya lo
            recibió y no cuenta en lo que falta.
          </p>
          {split.currencies.map((item) => (
            <CurrencyBlock key={item.currency} split={item} query={query} today={today} />
          ))}
        </div>
      </details>
    </section>
  );
}
