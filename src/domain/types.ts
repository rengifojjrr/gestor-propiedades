/**
 * Modelo de datos (ver docs/MODELO.md). Los esquemas zod validan todo lo que entra
 * (formularios, importación de JSON y de .ics); los tipos TypeScript salen de ellos.
 * Los montos van en unidades mayores (ej. dólares) redondeados a 2 decimales.
 * Las fechas de calendario van como 'AAAA-MM-DD' en la zona horaria de cada propiedad.
 */
import { z } from 'zod';

// ───────────────────────── Básicos ─────────────────────────
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa una fecha AAAA-MM-DD');
export const isoDateTime = z.string().min(10);
export const timeHM = z.string().regex(/^\d{2}:\d{2}$/, 'Usa una hora HH:MM');
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Moneda de 3 letras (ej. USD)');
export const money = z.number().finite();
export const monthKey = z.string().regex(/^\d{4}-\d{2}$/, 'Usa un mes AAAA-MM');
const id = z.string().min(1);
const bilingual = z.object({ es: z.string(), en: z.string() });
export type Bilingual = z.infer<typeof bilingual>;

export const LANGS = ['es', 'en'] as const;
export const LangSchema = z.enum(LANGS);
export type Lang = z.infer<typeof LangSchema>;

// ───────────────────────── Personas y equipo ─────────────────────────
export const ROLES = ['owner', 'admin', 'support', 'cleaner', 'technician', 'guest', 'tenant', 'accountant'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;
export const TEAM_ROLES: Role[] = ['owner', 'admin', 'support', 'cleaner', 'technician', 'accountant'];

export const UserSchema = z.object({
  id,
  name: z.string().min(2),
  role: RoleSchema,
  title: z.string().optional(),
  email: z.string(),
  phone: z.string().optional(),
  /** Propiedades asignadas: 'all' o una lista de ids. */
  propertyIds: z.union([z.literal('all'), z.array(z.string())]),
  /** Huésped o inquilino: su ficha en `people`. */
  personId: z.string().optional(),
  /** Técnico: el proveedor al que pertenece. */
  vendorId: z.string().optional(),
  active: z.boolean(),
  createdAt: isoDateTime,
});
export type User = z.infer<typeof UserSchema>;

export const PersonSchema = z.object({
  id,
  kind: z.enum(['guest', 'tenant']),
  name: z.string().min(2),
  email: z.string().optional(),
  phone: z.string().optional(),
  language: LangSchema,
  country: z.string().optional(),
  notes: z.string(),
  /** «No volver a alquilar». */
  doNotRent: z.boolean(),
  /** Solo la marca: nunca se guarda la imagen del documento de identidad. */
  idVerified: z.boolean(),
  tags: z.array(z.string()),
  createdAt: isoDateTime,
});
export type Person = z.infer<typeof PersonSchema>;

// ───────────────────────── Propiedades ─────────────────────────
export const PROPERTY_TYPES = ['house', 'apartment', 'villa', 'loft', 'studio'] as const;
export const RENTAL_MODES = ['nightly', 'monthly', 'mixed'] as const;
export const STATUS_OVERRIDES = ['none', 'maintenance', 'blocked'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export type RentalMode = (typeof RENTAL_MODES)[number];
export type StatusOverride = (typeof STATUS_OVERRIDES)[number];
/** Estado visible: el manual (mantenimiento/bloqueada) manda; si no, sale de reservas y contratos. */
export type PropertyStatus = 'occupied' | 'vacant' | 'maintenance' | 'blocked';

export const PhotoSchema = z.object({
  id,
  /** Ruta de la ilustración de ejemplo (relativa a la base de la app) o vacío si es una foto subida. */
  src: z.string(),
  fileId: z.string().optional(),
  caption: z.string().optional(),
});
export type Photo = z.infer<typeof PhotoSchema>;

export const OwnerPrivateSchema = z.object({
  purchasePrice: money.optional(),
  purchaseDate: isoDate.optional(),
  estimatedValue: money.optional(),
  mortgage: z.object({ lender: z.string(), monthlyPayment: money, balance: money }).optional(),
  insurance: z
    .object({ provider: z.string(), policyNumber: z.string(), annualPremium: money, expiresOn: isoDate })
    .optional(),
  hoaMonthly: money.optional(),
  propertyTaxAnnual: money.optional(),
});
export type OwnerPrivate = z.infer<typeof OwnerPrivateSchema>;

export const PropertySchema = z.object({
  id,
  name: z.string().min(2),
  type: z.enum(PROPERTY_TYPES),
  country: z.string(),
  region: z.string(),
  city: z.string(),
  neighborhood: z.string(),
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
  timezone: z.string(),
  currency: currencyCode,
  photos: z.array(PhotoSchema),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().min(0),
  capacity: z.number().int().min(1),
  sizeM2: z.number().min(0),
  amenities: z.array(z.string()),
  rentalMode: z.enum(RENTAL_MODES),
  statusOverride: z.enum(STATUS_OVERRIDES),
  license: z.object({ number: z.string(), expiresOn: isoDate }).optional(),
  houseManual: bilingual,
  checkInInstructions: bilingual,
  directions: bilingual,
  checkInTime: timeHM,
  checkOutTime: timeHM,
  nightlyRate: money,
  cleaningFee: money,
  /** Pago a la persona de limpieza por cada tarea de salida. */
  cleaningPay: money,
  monthlyRent: money.optional(),
  /** Impuesto de hospedaje (0.12 = 12 %). */
  taxRate: z.number().min(0).max(1),
  defaultCleanerId: z.string().optional(),
  vendorIds: z.array(z.string()),
  /** Solo el propietario (salvo que lo comparta en Ajustes). */
  ownerPrivate: OwnerPrivateSchema,
  notes: z.string(),
  archived: z.boolean(),
  createdAt: isoDateTime,
});
export type Property = z.infer<typeof PropertySchema>;

export const ACCESS_KINDS = ['door', 'lockbox', 'wifi', 'gate', 'alarm'] as const;
export const AccessCodeSchema = z.object({
  id,
  propertyId: id,
  kind: z.enum(ACCESS_KINDS),
  /** Para el wifi, el nombre de la red. */
  label: z.string(),
  /** El código o la clave (inventados en la demo). */
  value: z.string(),
});
export type AccessCode = z.infer<typeof AccessCodeSchema>;
/** Lo que ven las pantallas: el valor solo viene si se puede mostrar. */
export interface AccessCodeView {
  id: string;
  kind: AccessCode['kind'];
  label: string;
  value: string | null;
  masked: string;
}

export const ChecklistSchema = z.object({
  id,
  propertyId: id,
  rooms: z.array(z.object({ name: z.string(), items: z.array(z.string()) })),
});
export type Checklist = z.infer<typeof ChecklistSchema>;

export const MAINTENANCE_CATEGORIES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliances',
  'pests',
  'pool',
  'garden',
  'locks',
  'general',
] as const;
export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];

