/**
 * useLive: corre una consulta de los servicios y la vuelve a correr cuando cambian los datos.
 * Las pantallas lo usan así: `const rows = useLive(() => svc.bookings.list(actor), [actor])`.
 * No depende de Dexie: escucha `data().subscribe`, que cualquier implementación debe ofrecer.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type DependencyList } from 'react';
import { data } from './index';

let version = 0;
const listeners = new Set<() => void>();
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  data().subscribe(() => {
    version += 1;
    listeners.forEach((l) => l());
  });
}

function subscribe(listener: () => void) {
  wire();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

/** Fuerza que todas las consultas vivas se vuelvan a correr (por ejemplo, al cambiar de rol). */
export function refreshAll(): void {
  version += 1;
  listeners.forEach((l) => l());
}

export interface LiveResult<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
}

export function useLiveResult<T>(query: () => Promise<T>, deps: DependencyList): LiveResult<T> {
  const v = useSyncExternalStore(subscribe, getVersion, getVersion);
  const [state, setState] = useState<LiveResult<T>>({ data: undefined, error: undefined, loading: true });
  const queryRef = useRef(query);
  queryRef.current = query;
  useEffect(() => {
    let cancelled = false;
    queryRef
      .current()
      .then((result) => {
        if (!cancelled) setState({ data: result, error: undefined, loading: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        if (import.meta.env.DEV) console.warn('[useLive]', error);
        setState((s) => ({ data: s.data, error, loading: false }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ...deps]);
  return state;
}

/** Igual que useLiveResult, pero devuelve solo los datos (undefined mientras carga o si falla). */
export function useLive<T>(query: () => Promise<T>, deps: DependencyList): T | undefined {
  return useLiveResult(query, deps).data;
}
