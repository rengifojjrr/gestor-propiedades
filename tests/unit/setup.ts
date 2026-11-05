/**
 * Pruebas: IndexedDB falsa en memoria (fake-indexeddb) y una base nueva por archivo de prueba.
 */
import 'fake-indexeddb/auto';
import { afterAll, beforeAll } from 'vitest';
import { configureStore } from '@/data';
import { createDexieStore } from '@/data/local/dexieStore';

let store: ReturnType<typeof createDexieStore> | null = null;

beforeAll(() => {
  store = createDexieStore(`test-${Math.random().toString(36).slice(2)}`);
  configureStore(store);
});

afterAll(async () => {
  if (store) {
    store.close();
    await store.db.delete();
  }
});
