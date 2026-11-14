"use client";

import Link from "next/link";
import { useId } from "react";
import { AllocationList } from "@/components/pasarelas/AllocationList";
import { BreakdownCard } from "@/components/pasarelas/BreakdownCard";
import { DepositWindowText } from "@/components/pasarelas/tx/DepositWindow";
import { Alert, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { compute } from "@/lib/pasarelas/breakdown";
import {
  estimateDepositWindow,
  isISODate,
  localInputToInstant,
  nyDate,
  type DateWindow,
} from "@/lib/pasarelas/dates";
import { ZERO } from "@/lib/pasarelas/decimal";
import { cmp, parseMoney } from "@/lib/pasarelas/money";
import { PAY_RULE_TEXT, PayRuleError, resolvePayout, resolveRules, type PayRuleCode } from "@/lib/pasarelas/rules";
import type { Breakdown, FeesPaidBy, ISODate, PayConfig } from "@/lib/pasarelas/types";

/** Lo que el formulario tiene escrito y elegido, tal cual (los textos todavía sin validar). */
export type PreviewInput = {
  companyId: string;
  channelId: string | null;
  gatewayId: string;
  extraIds: string[];
  schemeId: string | null;
  /** La fecha y hora de Nueva York del formulario: `AAAA-MM-DDTHH:mm`. */
  occurredLocal: string;
  currency: string;
  amount: string;
  /** La fecha estimada puesta a mano, o vacía. */
  manualEstimate: string;
  /** Quién paga la comisión: con «comprador», el reparto va sobre lo que queda. */
  feesPaidBy: FeesPaidBy;
  /** Quiénes no pagan comisión en este cobro, si se preguntó; sin pregunta, las marcas del esquema. */
  feeExemptIds?: string[];
};

type Preview =
  | { kind: "incompleto"; text: string }
  | { kind: "falta"; code: PayRuleCode }
  | { kind: "listo"; breakdown: Breakdown; estimated: DateWindow; manual: boolean };

/**
 * El cálculo de la vista previa, con el mismo motor y la misma configuración que usa el servidor al guardar:
 * reglas → desglose → días → fecha estimada (una ventana, «de 3 a 5 días»; la puesta a mano es un solo día). Lo que
 * todavía no se puede calcular lo dice en vez de inventarlo.
 */
function previewOf(cfg: PayConfig, input: PreviewInput): Preview {
  if (input.companyId === "" || input.gatewayId === "") {
    return { kind: "incompleto", text: "Elige la empresa y la pasarela para ver las comisiones." };
  }
  const gross = parseMoney(input.amount);
  if (gross === null || cmp(gross, ZERO) <= 0) {
    return { kind: "incompleto", text: "Escribe el monto para ver las comisiones, el neto y el reparto." };
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    return { kind: "incompleto", text: "Escribe la moneda: tres letras, como USD." };
  }
  let occurredOn: ISODate;
  try {
    occurredOn = nyDate(localInputToInstant(input.occurredLocal));
  } catch {
    return { kind: "incompleto", text: "Elige la fecha y la hora del cobro." };
  }
  const selection = {
    companyId: input.companyId,
    channelId: input.channelId,
    gatewayId: input.gatewayId,
    extraIds: input.extraIds,
    schemeId: input.schemeId,
    occurredOn,
    feeExemptIds: input.feeExemptIds,
  };
  try {
    const rules = resolveRules(cfg, selection);
    const state = { grossOriginal: gross, refunded: ZERO, dispute: null, failed: false, feesPaidBy: input.feesPaidBy };
    const breakdown = compute(rules, state, input.currency);
    if (isISODate(input.manualEstimate)) {
      const day = input.manualEstimate;
      return { kind: "listo", breakdown, estimated: { from: day, to: day }, manual: true };
    }
    const { days, daysMax, dayType } = resolvePayout(cfg, selection, rules.extras);
    const holidays = new Set(cfg.holidays);
    const estimated = estimateDepositWindow({ occurredOn, days, daysMax, dayType, holidays });
    return { kind: "listo", breakdown, estimated, manual: false };
  } catch (error) {
    if (error instanceof PayRuleError) return { kind: "falta", code: error.code };
    throw error;
  }
}

/**
 * A dónde se va a arreglar cada cosa que falta en la configuración. `null`: se arregla aquí mismo (si nadie queda
 * pagando la comisión, desmarcando a alguien en «¿Alguien no paga comisión?»).
 */
function fixFor(code: PayRuleCode, companyId: string): { href: string; label: string } | null {
  switch (code) {
    case "nadie_paga_comision":
      return null;
    case "empresa":
      return { href: "/pasarelas/empresas", label: "Revisar las empresas" };
    case "canal":
      return { href: `/pasarelas/empresas/${companyId}`, label: "Revisar la empresa" };
    case "pasarela":
    case "opcion":
    case "sin_tarifa":
    case "retencion":
      return { href: "/pasarelas/pasarelas", label: "Revisar las pasarelas" };
    case "esquema":
    case "sin_version":
      return { href: "/pasarelas/repartos", label: "Revisar los repartos" };
  }
}

/** La vista previa del cobro: cada comisión, el neto, el reparto y la fecha estimada, al momento. */
export function LivePreview({ cfg, input }: { cfg: PayConfig; input: PreviewInput }) {
  const titleId = useId();
  const preview = previewOf(cfg, input);
  const fix = preview.kind === "falta" ? fixFor(preview.code, input.companyId) : null;

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <p id={titleId} className="text-sm font-semibold tracking-wide text-ink-soft uppercase">
        Vista previa
      </p>

      {preview.kind === "incompleto" ? (
        <p className="rounded-card border border-dashed border-rule-strong px-4 py-6 text-ink-soft">{preview.text}</p>
      ) : null}

      {preview.kind === "falta" ? (
        <Alert tone="warning" title={PAY_RULE_TEXT[preview.code]}>
          {fix === null ? null : (
            <Link href={fix.href} className="inline-flex min-h-11 items-center font-semibold text-ink underline">
              {fix.label}
            </Link>
          )}
        </Alert>
      ) : null}

      {preview.kind === "listo" ? (
        <>
          <BreakdownCard breakdown={preview.breakdown} />
          <Card>
            <CardHeader>
              <CardTitle>Reparto</CardTitle>
            </CardHeader>
            <CardBody>
              <AllocationList breakdown={preview.breakdown} />
            </CardBody>
          </Card>
          <Card>
            <CardBody className="flex items-baseline justify-between gap-3">
              <span>Fecha estimada del depósito</span>
              <span data-testid="fecha-estimada" className="flex flex-col items-end text-right">
                <DepositWindowText window={preview.estimated} className="font-semibold" />
                {preview.manual ? <span className="text-sm text-ink-soft">puesta a mano</span> : null}
              </span>
            </CardBody>
          </Card>
        </>
      ) : null}
    </section>
  );
}
