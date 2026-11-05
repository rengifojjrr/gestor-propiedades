/** Textos en español de los valores técnicos (el código va en inglés, la interfaz en español). */
import type {
  ApprovalStatus,
  BookingStatus,
  Channel,
  CleaningStatus,
  CleaningType,
  DocCategory,
  DocVisibility,
  MaintenanceCategory,
  NotificationKind,
  OrderStatus,
  PaymentMethod,
  Priority,
  PropertyStatus,
  PropertyType,
  RentalMode,
  Role,
} from './types';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Propietario',
  admin: 'Administración',
  support: 'Atención al cliente',
  cleaner: 'Limpieza',
  technician: 'Mantenimiento',
  guest: 'Huésped',
  tenant: 'Inquilino',
  accountant: 'Contabilidad',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  owner: 'Todo, desde un solo panel. Aprueba gastos grandes.',
  admin: 'Opera propiedades, reservas, contratos, equipo y gastos.',
  support: 'Mensajes, plantillas, reservas e incidencias.',
  cleaner: 'Sus tareas, checklist con fotos y reportes de daño.',
  technician: 'Sus órdenes de trabajo, fotos y costos.',
  guest: 'Su reserva, cómo llegar, códigos y mensajes. ES/EN.',
  tenant: 'Su contrato, pagos, reportes y mensajes. ES/EN.',
  accountant: 'Finanzas y documentos financieros, en lectura.',
};

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  house: 'Casa',
  apartment: 'Apartamento',
  villa: 'Villa',
  loft: 'Loft',
  studio: 'Estudio',
};

export const RENTAL_MODE_LABEL: Record<RentalMode, string> = {
  nightly: 'Por noches',
  monthly: 'Por meses',
  mixed: 'Mixto',
};

export const PROPERTY_STATUS_LABEL: Record<PropertyStatus, string> = {
  occupied: 'Ocupada',
  vacant: 'Libre',
  maintenance: 'En mantenimiento',
  blocked: 'Bloqueada',
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  airbnb: 'Airbnb',
  booking: 'Booking',
  vrbo: 'Vrbo',
  direct: 'Directo',
};

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  confirmed: 'Confirmada',
  in_progress: 'En curso',
  completed: 'Terminada',
  cancelled: 'Cancelada',
};

export const CLEANING_TYPE_LABEL: Record<CleaningType, string> = {
  checkout: 'Limpieza de salida',
  deep: 'Limpieza profunda',
  inspection: 'Inspección',
};

export const CLEANING_STATUS_LABEL: Record<CleaningStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  done: 'Hecha',
  cancelled: 'Cancelada',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  open: 'Abierta',
  scheduled: 'Programada',
  in_progress: 'En curso',
  resolved: 'Resuelta',
  cancelled: 'Cancelada',
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  not_required: 'No requiere aprobación',
  pending: 'Pendiente de aprobación',
  approved: 'Aprobado',
  rejected: 'Rechazado',
};

export const MAINTENANCE_CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  plumbing: 'Plomería',
  electrical: 'Electricidad',
  hvac: 'Aire acondicionado',
  appliances: 'Electrodomésticos',
  pests: 'Plagas',
  pool: 'Piscina',
  garden: 'Jardín',
  locks: 'Cerraduras',
  general: 'General',
};

export const INCOME_CATEGORY_LABEL: Record<string, string> = {
  booking: 'Reservas',
  rent: 'Rentas',
  late_fee: 'Recargos por atraso',
  other_income: 'Otros ingresos',
};

export const EXPENSE_CATEGORY_LABEL: Record<string, string> = {
  cleaning: 'Limpieza',
  maintenance: 'Mantenimiento',
  utilities: 'Servicios (luz, agua, internet)',
  lodging_tax: 'Impuestos de hospedaje',
  insurance: 'Seguro',
  hoa: 'Condominio / HOA',
  mortgage: 'Hipoteca',
  commissions: 'Comisiones de canal',
  management: 'Administración',
  property_tax: 'Impuesto predial',
  supplies: 'Insumos',
  other_expense: 'Otros gastos',
};

export function categoryLabel(key: string, custom: { key: string; label: string }[] = []): string {
  return (
    INCOME_CATEGORY_LABEL[key] ?? EXPENSE_CATEGORY_LABEL[key] ?? custom.find((c) => c.key === key)?.label ?? key
  );
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  transfer: 'Transferencia',
  cash: 'Efectivo',
  card: 'Tarjeta',
  check: 'Cheque',
  zelle: 'Zelle',
  channel: 'Pago del canal',
  other: 'Otro',
};

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  contract: 'Contrato',
  insurance: 'Seguro',
  deed: 'Escritura',
  license: 'Licencia',
  invoice: 'Factura',
  inspection: 'Inspección',
  other: 'Otro',
};

export const DOC_VISIBILITY_LABEL: Record<DocVisibility, string> = {
  owner: 'Solo propietario',
  team: 'Equipo',
  finance: 'Finanzas (propietario, administración y contabilidad)',
  tenant: 'Inquilino y equipo',
  guest: 'Huésped y equipo',
};

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  urgent: 'Urgente',
  payment: 'Pago',
  document: 'Documento',
  cleaning: 'Limpieza',
  booking: 'Reserva',
  approval: 'Aprobación',
  message: 'Mensaje',
  incident: 'Incidencia',
  renewal: 'Renovación',
};

export const ACCESS_KIND_LABEL = {
  door: 'Cerradura de la puerta',
  lockbox: 'Caja de llaves',
  wifi: 'Wifi',
  gate: 'Portón',
  alarm: 'Alarma',
} as const;
