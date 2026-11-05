/** Configuración fija del dominio (sin datos de ejemplo): variables de plantillas y proveedor por categoría. */
import type { MaintenanceCategory } from './types';

export const TEMPLATE_VARIABLES: { key: string; label: string }[] = [
  { key: 'guest_name', label: 'Nombre del huésped o inquilino' },
  { key: 'property_name', label: 'Nombre de la propiedad' },
  { key: 'city', label: 'Ciudad' },
  { key: 'check_in', label: 'Fecha de entrada' },
  { key: 'check_out', label: 'Fecha de salida' },
  { key: 'check_in_time', label: 'Hora de entrada' },
  { key: 'check_out_time', label: 'Hora de salida' },
  { key: 'amount', label: 'Monto (renta)' },
  { key: 'due_date', label: 'Fecha de pago' },
  { key: 'company', label: 'Nombre de la empresa' },
  { key: 'app_link', label: 'Link a la app' },
];

/** Proveedor por defecto para cada categoría (el técnico con cuenta cubre lo general). */
export const DEFAULT_VENDOR_FOR: Record<MaintenanceCategory, string> = {
  plumbing: 'v-aguilar',
  electrical: 'v-aguilar',
  hvac: 'v-aguilar',
  appliances: 'v-aguilar',
  locks: 'v-aguilar',
  general: 'v-aguilar',
  pool: 'v-piscinas',
  pests: 'v-fumi',
  garden: 'v-jardin',
};
