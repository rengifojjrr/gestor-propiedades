"use client";

import { Switch } from "@/components/ui";
import { formatMoney, formatPct, isZero } from "@/lib/pasarelas/money";
import type { Currency, ExtraCfg } from "@/lib/pasarelas/types";

/**
 * Cuándo cae el dinero con una opción que tiene días propios: «cae el mismo día», «cae en 2 días» o, con una
 * ventana, «cae en 1 a 3 días». Sin días propios, nada.
 */
function payoutOf(option: ExtraCfg): string | null {
  const days = option.payoutDaysOverride;
  if (days === null) return null;
  const max = option.payoutDaysOverrideMax;
  const last = max !== null && max > days ? max : days;
  if (last === 0) return "cae el mismo día";
  const unit = last === 1 ? "día" : "días";
  return last === days ? `cae en ${days} ${unit}` : `cae en ${days} a ${last} ${unit}`;
}

/** Lo que cuesta una opción y cuándo cae el dinero con ella: «1,5 % del bruto · cae el mismo día». */
function describe(option: ExtraCfg, currency: Currency): string {
  const cost = [
    isZero(option.pct) ? null : formatPct(option.pct),
    isZero(option.fixed) ? null : formatMoney(option.fixed, currency),
  ]
    .filter(Boolean)
    .join(" + ");
  const base = option.base === "bruto" ? "del bruto" : "de lo que queda después de la comisión";
  return [cost === "" ? "Sin costo" : `${cost} ${base}`, payoutOf(option)].filter(Boolean).join(" · ");
}

export type ExtrasTogglesProps = {
  /** El nombre de la pasarela, para el título del grupo. */
  gatewayName: string;
  /** Las opciones activas de la pasarela, en su orden. */
  options: ExtraCfg[];
  /** Las encendidas. */
  selected: string[];
  /** En qué moneda se leen las cuotas fijas (la del cobro). */
  currency: Currency;
  onChange: (selected: string[]) => void;
};

/** Las opciones de la pasarela elegida, cada una con su interruptor. Sin opciones, no pinta nada. */
export function ExtrasToggles({ gatewayName, options, selected, currency, onChange }: ExtrasTogglesProps) {
  if (options.length === 0) return null;

  function toggle(id: string, on: boolean) {
    // Siempre en el orden de la configuración.
    onChange(options.map((option) => option.id).filter((optionId) => (optionId === id ? on : selected.includes(optionId))));
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-sm font-semibold text-ink">Opciones de {gatewayName}</legend>
      {options.map((option) => (
        <Switch
          key={option.id}
          label={option.name}
          hint={describe(option, currency)}
          checked={selected.includes(option.id)}
          onChange={(event) => toggle(option.id, event.currentTarget.checked)}
        />
      ))}
    </fieldset>
  );
}
