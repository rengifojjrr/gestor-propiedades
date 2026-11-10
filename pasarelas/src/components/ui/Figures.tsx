import { formatDate, formatDateTime } from "@/lib/pasarelas/dates";
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

export type DateTextProps = {
  /** La fecha de calendario: `"2026-11-13"`. */
  value: ISODate;
  className?: string;
};

/**
 * Una fecha de calendario, escrita con `formatDate` (`vie 13 nov 2026`), como `<time>`: la máquina lee `value`;
 * la persona, el texto. Una fecha de calendario no tiene zona: no se corre de día. Si `value` no es una fecha que
 * exista (`2026-02-30`, un instante con hora), lanza `RangeError`: mejor un error que otro día.
 */
export function DateText({ value, className }: DateTextProps) {
  return (
    <time dateTime={value} className={cn("cifra whitespace-nowrap", className)}>
      {formatDate(value)}
    </time>
  );
}

export type DateTimeTextProps = {
  /** El instante en ISO 8601 **con zona**: `"2026-11-13T15:30:00Z"`, o con desfase como lo entrega la base. */
  value: string;
  className?: string;
};

/**
 * Un instante, escrito con `formatDateTime` en hora de Nueva York y 24 horas (`vie 13 nov 2026, 10:30`), como
 * `<time>` con el instante original. Un texto sin zona no es un instante: lanza `RangeError` en vez de adivinarla.
 */
export function DateTimeText({ value, className }: DateTimeTextProps) {
  return (
    <time dateTime={value} className={cn("cifra whitespace-nowrap", className)}>
      {formatDateTime(value)}
    </time>
  );
}
