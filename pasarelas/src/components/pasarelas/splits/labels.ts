import type { AllocBase, BeneficiaryKind, ISODate } from "@/lib/pasarelas/types";

/* Cómo se nombra en pantalla cada valor de Repartos. */

export const KIND_LABEL: Record<BeneficiaryKind, string> = {
  persona: "Persona",
  empresa: "Empresa",
  cartera: "Cartera",
};

export const BASE_LABEL: Record<AllocBase, string> = {
  neto: "Sobre el neto",
  bruto: "Sobre el bruto",
};

/** La «vigente desde» de la primera versión de un esquema: rige para todos los cobros (como hace la semilla). */
export const SINCE_START: ISODate = "2000-01-01";