export const VendorSchema = z.object({
  id,
  name: z.string().min(2),
  specialties: z.array(z.enum(MAINTENANCE_CATEGORIES)),
  contactName: z.string(),
  phone: z.string(),
  email: z.string(),
  rating: z.number().min(0).max(5),
  notes: z.string(),
  active: z.boolean(),
});
export type Vendor = z.infer<typeof VendorSchema>;

// ───────────────────────── Alquiler ─────────────────────────
export const CHANNELS = ['airbnb', 'booking', 'vrbo', 'direct'] as const;
export type Channel = (typeof CHANNELS)[number];
export const BOOKING_STATUSES = ['confirmed', 'in_progress', 'completed', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const noteSchema = z.object({ id, at: isoDateTime, by: z.string(), byName: z.string(), text: z.string() });
export type Note = z.infer<typeof noteSchema>;

export const BookingSchema = z.object({
  id,
  code: z.string(),
  propertyId: id,
  guestId: id,
  channel: z.enum(CHANNELS),
  checkIn: isoDate,
  checkOut: isoDate,
  guests: z.number().int().min(1),
  nightlyRate: money,
  cleaningFee: money,
  commission: money,
  taxes: money,
  /** Airbnb y Vrbo cobran y pagan el impuesto ellos mismos. */
  taxRemittedByChannel: z.boolean(),
  netPayout: money,
  currency: currencyCode,
  status: z.enum(BOOKING_STATUSES),
  statusHistory: z.array(z.object({ status: z.enum(BOOKING_STATUSES), at: isoDateTime, by: z.string() })),
  notes: z.array(noteSchema),
  source: z.enum(['manual', 'ics', 'seed']),
  externalUid: z.string().optional(),
  /** Reservas importadas de un .ics: faltan huésped y montos. */
  needsDetails: z.boolean(),
  createdAt: isoDateTime,
});
export type Booking = z.infer<typeof BookingSchema>;

export const BlockSchema = z.object({
  id,
  propertyId: id,
  start: isoDate,
  /** Exclusiva: el día `end` ya está libre. */
  end: isoDate,
  reason: z.enum(['owner', 'maintenance', 'other']),
  note: z.string(),
});
export type Block = z.infer<typeof BlockSchema>;

export const PAYMENT_METHODS = ['transfer', 'cash', 'card', 'check', 'zelle', 'channel', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const LeaseSchema = z.object({
  id,
  code: z.string(),
  propertyId: id,
  tenantId: id,
  start: isoDate,
  /** Último día del contrato (inclusivo). */
  end: isoDate,
  rent: money,
  currency: currencyCode,
  dueDay: z.number().int().min(1).max(28),
  deposit: money,
  lateFee: z.object({ kind: z.enum(['percent', 'fixed']), value: z.number().min(0), graceDays: z.number().int().min(0) }),
  status: z.enum(['active', 'ended', 'terminated']),
  notes: z.string(),
  createdAt: isoDateTime,
});
export type Lease = z.infer<typeof LeaseSchema>;

export const LeasePaymentSchema = z.object({
  id,
  leaseId: id,
  /** Mes que paga (AAAA-MM). */
  period: monthKey,
  amount: money,
  lateFee: money,
  paidOn: isoDate,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string(),
  recordedBy: z.string(),
  createdAt: isoDateTime,
});
export type LeasePayment = z.infer<typeof LeasePaymentSchema>;

// ───────────────────────── Operación ─────────────────────────
export const CLEANING_TYPES = ['checkout', 'deep', 'inspection'] as const;
export type CleaningType = (typeof CLEANING_TYPES)[number];
export const CLEANING_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const;
export type CleaningStatus = (typeof CLEANING_STATUSES)[number];

export const TaskPhotoSchema = z.object({ fileId: id, phase: z.enum(['before', 'after']), at: isoDateTime });
export type TaskPhoto = z.infer<typeof TaskPhotoSchema>;

export const CleaningTaskSchema = z.object({
  id,
  propertyId: id,
  bookingId: z.string().optional(),
  type: z.enum(CLEANING_TYPES),
  status: z.enum(CLEANING_STATUSES),
  assigneeId: z.string().optional(),
  date: isoDate,
  time: timeHM,
  priority: z.enum(['high', 'normal']),
  fee: money,
  currency: currencyCode,
  items: z.array(z.object({ room: z.string(), label: z.string(), done: z.boolean() })),
  photos: z.array(TaskPhotoSchema),
  supplies: z.array(z.object({ id, item: z.string(), at: isoDateTime })),
  incidentIds: z.array(z.string()),
  notes: z.string(),
  /** Del huésped solo se guarda lo que la limpieza puede ver. */
  guestName: z.string().optional(),
  nextCheckIn: z.object({ date: isoDate, time: timeHM }).optional(),
  startedAt: isoDateTime.optional(),
  completedAt: isoDateTime.optional(),
  expenseId: z.string().optional(),
  createdAt: isoDateTime,
  createdBy: z.string(),
});
export type CleaningTask = z.infer<typeof CleaningTaskSchema>;

export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const ORDER_STATUSES = ['open', 'scheduled', 'in_progress', 'resolved', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const APPROVAL_STATUSES = ['not_required', 'pending', 'approved', 'rejected'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const MaintenanceOrderSchema = z.object({
  id,
  code: z.string(),
  propertyId: id,
  incidentId: z.string().optional(),
  title: z.string().min(2),
  description: z.string(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  priority: z.enum(PRIORITIES),
  status: z.enum(ORDER_STATUSES),
  assigneeUserId: z.string().optional(),
  vendorId: z.string().optional(),
  scheduledDate: isoDate.optional(),
  estimate: money.optional(),
  actualCost: money.optional(),
  currency: currencyCode,
  materials: z.array(z.object({ name: z.string(), qty: z.number(), cost: money })),
  photos: z.array(z.object({ fileId: id, phase: z.enum(['report', 'resolved']), at: isoDateTime })),
  approval: z.object({
    status: z.enum(APPROVAL_STATUSES),
    amount: money.optional(),
    decidedBy: z.string().optional(),
    decidedAt: isoDateTime.optional(),
    note: z.string().optional(),
  }),
  preventiveId: z.string().optional(),
  expenseId: z.string().optional(),
  resolutionNote: z.string().optional(),
  resolvedAt: isoDateTime.optional(),
  createdAt: isoDateTime,
  createdBy: z.string(),
});
export type MaintenanceOrder = z.infer<typeof MaintenanceOrderSchema>;

export const IncidentSchema = z.object({
  id,
  propertyId: id,
  title: z.string().min(2),
  description: z.string(),
  category: z.enum(MAINTENANCE_CATEGORIES),
  severity: z.enum(PRIORITIES),
  source: z.enum(['cleaning', 'guest', 'tenant', 'team']),
  /** Daño o faltante (reportes de limpieza). */
  kind: z.enum(['damage', 'missing', 'problem']),
  reportedBy: z.string(),
  reporterName: z.string(),
  cleaningTaskId: z.string().optional(),
  bookingId: z.string().optional(),
  leaseId: z.string().optional(),
  photos: z.array(z.string()),
  status: z.enum(['open', 'in_progress', 'resolved', 'dismissed']),
  maintenanceOrderId: z.string().optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Incident = z.infer<typeof IncidentSchema>;

export const PreventiveSchema = z.object({
  id,
  propertyId: id,
  title: z.string().min(2),
  category: z.enum(MAINTENANCE_CATEGORIES),
  every: z.object({ unit: z.enum(['week', 'month']), count: z.number().int().min(1) }),
  nextDue: isoDate,
  vendorId: z.string().optional(),
  assigneeUserId: z.string().optional(),
  estimate: money.optional(),
  active: z.boolean(),
  lastCreatedFor: isoDate.optional(),
});
export type PreventiveSchedule = z.infer<typeof PreventiveSchema>;

// ───────────────────────── Mensajes ─────────────────────────
export const ThreadSchema = z.object({
  id,
  kind: z.enum(['booking', 'lease', 'general']),
  propertyId: id,
  bookingId: z.string().optional(),
  leaseId: z.string().optional(),
  personId: id,
  subject: z.string(),
  lastMessageAt: isoDateTime,
  lastMessagePreview: z.string(),
  unreadTeam: z.number().int().min(0),
  unreadPerson: z.number().int().min(0),
  createdAt: isoDateTime,
});
export type Thread = z.infer<typeof ThreadSchema>;

export const MessageSchema = z.object({
  id,
  threadId: id,
  at: isoDateTime,
  author: z.object({
    kind: z.enum(['team', 'person', 'system']),
    userId: z.string().optional(),
    personId: z.string().optional(),
    name: z.string(),
  }),
  body: z.string().min(1),
  templateKey: z.string().optional(),
  broadcastId: z.string().optional(),
  attachments: z.array(z.string()),
});
export type Message = z.infer<typeof MessageSchema>;

export const TemplateSchema = z.object({
  id,
  key: z.string().min(2),
  name: z.string().min(2),
  body: bilingual,
  builtIn: z.boolean(),
});
export type Template = z.infer<typeof TemplateSchema>;

// ───────────────────────── Dinero ─────────────────────────
export const INCOME_CATEGORIES = ['booking', 'rent', 'late_fee', 'other_income'] as const;
export const EXPENSE_CATEGORIES = [
  'cleaning',
  'maintenance',
  'utilities',
  'lodging_tax',
  'insurance',
  'hoa',
  'mortgage',
  'commissions',
  'management',
  'property_tax',
  'supplies',
  'other_expense',
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const TransactionSchema = z.object({
  id,
  /** Sin propiedad = gasto o ingreso del portafolio (en moneda base). */
  propertyId: z.string().optional(),
  type: z.enum(['income', 'expense']),
  category: z.string().min(2),
  amount: money.min(0),
  currency: currencyCode,
  /** Monto convertido a la moneda base con la tasa manual vigente en `date`. */
  amountBase: money,
  fxRate: z.number().positive(),
  date: isoDate,
  description: z.string(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().optional(),
  status: z.enum(['posted', 'pending_approval', 'void']),
  source: z.object({
    kind: z.enum(['booking', 'lease_payment', 'cleaning', 'maintenance', 'manual', 'recurring']),
    id: z.string().optional(),
  }),
  createdBy: z.string(),
  createdAt: isoDateTime,
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const FxRateSchema = z.object({
  id,
  currency: currencyCode,
  /** Unidades de moneda base por 1 unidad de `currency`. */
  rate: z.number().positive(),
  date: isoDate,
});
export type FxRate = z.infer<typeof FxRateSchema>;

export const BudgetSchema = z.object({
  id,
  month: monthKey,
  propertyId: z.string().optional(),
  /** Presupuesto de gastos en moneda base. */
  amount: money,
});
export type Budget = z.infer<typeof BudgetSchema>;

// ───────────────────────── Documentos ─────────────────────────
export const DOC_CATEGORIES = ['contract', 'insurance', 'deed', 'license', 'invoice', 'inspection', 'other'] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];
/** Quién puede verlo además del propietario. */
export const DOC_VISIBILITY = ['owner', 'team', 'finance', 'tenant', 'guest'] as const;
export type DocVisibility = (typeof DOC_VISIBILITY)[number];

export const DocumentSchema = z.object({
  id,
  name: z.string().min(2),
  category: z.enum(DOC_CATEGORIES),
  propertyId: z.string().optional(),
  personId: z.string().optional(),
  leaseId: z.string().optional(),
  tags: z.array(z.string()),
  expiresOn: isoDate.optional(),
  fileId: z.string().optional(),
  mime: z.string().optional(),
  size: z.number().optional(),
  visibility: z.enum(DOC_VISIBILITY),
  uploadedBy: z.string(),
  createdAt: isoDateTime,
  /** Documento de ejemplo sin archivo real. */
  sample: z.boolean(),
});
export type DocumentRecord = z.infer<typeof DocumentSchema>;

// ───────────────────────── Sistema ─────────────────────────
export const NOTIFICATION_KINDS = [
  'urgent',
  'payment',
  'document',
  'cleaning',
  'booking',
  'approval',
  'message',
  'incident',
  'renewal',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NotificationSchema = z.object({
  id,
  at: isoDateTime,
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  link: z.string().optional(),
  propertyId: z.string().optional(),
  roles: z.array(RoleSchema),
  userIds: z.array(z.string()).optional(),
});
export type AppNotification = z.infer<typeof NotificationSchema>;

export const NotificationReadSchema = z.object({ id, userId: id, notificationId: id, at: isoDateTime });
export type NotificationRead = z.infer<typeof NotificationReadSchema>;

export const CustomCategorySchema = z.object({ key: z.string().min(2), label: z.string().min(2) });

export const SettingsSchema = z.object({
  id: z.literal('app'),
  companyName: z.string().min(2),
  logoFileId: z.string().optional(),
  baseCurrency: currencyCode,
  /** Gastos por encima de este monto (moneda base) necesitan la aprobación del propietario. */
  approvalThreshold: money.min(0),
  /** El propietario comparte con Administración y Contabilidad los datos privados de las propiedades. */
  shareOwnerFinancials: z.boolean(),
  guestLanguages: z.array(LangSchema),
  customExpenseCategories: z.array(CustomCategorySchema),
  customMaintenanceNotes: z.string(),
  theme: z.enum(['system', 'light', 'dark']),
  seedDate: isoDate,
  seededAt: isoDateTime,
});
export type Settings = z.infer<typeof SettingsSchema>;

export const AuditEntrySchema = z.object({
  id,
  at: isoDateTime,
  actorId: z.string(),
  actorName: z.string(),
  actorRole: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().optional(),
  summary: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

/** Archivo guardado en el navegador (fotos y documentos). */
export interface FileRecord {
  id: string;
  blob: Blob;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}

export const ExportedFileSchema = z.object({
  id,
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  createdAt: isoDateTime,
  dataUrl: z.string().startsWith('data:'),
});
export type ExportedFile = z.infer<typeof ExportedFileSchema>;
