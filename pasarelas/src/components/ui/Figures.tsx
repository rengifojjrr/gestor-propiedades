import { dec, toMoney } from "@/lib/pasarelas/decimal";
import { formatMoney, formatPct } from "@/lib/pasarelas/money";
import type { Currency, ISODate, Money as MoneyValue, Pct } from "@/lib/pasarelas/types";
import { cn } from "./cn";
import { moneyTone, type MoneyTone } from "./tone";

/*
 * Cifras y fechas: reciben el valor canónico y lo pintan con los formateadores del motor, para que una misma
 * cifra se lea igual en toda la app. Nadie formatea dinero a mano en una pantalla.
 */

const TONES: Record<MoneyTone, string> = {
  negative: "text-danger",
  zero: "text-ink-soft",
  positive: "",
};

export type MoneyProps = {
  /** El monto canónico, como texto: `"90.30"`, `"-3.20"`. */
  value: MoneyValue;
  /** La moneda del monto: `"USD"`. */
  currency: Currency;
  className?: string;
};

/**
 * Un monto, escrito con `formatMoney` (`$1.234,56` · `-$3,20` · `5,00 MXN`): cifras tabulares, sin partirse en
 * dos líneas. Los negativos llevan su signo **y** van en tinta roja (el color nunca es la única señal); el cero,
 * atenuado. El tono sale del mismo monto redondeado que se pinta. Si `value` no es un decimal, lanza `RangeError`:
 * mejor un error que una cifra inventada.
 */
export function Money({ value, currency, className }: MoneyProps) {
  const amount = toMoney(dec(value));
  const tone = moneyTone(amount);
  return (
    <span data-tone={tone} data-currency={currency} className={cn("cifra whitespace-nowrap", TONES[tone], className)}>
      {formatMoney(amount, currency)}
    </span>
  );
}

export type PercentProps = {
  /** El porcentaje canónico, como texto: `"2.9"`. */
  value: Pct;
  className?: string;
};

/** Un porcentaje, escrito con `formatPct` (`2,9 %`) y con cifras tabulares. */
export function Percent({ value, className }: PercentProps) {
  return (
    <span data-value={value} className={cn("cifra whitespace-nowrap", className)}>
      {formatPct(value)}
    </span>
  );
}

/*
 * PROVISIONAL — las fechas. `formatDate` y `formatDateTime` son de `src/lib/pasarelas/dates.ts`, que todavía no
 * está junto al kit. Hasta entonces el texto se puede pasar en `formatted`; sin él se pinta la fecha ISO tal cual.
 * Cuando exista `dates.ts`: importar los dos formateadores, pintar `formatDate(value)` / `formatDateTime(value)` y
 * quitar `formatted`. `Figures.test.ts` falla a propósito ese día hasta que se haga.
 */

export type DateTextProps = {
  /** La fecha de calendario: `"2026-11-13"`. */
  value: ISODate;
  /** Provisional: el texto a pintar (`"vie 13 nov 2026"`). Sin él se pinta `value`. */
  formatted?: string | undefined;
  className?: string;
};

/** Una fecha, como `<time>`: la máquina lee `value`; la persona, el texto. */
export function DateText({ value, formatted, className }: DateTextProps) {
  return (
    <time dateTime={value} className={cn("cifra whitespace-nowrap", className)}>
      {formatted ?? value}
    </time>
  );
}

export type DateTimeTextProps = {
  /** El instante en ISO: `"2026-11-13T15:30:00Z"`. */
  value: string;
  /** Provisional: el texto a pintar, en hora de Nueva York (`"vie 13 nov 2026, 10:30"`). Sin él se pinta `value`. */
  formatted?: string | undefined;
  className?: string;
};

/** Una fecha con hora, como `<time>`. */
export function DateTimeText({ value, formatted, className }: DateTimeTextProps) {
  return (
    <time dateTime={value} className={cn("cifra whitespace-nowrap", className)}>
      {formatted ?? value}
    </time>
  );
}
