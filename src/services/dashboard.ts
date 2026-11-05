/**
 * Panel único: cifras del portafolio, lo de hoy, alertas, estado de cada propiedad y mapa.
 * Compone otros servicios; cada parte respeta los permisos de quien mira.
 */
import type { PropertyStatus } from '@/domain/types';
import type { HealthResult } from '@/domain/rules';
import { todayIn, todayLocal } from '@/lib/clock';
import { addDays, monthKeyOf } from '@/lib/dates';
import { round2 } from '@/lib/money';
import { listBookings, type BookingView } from './bookings';
import { can, subjectFor, type Actor } from './core';
import { monthSummary, portfolioKpis, propertyPerformance, type MonthSummary, type PortfolioKpis, type PropertyKpis } from './finance';
import { listLeases } from './leases';
import { listCleaning, listIncidents, listOrders, type CleaningTaskView, type OrderView } from './operations';
import { healthAll, listProperties, type PropertyView } from './properties';
import { listThreads } from './people';
import { listNotifications, type NotificationView } from './system';

export interface DashboardProperty {
  property: PropertyView;
  health: HealthResult;
  kpis?: PropertyKpis;
}

export interface OwnerDashboard {
  month: string;
  counts: Record<PropertyStatus | 'total', number>;
  /** Ocupación del mes (en libros), promedio del portafolio. */
  occupancy: number;
  finance?: MonthSummary;
  kpis?: PortfolioKpis;
  overdueRent: { count: number; amount: number };
  alerts: NotificationView[];
  properties: DashboardProperty[];
  arrivals: BookingView[];
  departures: BookingView[];
  todayCleanings: CleaningTaskView[];
  todayOrders: OrderView[];
  urgentOrders: OrderView[];
  openIncidents: number;
  pendingApprovals: number;
}

export async function ownerDashboard(actor: Actor): Promise<OwnerDashboard> {
  const s = await subjectFor(actor);
  const month = monthKeyOf(todayLocal());
  const canFinance = can(s, 'finance.read');
  const [props, health, perf, finance, kpis, leases, alerts, bookings, cleanings, orders, incidents] = await Promise.all([
    listProperties(actor),
    healthAll(actor),
    canFinance ? propertyPerformance(actor, month) : Promise.resolve([] as PropertyKpis[]),
    canFinance ? monthSummary(actor, month) : Promise.resolve(undefined),
    canFinance ? portfolioKpis(actor, month) : Promise.resolve(undefined),
    can(s, 'lease.read') ? listLeases(actor) : Promise.resolve([]),
    listNotifications(actor),
    can(s, 'booking.read') ? listBookings(actor, { status: ['confirmed', 'in_progress'] }) : Promise.resolve([] as BookingView[]),
    listCleaning(actor, { status: ['pending', 'in_progress'] }),
    listOrders(actor, { status: ['open', 'scheduled', 'in_progress'] }),
    can(s, 'incident.read') ? listIncidents(actor, { status: ['open', 'in_progress'] }) : Promise.resolve([]),
  ]);
  const counts = { total: props.length, occupied: 0, vacant: 0, maintenance: 0, blocked: 0 };
  for (const p of props) counts[p.status]++;
  const overdue = leases.flatMap((l) => l.ledger.filter((r) => r.status === 'overdue'));
  const arrivals = bookings.filter((b) => b.status === 'confirmed' && b.checkIn >= b.today && b.checkIn <= addDays(b.today, 2));
  const departures = bookings.filter((b) => b.checkOut >= b.today && b.checkOut <= addDays(b.today, 1));
  const todayCleanings = cleanings.filter((t) => t.date <= todayIn(t.timezone));
  const todayOrders = orders.filter((o) => o.scheduledDate && o.scheduledDate <= todayIn(o.timezone));
  const occupancy = perf.length ? perf.reduce((a, r) => a + r.occupancy, 0) / perf.length : 0;
  const pendingApprovals = (await listOrders(actor)).filter((o) => o.approval.status === 'pending').length;
  return {
    month,
    counts,
    occupancy,
    finance,
    kpis,
    overdueRent: { count: overdue.length, amount: round2(overdue.reduce((a, r) => a + r.rent + r.lateFee, 0)) },
    alerts: alerts.slice(0, 6),
    properties: props.map((p) => ({ property: p, health: health[p.id], kpis: perf.find((k) => k.propertyId === p.id) })),
    arrivals,
    departures,
    todayCleanings,
    todayOrders,
    urgentOrders: orders.filter((o) => o.priority === 'urgent'),
    openIncidents: incidents.length,
    pendingApprovals,
  };
}

export interface SupportDashboard {
  unreadThreads: number;
  arrivals: BookingView[];
  departures: BookingView[];
  inHouse: BookingView[];
  openIncidents: number;
  urgentOrders: OrderView[];
  alerts: NotificationView[];
}

/** Panel de atención al cliente: mensajes, llegadas, salidas e incidencias (sin finanzas). */
export async function supportDashboard(actor: Actor): Promise<SupportDashboard> {
  const [bookings, incidents, orders, alerts, threads] = await Promise.all([
    listBookings(actor, { status: ['confirmed', 'in_progress'] }),
    listIncidents(actor, { status: ['open', 'in_progress'] }),
    listOrders(actor, { status: ['open', 'scheduled', 'in_progress'] }),
    listNotifications(actor),
    listThreads(actor),
  ]);
  return {
    unreadThreads: threads.filter((t) => t.unreadTeam > 0).length,
    arrivals: bookings.filter((b) => b.status === 'confirmed' && b.checkIn >= b.today && b.checkIn <= addDays(b.today, 2)),
    departures: bookings.filter((b) => b.checkOut >= b.today && b.checkOut <= addDays(b.today, 1)),
    inHouse: bookings.filter((b) => b.status === 'in_progress'),
    openIncidents: incidents.length,
    urgentOrders: orders.filter((o) => o.priority === 'urgent'),
    alerts: alerts.slice(0, 6),
  };
}
