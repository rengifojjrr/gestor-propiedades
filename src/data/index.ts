/**
 * Punto único de acceso a los datos. Hoy: Dexie en el navegador.
 * `configureStore` permite cambiar la implementación (pruebas o Supabase).
 */
import { createDexieStore } from './local/dexieStore';
import type { DataStore } from './store';

let current: DataStore | null = null;

export function data(): DataStore {
  if (!current) current = createDexieStore();
  return current;
}

export function configureStore(store: DataStore): void {
  current = store;
}

export type { DataStore, Repo, Snapshot, Tables } from './store';
