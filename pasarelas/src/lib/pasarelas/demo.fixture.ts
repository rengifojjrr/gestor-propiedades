/**
 * Configuración de ejemplo, en memoria, para las pruebas del motor: lo mínimo para registrar el cobro E1 del spec.
 * Todo es inventado. Cada llamada devuelve una copia nueva, así cada prueba puede cambiarla a su gusto.
 */
import { usBankHolidays } from "./holidays";
import type { PayConfig } from "./types";

/** Los ids de lo que trae `cfgDemo()`. */
export const DEMO = {
  companyId: "co-escuela",
  channelId: "ch-marketing",
  gatewayId: "gw-stripe",
  feeVersionId: "fv-stripe-1",
  /** La opción «Pago rápido» de Stripe. */
  extraId: "ex-rapido",
  bankAccountId: "ba-principal",
  beneficiaryIds: { a: "ben-a", b: "ben-b", c: "ben-c" },
  schemeId: "sch-socios",
  schemeVersionId: "sv-socios-1",
} as const;

/**
 * «Escuela Demo» cobra por Stripe (2,9 % + 0,30; dos días hábiles; no devuelve la comisión; disputa 15,00) con la
 * opción «Pago rápido» (1,5 % del bruto, cae el mismo día), vende por un canal que cuesta 5 % y reparte el neto
 * 50/30/20 entre los Grupos A, B y C. Feriados bancarios de 2026.
 */
export function cfgDemo(): PayConfig {
  return {
    companies: [
      { id: DEMO.companyId, name: "Escuela Demo", currency: "USD", defaultSchemeId: DEMO.schemeId, active: true },
    ],
    channels: [
      {
        id: DEMO.channelId,
        companyId: DEMO.companyId,
        name: "Escuela de marketing",
        platformFeePct: "5",
        platformFeeFixed: "0.00",
        active: true,
      },
    ],
    gateways: [
      {
        id: DEMO.gatewayId,
        name: "Stripe",
        payoutDays: 2,
        payoutDaysMax: null,
        payoutDayType: "habiles",
        refundsReturnFee: false,
        disputeFee: "15.00",
        active: true,
        feeVersions: [{ id: DEMO.feeVersionId, pct: "2.9", fixed: "0.30", effectiveFrom: "2000-01-01", note: null }],
        extras: [
          {
            id: DEMO.extraId,
            name: "Pago rápido",
            pct: "1.5",
            fixed: "0.00",
            base: "bruto",
            payoutDaysOverride: 0,
            payoutDaysOverrideMax: null,
            defaultOn: true,
            active: true,
            sort: 0,
            kind: "opcion",
          },
        ],
      },
    ],
    companyGateways: [
      {
        id: "cg-escuela-stripe",
        companyId: DEMO.companyId,
        gatewayId: DEMO.gatewayId,
        bankAccountId: DEMO.bankAccountId,
        payoutDaysOverride: null,
        payoutDaysOverrideMax: null,
        defaultExtraIds: null,
        active: true,
      },
    ],
    bankAccounts: [{ id: DEMO.bankAccountId, alias: "Cuenta principal", last4: "4321", currency: "USD", active: true }],
    beneficiaries: [
      { id: DEMO.beneficiaryIds.a, name: "Grupo A", kind: "persona", active: true },
      { id: DEMO.beneficiaryIds.b, name: "Grupo B", kind: "persona", active: true },
      { id: DEMO.beneficiaryIds.c, name: "Grupo C", kind: "persona", active: true },
    ],
    schemes: [
      {
        id: DEMO.schemeId,
        name: "Reparto 50/30/20",
        active: true,
        versions: [
          {
            id: DEMO.schemeVersionId,
            version: 1,
            base: "neto",
            remainderBeneficiaryId: null,
            effectiveFrom: "2000-01-01",
            lines: [
              { beneficiaryId: DEMO.beneficiaryIds.a, pct: "50" },
              { beneficiaryId: DEMO.beneficiaryIds.b, pct: "30" },
              { beneficiaryId: DEMO.beneficiaryIds.c, pct: "20" },
            ],
          },
        ],
      },
    ],
    holidays: usBankHolidays(2026).map((holiday) => holiday.day),
  };
}
