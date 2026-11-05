/**
 * Menús por rol: cada rol entra a «su app». `bottom` es la barra del teléfono (máx. 5),
 * `rail` el riel de la computadora y `more` lo que aparece en «Más».
 */
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  FileSignature,
  FileText,
  Home,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Receipt,
  Settings,
  Siren,
  SprayCan,
  UserRound,
  Wallet,
  Wrench,
} from 'lucide-react';
import type { Role } from '@/domain/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Marca activo también en subrutas (por defecto true). */
  prefix?: boolean;
}

export interface RoleNav {
  variant: 'team' | 'field' | 'person';
  bottom: NavItem[];
  rail: NavItem[];
  more: NavItem[];
}

const I = {
  panel: { to: '/panel', label: 'Panel', icon: LayoutDashboard },
  props: { to: '/propiedades', label: 'Propiedades', icon: Building2 },
  bookings: { to: '/reservas', label: 'Reservas', icon: CalendarDays },
  leases: { to: '/contratos', label: 'Contratos', icon: FileSignature },
  calendar: { to: '/calendario', label: 'Calendario', icon: CalendarDays },
  ops: { to: '/operacion', label: 'Limpieza y mantenimiento', icon: Wrench },
  incidents: { to: '/operacion/incidencias', label: 'Incidencias', icon: Siren },
  guests: { to: '/huespedes', label: 'Huéspedes y mensajes', icon: MessageSquare },
  messages: { to: '/huespedes', label: 'Mensajes', icon: MessageSquare },
  finance: { to: '/finanzas', label: 'Finanzas', icon: Wallet },
  statement: { to: '/finanzas/estado-de-cuenta', label: 'Estado de cuenta', icon: Receipt },
  docs: { to: '/documentos', label: 'Documentos', icon: FileText },
  alerts: { to: '/avisos', label: 'Avisos', icon: Bell },
  settings: { to: '/ajustes', label: 'Ajustes', icon: Settings },
  more: { to: '/mas', label: 'Más', icon: MoreHorizontal },
  profile: { to: '/perfil', label: 'Perfil', icon: UserRound },
} satisfies Record<string, NavItem>;

export const NAV: Record<Role, RoleNav> = {
  owner: {
    variant: 'team',
    bottom: [I.panel, I.props, I.bookings, I.finance, I.more],
    rail: [I.panel, I.props, I.bookings, I.leases, I.calendar, I.ops, I.guests, I.finance, I.docs, I.alerts, I.settings],
    more: [I.leases, I.calendar, I.ops, I.guests, I.docs, I.alerts, I.settings],
  },
  admin: {
    variant: 'team',
    bottom: [I.panel, I.props, I.bookings, I.finance, I.more],
    rail: [I.panel, I.props, I.bookings, I.leases, I.calendar, I.ops, I.guests, I.finance, I.docs, I.alerts, I.settings],
    more: [I.leases, I.calendar, I.ops, I.guests, I.docs, I.alerts, I.settings],
  },
  support: {
    variant: 'team',
    bottom: [I.panel, I.messages, I.bookings, { ...I.incidents, label: 'Incidencias' }, I.more],
    rail: [I.panel, I.guests, I.bookings, I.calendar, I.incidents, I.props, I.docs, I.alerts, I.profile],
    more: [I.calendar, I.props, I.docs, I.alerts, I.profile],
  },
  accountant: {
    variant: 'team',
    bottom: [I.finance, I.statement, I.docs, I.alerts, I.more],
    rail: [I.finance, I.statement, I.leases, I.props, I.docs, I.calendar, I.alerts, I.profile],
    more: [I.leases, I.props, I.calendar, I.profile],
  },
  cleaner: {
    variant: 'field',
    bottom: [{ to: '/limpieza', label: 'Mis tareas', icon: SprayCan }, I.alerts, I.profile],
    rail: [{ to: '/limpieza', label: 'Mis tareas', icon: SprayCan }, I.alerts, I.profile],
    more: [],
  },
  technician: {
    variant: 'field',
    bottom: [{ to: '/tecnico', label: 'Mis órdenes', icon: ClipboardList }, I.alerts, I.profile],
    rail: [{ to: '/tecnico', label: 'Mis órdenes', icon: ClipboardList }, I.alerts, I.profile],
    more: [],
  },
  guest: {
    variant: 'person',
    bottom: [
      { to: '/huesped', label: 'stay', icon: Home, prefix: false },
      { to: '/huesped/mensajes', label: 'messages', icon: MessageSquare },
      { to: '/huesped/reportar', label: 'report', icon: Siren },
    ],
    rail: [],
    more: [],
  },
  tenant: {
    variant: 'person',
    bottom: [
      { to: '/inquilino', label: 'lease', icon: Home, prefix: false },
      { to: '/inquilino/pagos', label: 'payments', icon: Receipt },
      { to: '/inquilino/mensajes', label: 'messages', icon: MessageSquare },
      { to: '/inquilino/reportar', label: 'report', icon: Siren },
    ],
    rail: [],
    more: [],
  },
};

/** Textos ES/EN del menú de huésped e inquilino. */
export const PERSON_NAV_LABELS = {
  es: { stay: 'Mi estadía', lease: 'Mi contrato', payments: 'Pagos', messages: 'Mensajes', report: 'Reportar' },
  en: { stay: 'My stay', lease: 'My lease', payments: 'Payments', messages: 'Messages', report: 'Report' },
} as const;
