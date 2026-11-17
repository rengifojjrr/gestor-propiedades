import "server-only";
import { ZERO, add, cmp, neg, partyTotals, payoutStatus } from "@/lib/pasarelas";
import type { Currency, ISODate, Money, PartyAdvance, PartyTotal, PayConfig } from "@/lib/pasarelas";
import { SPLIT_MAX } from "@/components/pasarelas/tx/splitText";
import type { Db } from "../dto";
import { listOwed, readPayoutFacts } from "./settlements";
import { txRefs, type TxFilters, type TxRef } from "./transactions";

/**
 * El «Reparto del filtro» de Cobros: lo de cada parte del reparto en TODOS los cobros del filtro (no solo la página),
 * por moneda, y lo que se le debe a una parte para pagarle desde ahí. Las cifras salen de lo que ya existe: el estado
 * de pago de cada cobro (`payoutStatus`) y los totales por parte del PDF (`partyTotals`). Se lee solo lo necesario
 * —el reparto, lo retenido y lo pagado de esos cobros— por tramos, con el cliente del usuario (la RLS manda).
 */

/** El tope de cobros del «Reparto del filtro» (vive con sus textos: la pantalla también lo nombra). */
export { SPLIT_MAX };

/** Lo de cada parte en los cobros del filtro de UNA moneda, y los adelantos (lo retenido a quien no es parte). */
export type CurrencySplit = { currency: Currency; parties: PartyTotal[]; advances: PartyAdvance[] };

/** El reparto del filtro por moneda (en orden de moneda), o cuántos cobros son si pasan de `SPLIT_MAX`. */
export type FilterSplit = { ok: true; currencies: CurrencySplit[] } | { ok: false; count: number };

const GONE_NAME = "Beneficiario que ya no existe";

/**
 * El reparto de esos cobros (los de un filtro de Cobros, fuera de la papelera), por moneda y por parte: le toca,
 * retenido, ya pagado y lo que falta; y los adelantos. Sin los fallidos, como el PDF. Una moneda sin nadie a quien
 * repartir no sale. Los nombres, los de ahora (`cfg`).
 */
export async function filterSplit(supabase: Db, txs: readonly TxRef[], cfg: PayConfig): Promise<FilterSplit> {
  if (txs.length > SPLIT_MAX) return { ok: false, count: txs.length };
  const counted = txs.filter((tx) => tx.status !== "fallido");
  const facts = await readPayoutFacts(
    supabase,
    counted.map((tx) => tx.id),
  );
  const names = new Map(cfg.beneficiaries.map((beneficiary) => [beneficiary.id, beneficiary.name]));
  const nameOf = (id: string) => names.get(id) ?? GONE_NAME;
  const currencies = [...new Set(counted.map((tx) => tx.currency))].sort();
  return {
    ok: true,
    currencies: currencies
      .map((currency): CurrencySplit => {
        const group = counted
          .filter((tx) => tx.currency === currency)
          .map((tx) => {
            const allocations = facts.allocations.get(tx.id) ?? [];
            const retained = facts.retained.get(tx.id) ?? [];
            const paid = facts.paid.get(tx.id) ?? [];
            return {
              status: payoutStatus({ counts: true, allocations, retained, paid }),
              inAllocation: allocations.map((line) => line.beneficiaryId),
              retained,
            };
          });
        return { currency, ...partyTotals(group, nameOf) };
      })
      .filter((split) => split.parties.length > 0 || split.advances.length > 0),
  };
}

/** Lo que se le debe a una parte en los cobros del filtro donde se le debe, para «Pagar…». */
export type FilterOwed =
  | {
      kind: "debe";
      beneficiaryId: string;
      name: string;
      currency: Currency;
      /** Lo que falta en esos cobros: la suma de `items`. */
      owed: Money;
      /** Un cobro por fila, con lo que falta en él (positivo): las partes del pago. */
      items: { transactionId: string; amount: Money }[];
      /** Los cobros del filtro donde se le pagó de más: no se descuentan del pago (cuántos y cuánto, en positivo). */
      overpaid: { count: number; amount: Money } | null;
    }
  /** En total no se le debe nada en esos cobros (o se le pagó de más): no hay nada que pagarle. */
  | { kind: "nada" }
  /** El filtro tiene más de `SPLIT_MAX` cobros. */
  | { kind: "demasiados"; count: number };

/**
 * «Pagar…» a una parte desde el «Reparto del filtro»: lo que se le debe ahora (leído de la base, no de lo que se pintó)
 * en los cobros del filtro de esa moneda donde se le debe, con lo de cada uno. Es lo mismo que «Pagar repartos…» de
 * la lista (`listOwed`), pero solo con los cobros donde le falta algo: los que se le pagaron de más no se descuentan
 * (se dicen aparte). Si en total no le falta nada, `nada`: una parte a la que se le pagó de más no se paga desde aquí.
 */
export async function owedInFilter(
  supabase: Db,
  filters: TxFilters,
  today: ISODate,
  beneficiaryId: string,
  currency: Currency,
): Promise<FilterOwed> {
  const refs = await txRefs(supabase, filters, today);
  if (refs.length > SPLIT_MAX) return { kind: "demasiados", count: refs.length };
  const ids = refs.filter((tx) => tx.currency === currency && tx.status !== "fallido").map((tx) => tx.id);
  const group = (await listOwed(supabase, ids)).find(
    (candidate) => candidate.beneficiaryId === beneficiaryId && candidate.currency === currency,
  );
  if (group === undefined || cmp(group.owed, ZERO) <= 0) return { kind: "nada" };
  const items = group.items.filter((item) => cmp(item.amount, ZERO) > 0);
  const over = group.items.filter((item) => cmp(item.amount, ZERO) < 0);
  return {
    kind: "debe",
    beneficiaryId,
    name: group.name,
    currency,
    owed: add(ZERO, ...items.map((item) => item.amount)),
    items,
    overpaid:
      over.length === 0 ? null : { count: over.length, amount: neg(add(ZERO, ...over.map((item) => item.amount))) },
  };
}
