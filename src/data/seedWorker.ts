/**
 * Carga la semilla en un Worker: genera los ~2.000 registros y los escribe en IndexedDB fuera del hilo
 * principal, para que la primera visita no congele la pantalla. Si no hay Worker, se hace en el hilo principal.
 */
import { DateTime } from 'luxon';
import { createDexieStore } from './local/dexieStore';
import { buildSeed } from './seed';

interface SeedRequest {
  dbName: string;
  nowIso: string;
}

self.onmessage = async (e: MessageEvent<SeedRequest>) => {
  const store = createDexieStore(e.data.dbName);
  try {
    await store.replaceAll(buildSeed(DateTime.fromISO(e.data.nowIso, { setZone: true })), []);
    self.postMessage({ ok: true });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    store.close();
  }
};
