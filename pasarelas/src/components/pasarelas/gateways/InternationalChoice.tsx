"use client";

import { Field, Select } from "@/components/ui";
import type { Currency, ExtraCfg } from "@/lib/pasarelas/types";
import { ORIGIN_LABEL, surchargeText, type Origin } from "./international";

const ORIGINS: Origin[] = ["nacional", "internacional"];

/**
 * «¿El pago fue nacional o internacional?», al registrar o editar un cobro de una pasarela que cobra un recargo a
 * los pagos internacionales. «Internacional» le suma ese recargo; la ayuda dice cuánto, en la moneda del cobro.
 * Es un `<select>` del kit: un objetivo de 44 px con las dos respuestas.
 */
export function InternationalChoice({
  gatewayName,
  international,
  currency,
  value,
  onChange,
}: {
  gatewayName: string;
  /** El recargo que se aplicaría. */
  international: Pick<ExtraCfg, "pct" | "fixed">;
  /** La moneda del cobro, para leer el fijo. */
  currency: Currency;
  value: Origin;
  onChange: (origin: Origin) => void;
}) {
  return (
    <Field
      label="¿El pago fue nacional o internacional?"
      hint={`Internacional suma el recargo de ${gatewayName}: ${surchargeText(international, currency)} del bruto.`}
    >
      <Select value={value} onChange={(event) => onChange(event.currentTarget.value as Origin)}>
        {ORIGINS.map((origin) => (
          <option key={origin} value={origin}>
            {ORIGIN_LABEL[origin]}
          </option>
        ))}
      </Select>
    </Field>
  );
}
