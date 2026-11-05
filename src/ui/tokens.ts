/**
 * Colores de los tokens resueltos en tiempo de ejecución (para gráficas, mapa, QR y canvas),
 * leídos de las variables CSS de src/styles/tokens.css. Nunca se escriben colores a mano aquí.
 */
import { useEffect, useState } from 'react';

export type TokenName =
  | 'primary'
  | 'on-primary'
  | 'primary-container'
  | 'on-primary-container'
  | 'surface'
  | 'surface-lowest'
  | 'surface-low'
  | 'surface-container'
  | 'surface-high'
  | 'on-surface'
  | 'on-surface-variant'
  | 'outline'
  | 'outline-variant'
  | 'secondary'
  | 'secondary-container'
  | 'on-secondary-container'
  | 'warning'
  | 'warning-strong'
  | 'warning-container'
  | 'error'
  | 'error-container'
  | 'info-container'
  | 'on-image';

export function tokenValue(name: TokenName): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(`--gp-${name}`).trim();
}

const NAMES: TokenName[] = [
  'primary',
  'on-primary',
  'primary-container',
  'on-primary-container',
  'surface',
  'surface-lowest',
  'surface-low',
  'surface-container',
  'surface-high',
  'on-surface',
  'on-surface-variant',
  'outline',
  'outline-variant',
  'secondary',
  'secondary-container',
  'on-secondary-container',
  'warning',
  'warning-strong',
  'warning-container',
  'error',
  'error-container',
  'info-container',
  'on-image',
];

export type TokenColors = Record<TokenName, string>;

function readAll(): TokenColors {
  return Object.fromEntries(NAMES.map((n) => [n, tokenValue(n)])) as TokenColors;
}

/** Colores resueltos; se actualizan al cambiar entre modo claro y oscuro. */
export function useTokenColors(): TokenColors {
  const [colors, setColors] = useState<TokenColors>(readAll);
  useEffect(() => {
    const update = () => setColors(readAll());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return colors;
}
