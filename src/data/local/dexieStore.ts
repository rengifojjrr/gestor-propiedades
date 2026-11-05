/** Implementación local de DataStore sobre Dexie (IndexedDB): los datos viven en cada navegador. */
import Dexie, { type Table } from 'dexie';
import type { FileRecord } from '@/domain/types';
import { TABLE_NAMES, type AppendOnlyLog, type DataStore, type FileStore, type Repo, type TableName, type Tables } from '../store';

type Row = { id: string };

class GpDexie extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      users: 'id, role',
      people: 'id, kind',
      properties: 'id',
      accessCodes: 'id, propertyId',
      checklists: 'id, propertyId',
      vendors: 'id',
      bookings: 'id, propertyId, guestId, checkIn, checkOut, status',
      blocks: 'id, propertyId',
      leases: 'id, propertyId, tenantId',
      leasePayments: 'id, leaseId',
      cleaningTasks: 'id, propertyId, assigneeId, date, status, bookingId',
      maintenanceOrders: 'id, propertyId, assigneeUserId, status',
      incidents: 'id, propertyId, status',
      preventive: 'id, propertyId',
      threads: 'id, propertyId, bookingId, leaseId, personId',
      messages: 'id, threadId, at',
      templates: 'id, key',
      transactions: 'id, propertyId, date, type',
      fxRates: 'id, currency, date',
      budgets: 'id, month',
      documents: 'id, propertyId, personId, leaseId, expiresOn',
      notifications: 'id, at',
      notificationReads: 'id, userId',
      settings: 'id',
      audit: 'id, at',
      files: 'id',
    });
  }
}

export const DEFAULT_DB_NAME = 'gestor-propiedades';

export function createDexieStore(name = DEFAULT_DB_NAME): DataStore & { close(): void; db: GpDexie } {
  const db = new GpDexie(name);
  const listeners = new Set<() => void>();
  let pending: ReturnType<typeof setTimeout> | null = null;
  let firstPendingAt = 0;

  // Se avisa fuera de la transacción (setTimeout) para no mezclar lecturas con el contexto de Dexie, y agrupando
  // las escrituras seguidas (40 ms, máximo 200 ms de espera) para no recalcular todas las pantallas en cada una.
  const fire = () => {
    pending = null;
    firstPendingAt = 0;
    listeners.forEach((l) => l());
  };
  const notify = () => {
    const now = Date.now();
    if (!firstPendingAt) firstPendingAt = now;
    if (pending) clearTimeout(pending);
    pending = setTimeout(fire, now - firstPendingAt > 200 ? 0 : 40);
  };

  const table = <T extends Row>(n: string) => db.table(n) as Table<T, string>;

  // Las sobrecargas de db.transaction con muchas tablas hacen que TypeScript se atasque: se tipa a mano.
  type RwRunner = <R>(mode: 'rw', tables: Table[], scope: () => Promise<R>) => Promise<R>;
  const rw = <R,>(scope: () => Promise<R>): Promise<R> => (db.transaction.bind(db) as unknown as RwRunner)('rw', db.tables, scope);

  const repo = <T extends Row>(n: string): Repo<T> => {
    const t = () => table<T>(n);
    return {
      get: (id) => t().get(id),
      all: () => t().toArray(),
      find: (predicate) => t().filter(predicate).toArray(),
      put: async (item) => {
        await t().put(item);
        notify();
        return item;
      },
      bulkPut: async (items) => {
        await t().bulkPut(items);
        notify();
      },
      remove: async (id) => {
        await t().delete(id);
        notify();
      },
    };
  };

  const r = <K extends TableName>(name: K): Repo<Tables[K][number]> => repo<Tables[K][number]>(name);

  const auditLog: AppendOnlyLog<Tables['audit'][number]> = {
    append: async (entry) => {
      await table<Tables['audit'][number]>('audit').add(entry);
      notify();
    },
    all: () => table<Tables['audit'][number]>('audit').orderBy('at').reverse().toArray(),
  };

  const files: FileStore = {
    put: async (file) => {
      await table<FileRecord>('files').put(file);
      notify();
      return file.id;
    },
    get: (id) => table<FileRecord>('files').get(id),
    remove: async (id) => {
      await table<FileRecord>('files').delete(id);
      notify();
    },
    all: () => table<FileRecord>('files').toArray(),
  };

  return {
    db,
    users: r('users'),
    people: r('people'),
    properties: r('properties'),
    accessCodes: r('accessCodes'),
    checklists: r('checklists'),
    vendors: r('vendors'),
    bookings: r('bookings'),
    blocks: r('blocks'),
    leases: r('leases'),
    leasePayments: r('leasePayments'),
    cleaningTasks: r('cleaningTasks'),
    maintenanceOrders: r('maintenanceOrders'),
    incidents: r('incidents'),
    preventive: r('preventive'),
    threads: r('threads'),
    messages: r('messages'),
    templates: r('templates'),
    transactions: r('transactions'),
    fxRates: r('fxRates'),
    budgets: r('budgets'),
    documents: r('documents'),
    notifications: r('notifications'),
    notificationReads: r('notificationReads'),
    settings: r('settings'),
    audit: auditLog,
    files,
    atomic: (fn) => rw(fn),
    replaceAll: async (tables, fileRecords) => {
      await rw(async () => {
        for (const t of db.tables) await t.clear();
        for (const n of TABLE_NAMES) await table<Row>(n).bulkAdd(tables[n] as Row[]);
        if (fileRecords.length) await table<FileRecord>('files').bulkAdd(fileRecords);
      });
      notify();
    },
    dumpAll: async () => {
      const out = {} as Record<string, Row[]>;
      for (const n of TABLE_NAMES) out[n] = await table<Row>(n).toArray();
      return { tables: out as unknown as Tables, files: await table<FileRecord>('files').toArray() };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    touch: () => notify(),
    close: () => db.close(),
  };
}
