/**
 * Interfaz de la capa de datos. Las pantallas nunca la tocan: solo los servicios (src/services).
 * Hoy hay una implementación local (Dexie/IndexedDB, en src/data/local). Para pasar a Supabase
 * se escribe otra implementación de `DataStore` (ver docs/SUPABASE.md) sin rehacer pantallas.
 */
import type {
  AccessCode,
  AppNotification,
  AuditEntry,
  Block,
  Booking,
  Budget,
  Checklist,
  CleaningTask,
  DocumentRecord,
  ExportedFile,
  FileRecord,
  FxRate,
  Incident,
  Lease,
  LeasePayment,
  MaintenanceOrder,
  Message,
  NotificationRead,
  Person,
  PreventiveSchedule,
  Property,
  Settings,
  Template,
  Thread,
  Transaction,
  User,
  Vendor,
} from '@/domain/types';

export interface Repo<T extends { id: string }> {
  get(id: string): Promise<T | undefined>;
  all(): Promise<T[]>;
  find(predicate: (item: T) => boolean): Promise<T[]>;
  put(item: T): Promise<T>;
  bulkPut(items: T[]): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Auditoría: solo se le agrega. No hay forma de editar ni borrar una entrada. */
export interface AppendOnlyLog<T extends { id: string }> {
  append(entry: T): Promise<void>;
  all(): Promise<T[]>;
}

export interface FileStore {
  put(file: FileRecord): Promise<string>;
  get(id: string): Promise<FileRecord | undefined>;
  remove(id: string): Promise<void>;
  all(): Promise<FileRecord[]>;
}

/** Todas las tablas, como datos planos (para la semilla y para exportar). */
export interface Tables {
  users: User[];
  people: Person[];
  properties: Property[];
  accessCodes: AccessCode[];
  checklists: Checklist[];
  vendors: Vendor[];
  bookings: Booking[];
  blocks: Block[];
  leases: Lease[];
  leasePayments: LeasePayment[];
  cleaningTasks: CleaningTask[];
  maintenanceOrders: MaintenanceOrder[];
  incidents: Incident[];
  preventive: PreventiveSchedule[];
  threads: Thread[];
  messages: Message[];
  templates: Template[];
  transactions: Transaction[];
  fxRates: FxRate[];
  budgets: Budget[];
  documents: DocumentRecord[];
  notifications: AppNotification[];
  notificationReads: NotificationRead[];
  settings: Settings[];
  audit: AuditEntry[];
}

export const TABLE_NAMES = [
  'users',
  'people',
  'properties',
  'accessCodes',
  'checklists',
  'vendors',
  'bookings',
  'blocks',
  'leases',
  'leasePayments',
  'cleaningTasks',
  'maintenanceOrders',
  'incidents',
  'preventive',
  'threads',
  'messages',
  'templates',
  'transactions',
  'fxRates',
  'budgets',
  'documents',
  'notifications',
  'notificationReads',
  'settings',
  'audit',
] as const satisfies readonly (keyof Tables)[];

export type TableName = (typeof TABLE_NAMES)[number];

/** Copia completa del estado de la demo (exportar / importar JSON). */
export interface Snapshot {
  format: 'gestor-propiedades';
  version: 1;
  exportedAt: string;
  tables: Tables;
  files: ExportedFile[];
}

export interface DataStore {
  users: Repo<User>;
  people: Repo<Person>;
  properties: Repo<Property>;
  accessCodes: Repo<AccessCode>;
  checklists: Repo<Checklist>;
  vendors: Repo<Vendor>;
  bookings: Repo<Booking>;
  blocks: Repo<Block>;
  leases: Repo<Lease>;
  leasePayments: Repo<LeasePayment>;
  cleaningTasks: Repo<CleaningTask>;
  maintenanceOrders: Repo<MaintenanceOrder>;
  incidents: Repo<Incident>;
  preventive: Repo<PreventiveSchedule>;
  threads: Repo<Thread>;
  messages: Repo<Message>;
  templates: Repo<Template>;
  transactions: Repo<Transaction>;
  fxRates: Repo<FxRate>;
  budgets: Repo<Budget>;
  documents: Repo<DocumentRecord>;
  notifications: Repo<AppNotification>;
  notificationReads: Repo<NotificationRead>;
  settings: Repo<Settings>;
  audit: AppendOnlyLog<AuditEntry>;
  files: FileStore;
  /** Ejecuta varias escrituras como una sola operación atómica. */
  atomic<R>(fn: () => Promise<R>): Promise<R>;
  /** Borra todo y carga estas tablas (restablecer o importar). */
  replaceAll(tables: Tables, files: FileRecord[]): Promise<void>;
  /** Lee todas las tablas (exportar). */
  dumpAll(): Promise<{ tables: Tables; files: FileRecord[] }>;
  /** Avisa cuando cambia algo (las pantallas se refrescan solas). */
  subscribe(listener: () => void): () => void;
}
