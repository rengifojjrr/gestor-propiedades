import { someonePaysFees } from "@/lib/pasarelas/schemes";
import type { FeesPaidBy, ISODate, PayConfig, Pct, SchemeRule } from "@/lib/pasarelas/types";
import { pickVersion } from "@/lib/pasarelas/versions";

/*
 * «¿Alguien no paga comisión?», al registrar y al editar un cobro: cuándo se pregunta, por qué líneas y con qué
 * marcas. Se pregunta solo si la comisión la pagamos nosotros y el esquema reparte el neto (si no, la marca no cambia
 * nada). Lo elegido viaja como `feeExemptIds` y queda en las reglas congeladas de ese cobro, no en el esquema.
 */

/** Una línea del esquema en la pregunta: quién, su porcentaje y si viene marcada. */
export type ExemptLine = { beneficiaryId: string; name: string; pct: Pct; feeExempt: boolean };

/** Las líneas por las que se pregunta y si hay «Resto» (no se marca: paga lo suyo si recibe algo). */
export type ExemptQuestion = { lines: ExemptLine[]; hasRemainder: boolean };

/** Al registrar: la versión del esquema que rige ese día, con las marcas del esquema. `null` si no se pregunta. */
export function exemptQuestion(
  cfg: PayConfig,
  feesPaidBy: FeesPaidBy,
  schemeId: string | null,
  on: ISODate,
): ExemptQuestion | null {
  if (feesPaidBy !== "nosotros" || schemeId === null) return null;
  const version = pickVersion(cfg.schemes.find((scheme) => scheme.id === schemeId)?.versions ?? [], on);
  if (version === null || version.base !== "neto") return null;
  const nameOf = (id: string) => cfg.beneficiaries.find((beneficiary) => beneficiary.id === id)?.name ?? "—";
  return {
    lines: version.lines.map((line) => ({
      beneficiaryId: line.beneficiaryId,
      name: nameOf(line.beneficiaryId),
      pct: line.pct,
      feeExempt: line.feeExempt,
    })),
    hasRemainder: version.remainderBeneficiaryId !== null,
  };
}

/** Al editar, con el esquema que congeló el cobro: sus líneas, con las marcas de ese cobro. `null` si no se pregunta. */
export function frozenExemptQuestion(feesPaidBy: FeesPaidBy, scheme: SchemeRule | null): ExemptQuestion | null {
  if (feesPaidBy !== "nosotros" || scheme === null || scheme.base !== "neto") return null;
  return {
    lines: scheme.lines.map(({ beneficiaryId, name, pct, feeExempt }) => ({ beneficiaryId, name, pct, feeExempt })),
    hasRemainder: scheme.remainder !== null,
  };
}

/**
 * Quiénes quedan marcados, en el orden de las líneas: lo que eligió la persona (`chosen`; solo cuentan las líneas) o,
 * si no eligió nada (`null`), las marcas que trae cada línea.
 */
export function exemptIdsOf(question: ExemptQuestion, chosen: readonly string[] | null): string[] {
  return question.lines
    .filter((line) => (chosen === null ? line.feeExempt : chosen.includes(line.beneficiaryId)))
    .map((line) => line.beneficiaryId);
}

/** ¿Queda alguien que pague la comisión con esas marcas? (La misma regla que el reparto.) */
export function someonePays(question: ExemptQuestion, ids: readonly string[]): boolean {
  const lines = question.lines.map((line) => ({ pct: line.pct, feeExempt: ids.includes(line.beneficiaryId) }));
  return someonePaysFees(lines, question.hasRemainder);
}
