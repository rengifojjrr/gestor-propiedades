import { cn } from "./cn";
import { moneyTone, type MoneyTone } from "./tone";

/*
 * Componentes de presentación puros: reciben el texto YA formateado (`formatted`) y deciden cómo se pinta.
 * Los formateadores del motor (`formatMoney`, `formatPct`, `formatDate`, `formatDateTime`) se enlazan aparte.
 */

const TONES: Record<MoneyTone, string> = {
  negative: "text-danger",
  zero: "text-ink-soft",
  positive: "",
};

export type MoneyProps = {
  /** El monto canónico (`"90.30"`, `"-3.20"`): de él sale el tono. */
  value: string;
  /** La moneda del monto (`"USD"`). */
  currency: string;
  /** El texto a pintar, con su signo si es negativo: `"$90,30"`, `"-$3,20"`. */
  formatted: string;
  className?: string;
};

/**
 * Un monto: cifras tabulares, sin partirse en dos líneas. Los negativos van en tinta roja además de su
 * signo (el signo viene en `formatted`: el color solo nunca es la única señal) y el cero, atenuado.
 */
export function Money({ value, currency, formatted, className }: MoneyProps) {
  const tone = moneyTone(value);
  return (
    <span data-tone={tone} data-currency={currency} className={cn("cifra whitespace-nowrap", TONES[tone], className)}>
      {formatted}
    </span>
  );
}

export type PercentProps = {
  /** El porcentaje canónico (`"2.9"`). */
  value: string;
  /** El texto a pintar: `"2,9 %"`. */
  formatted: string;
  className?: string;
};

/** Un porcentaje, con cifras tabulares. */
export function Percent({ value, formatted, className }: PercentProps) {
  return (
    <span data-value={value} className={cn("cifra whitespace-nowrap", className)}>
      {formatted}
    </span>
  );
}

export type DateTextProps = {
  /** La fecha de calendario (`"2026-11-13"`). */
  value: string;
  /** El texto a pintar: `"vie 13 nov 2026"`. */
  formatted: string;
  className?: string;
};

/** Una fecha, como `<time>` (la máquina lee `value`; la persona, `formatted`). */
export function DateText({ value, formatted, className }: DateTextProps) {
  return (
    <time dateTime={value} className={cn("cifra whitespace-nowrap", className)}>
      {formatted}
    </time>
  );
}

export type DateTimeTextProps = {
  /** El instante en ISO (`"2026-11-13T15:30:00Z"`). */
  value: string;
  /** El texto a pintar, en hora de Nueva York: `"vie 13 nov 2026, 10:30"`. */
  formatted: string;
  className?: string;
};

/** Una fecha con hora, como `<time>`. */
export function DateTimeText({ value, formatted, className }: DateTimeTextProps) {
  return (
    <time dateTime={value} className={cn("cifra whitespace-nowrap", className)}>
      {formatted}
    </time>
  );
}
