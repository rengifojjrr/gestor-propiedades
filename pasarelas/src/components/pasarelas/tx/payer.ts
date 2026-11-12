import type { FeesPaidBy } from "@/lib/pasarelas/types";

/** Cómo se dice quién pagó la comisión: en la pregunta al registrar y al editar, en el detalle y en el CSV. */
export const FEES_PAID_BY_LABEL: Record<FeesPaidBy, string> = { nosotros: "Nosotros", comprador: "El comprador" };
