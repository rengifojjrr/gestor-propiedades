/**
 * Esquemas de reparto: suma de porcentajes y validación de lo que el dueño arma en pantalla.
 * La base hace cumplir lo mismo con un disparador; esto es para avisar antes y en español.
 */
import { D, dec, normPct } from "./decimal";
import type { Pct } from "./types";

export type SchemeIssue =
  | "sin_lineas"
  | "pct_invalido"
  | "suma_mayor_100"
  | "suma_menor_sin_resto"
  | "beneficiario_repetido"
  | "resto_en_lineas";

export const SCHEME_ISSUE_TEXT: Record<SchemeIssue, string> = {
  sin_lineas: "Agrega al menos un beneficiario al esquema.",
  pct_invalido: "Cada porcentaje debe ser mayor que 0, no pasar de 100 y tener hasta 4 decimales.",
  suma_mayor_100: "Los porcentajes suman más de 100 %.",
  suma_menor_sin_resto: "Los porcentajes suman menos de 100 %: completa el 100 % o elige quién recibe el «Resto».",
  beneficiario_repetido: "Un beneficiario no puede estar dos veces en el mismo esquema.",
  resto_en_lineas: "Quien recibe el «Resto» no puede ser además una línea del esquema.",
};

/** Lo que admite la base en una línea: numeric(7,4), mayor que 0 y hasta 100. */
const LINE_PCT = /^\d+(\.\d{1,4})?$/;

function isLinePct(pct: Pct): boolean {
  return LINE_PCT.test(pct) && dec(pct).gt(0) && dec(pct).lte(100);
}

/** Suma de los porcentajes de las líneas, normalizada ("100", "80.5"). */
export function schemeTotal(lines: readonly { pct: Pct }[]): Pct {
  return normPct(lines.reduce((total, line) => total.plus(dec(line.pct)), new D(0)));
}

/** Problemas de un esquema, siempre en el mismo orden. Vacío = se puede guardar. */
export function validateScheme(
  lines: readonly { beneficiaryId: string; pct: Pct }[],
  remainderBeneficiaryId: string | null,
): SchemeIssue[] {
  if (lines.length === 0) return ["sin_lineas"];

  const issues: SchemeIssue[] = [];
  if (!lines.every((line) => isLinePct(line.pct))) {
    // Con un porcentaje inválido la suma no dice nada: no se opina sobre ella.
    issues.push("pct_invalido");
  } else {
    const total = dec(schemeTotal(lines));
    if (total.gt(100)) issues.push("suma_mayor_100");
    if (total.lt(100) && remainderBeneficiaryId === null) issues.push("suma_menor_sin_resto");
  }

  const ids = lines.map((line) => line.beneficiaryId);
  if (new Set(ids).size !== ids.length) issues.push("beneficiario_repetido");
  if (remainderBeneficiaryId !== null && ids.includes(remainderBeneficiaryId)) issues.push("resto_en_lineas");
  return issues;
}
