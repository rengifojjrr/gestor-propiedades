/** Montos: siempre con su moneda, formateados con Intl.NumberFormat. */
const LOCALE = 'es-US';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const cache = new Map<string, Intl.NumberFormat>();
function formatter(currency: string, digits: number, compact = false): Intl.NumberFormat {
  const key = `${currency}|${digits}|${compact}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: compact ? 0 : digits,
      maximumFractionDigits: compact ? 1 : digits,
      notation: compact ? 'compact' : 'standard',
    });
    cache.set(key, f);
  }
  return f;
}

/** «$1,234.50». Sin decimales si el monto es entero y `whole` es true. */
export function formatMoney(amount: number, currency: string, opts: { whole?: boolean } = {}): string {
  const digits = opts.whole || Number.isInteger(round2(amount)) ? 0 : 2;
  return formatter(currency, digits).format(round2(amount));
}

/** «$12 K» para ejes de gráficas. */
export function formatMoneyCompact(amount: number, currency: string): string {
  return formatter(currency, 0, true).format(amount);
}

export function formatPercent(ratio: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: digits }).format(
    Number.isFinite(ratio) ? ratio : 0,
  );
}

export function formatNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits }).format(n);
}

/** Convierte texto de un campo («1,250.50» o «1250,5») a número; NaN si no es válido. */
export function parseAmount(text: string): number {
  const clean = text.replace(/[^\d.,-]/g, '');
  if (!clean) return Number.NaN;
  const normalized = clean.includes(',') && !clean.includes('.') ? clean.replace(',', '.') : clean.replace(/,/g, '');
  return Number(normalized);
}
