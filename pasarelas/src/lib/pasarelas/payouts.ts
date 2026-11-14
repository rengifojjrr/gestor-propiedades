/**
 * Lo que ya se le pagó a cada parte del reparto de un cobro y lo que falta. Las marcas de «pagado» son
 * liquidaciones ligadas a sus cobros (`pay_settlement_items`): el saldo de cada parte sigue saliendo de las
 * liquidaciones, y las marcas no lo pueden contradecir.
 *
 * Lo que se le debe a una parte en un cobro = su reparto − lo que la pasarela ya le retuvo en ese cobro (y le paga
 * directo) − lo ya pagado ligado a ese cobro. Mayor que 0: falta; 0: pagada; menor que 0: se le pagó de más (p. ej.
 * hubo un reembolso después de pagarle) y tiene que devolver. La misma definición está en la base, para el filtro
 * «Reparto pendiente» (`pay_payout_pending`).
 */
import { ZERO, dec, toMoney } from "./decimal";
import { cmp } from "./money";
import type { Currency, Money } from "./types";

/** El estado de una parte: pagada, le falta algo, o se le pagó de más. */
export type PayoutState = "pagado" | "falta" | "de_mas";

/** Un monto de un beneficiario en un cobro: su reparto, lo que le retuvo la pasarela o un pago. */
export type BeneficiaryAmount = { beneficiaryId: string; amount: Money };

/** Lo que se sabe de un cobro para decir lo que falta pagar: lo mismo que guarda la base. */
export type PayoutFacts = {
  /** `false` si el cobro es fallido o está en la papelera: entonces no tiene nada pendiente. */
  counts: boolean;
  /** El reparto (`pay_allocations`). */
  allocations: readonly BeneficiaryAmount[];
  /** Lo que la pasarela le retuvo a cada persona en este cobro (`pay_retention_shares`). */
  retained: readonly BeneficiaryAmount[];
  /** Los pagos ligados a este cobro (`pay_settlement_items`): puede haber varios por beneficiario. */
  paid: readonly BeneficiaryAmount[];
};

/** Una parte del reparto con lo suyo: `paid + owed + retained = allocated`, siempre. */
export type PayoutPart = {
  beneficiaryId: string;
  allocated: Money;
  retained: Money;
  paid: Money;
  /** Lo que se le debe: positivo, falta; cero, pagada; negativo, se le pagó de más. */
  owed: Money;
  state: PayoutState;
};

export type PayoutStatus = {
  /** Las del reparto, en su orden; después, quienes tienen pagos ligados sin estar en él. */
  parts: PayoutPart[];
  /** Cuántas están pagadas («Reparto: 2 de 4 pagados»). */
  paidCount: number;
  /** ¿A alguna le falta algo o se le pagó de más? Es lo que trae el filtro «Reparto pendiente». */
  pending: boolean;
};

/** La suma de los montos de cada beneficiario, en el orden en que aparece cada uno. */
function sumByBeneficiary(lines: readonly BeneficiaryAmount[]): Map<string, Money> {
  const sums = new Map<string, Money>();
  for (const line of lines) {
    sums.set(line.beneficiaryId, toMoney(dec(sums.get(line.beneficiaryId) ?? ZERO).plus(dec(line.amount))));
  }
  return sums;
}

const stateOf = (owed: Money): PayoutState => {
  const sign = cmp(owed, ZERO);
  return sign === 0 ? "pagado" : sign > 0 ? "falta" : "de_mas";
};

/**
 * El estado de pago del reparto de un cobro. `null` si no hay nada que decir: un cobro sin reparto (y sin pagos
 * ligados), o uno fallido o en la papelera, que no tienen nada pendiente.
 *
 * Las partes son quienes están en el reparto y quienes tienen pagos ligados al cobro sin estar en él (se cambió el
 * esquema después de pagarles: se les pagó de más). Quien solo recibe lo retenido sin estar en el reparto no es una
 * parte: lo suyo es un adelanto que ya baja su saldo, no algo pendiente de este cobro.
 */
export function payoutStatus(facts: PayoutFacts): PayoutStatus | null {
  if (!facts.counts) return null;
  const allocated = sumByBeneficiary(facts.allocations);
  const retained = sumByBeneficiary(facts.retained);
  const paid = sumByBeneficiary(facts.paid);
  const ids = [...new Set([...allocated.keys(), ...paid.keys()])];
  if (ids.length === 0) return null;
  const parts = ids.map((beneficiaryId): PayoutPart => {
    const part = {
      allocated: allocated.get(beneficiaryId) ?? ZERO,
      retained: retained.get(beneficiaryId) ?? ZERO,
      paid: paid.get(beneficiaryId) ?? ZERO,
    };
    const owed = toMoney(dec(part.allocated).minus(dec(part.retained)).minus(dec(part.paid)));
    return { beneficiaryId, ...part, owed, state: stateOf(owed) };
  });
  const paidCount = parts.filter((part) => part.state === "pagado").length;
  return { parts, paidCount, pending: paidCount < parts.length };
}

/** Lo que se le debe a una parte en varios cobros de una moneda, con lo de cada cobro. */
export type OwedGroup = {
  beneficiaryId: string;
  currency: Currency;
  /** La suma de `items`: positiva, falta pagarle; negativa, tiene que devolver. Nunca 0. */
  owed: Money;
  /** Un cobro por fila, con lo que se le debe en él (nunca 0): las partes de una liquidación. */
  items: { transactionId: string; amount: Money }[];
};

/**
 * «Pagar repartos…» de varios cobros: lo que se le debe a cada parte en ellos, por moneda (nunca se suman monedas
 * distintas). En orden de moneda y, dentro de cada una, de aparición. Los cobros donde la parte no debe nada no
 * entran, y la parte que en total no debe nada no sale.
 */
export function owedByPart(
  txs: readonly { transactionId: string; currency: Currency; status: PayoutStatus | null }[],
): OwedGroup[] {
  const groups = new Map<string, OwedGroup>();
  for (const tx of txs) {
    for (const part of tx.status?.parts ?? []) {
      if (part.state === "pagado") continue;
      const key = `${tx.currency} ${part.beneficiaryId}`;
      const group = groups.get(key) ?? {
        beneficiaryId: part.beneficiaryId,
        currency: tx.currency,
        owed: ZERO,
        items: [],
      };
      group.items.push({ transactionId: tx.transactionId, amount: part.owed });
      group.owed = toMoney(dec(group.owed).plus(dec(part.owed)));
      groups.set(key, group);
    }
  }
  const currencies = [...new Set([...groups.values()].map((group) => group.currency))].sort();
  return currencies.flatMap((currency) =>
    [...groups.values()].filter((group) => group.currency === currency && cmp(group.owed, ZERO) !== 0),
  );
}

/**
 * ¿Se le puede pagar `amount` a una parte que debe `owed` en un cobro? Con el mismo signo y sin pasarse: hasta lo
 * que falta (un pago parcial es menos) o, si se le pagó de más, hasta lo que tiene que devolver. Nunca 0.
 */
export function fitsOwed(amount: Money, owed: Money): boolean {
  const sign = cmp(owed, ZERO);
  return sign !== 0 && cmp(amount, ZERO) === sign && dec(amount).abs().lte(dec(owed).abs());
}
