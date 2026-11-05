/**
 * ES/EN para lo que ven huéspedes e inquilinos (el equipo usa la app en español).
 * Cada pantalla define su diccionario: const t = useT(DICT) → t('welcome').
 */
import { useCallback, useEffect, useState } from 'react';
import type { Lang } from '@/domain/types';

const KEY = 'gp.lang';
const listeners = new Set<(l: Lang | null) => void>();

function readLang(): Lang | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' || v === 'es' ? v : null;
  } catch {
    return null;
  }
}

/** Idioma elegido en el botón ES/EN; si no se eligió, el de la ficha de la persona (`fallback`). */
export function useLang(fallback: Lang = 'es'): [Lang, (l: Lang) => void] {
  const [chosen, setLangState] = useState<Lang | null>(readLang);
  const lang = chosen ?? fallback;
  useEffect(() => {
    const l = (next: Lang | null) => setLangState(next);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* sin almacenamiento: queda solo en memoria */
    }
    listeners.forEach((fn) => fn(l));
  }, []);
  return [lang, setLang];
}

export type Dict<K extends string> = Record<Lang, Record<K, string>>;

/** Traductor para un diccionario; admite {variables}. */
export function translate<K extends string>(dict: Dict<K>, lang: Lang, key: K, vars: Record<string, string | number> = {}): string {
  const text = dict[lang][key] ?? dict.es[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** Olvida la elección ES/EN (al cambiar de cuenta, vuelve el idioma de la ficha). */
export function clearLangPreference(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
  listeners.forEach((fn) => fn(null));
}
