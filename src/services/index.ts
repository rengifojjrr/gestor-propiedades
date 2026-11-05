/**
 * Servicios: la única puerta de las pantallas a los datos. Cada función recibe el actor actual,
 * valida con zod, aplica permisos con can() y deja rastro en la auditoría.
 */
import * as bookings from './bookings';
import * as dashboard from './dashboard';
import * as documents from './documents';
import * as files from './files';
import * as finance from './finance';
import * as leases from './leases';
import * as operations from './operations';
import * as people from './people';
import * as properties from './properties';
import * as system from './system';

export const svc = { bookings, dashboard, documents, files, finance, leases, operations, people, properties, system };

export {
  actorFor,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RuleError,
  ValidationError,
  can,
  subjectFor,
  type Actor,
  type Subject,
} from './core';
export type { Action, Resource } from './permissions';
export type { BookingView, CalendarData, GuestHome, PublicProperty, IcsImportResult } from './bookings';
export type { OwnerDashboard, SupportDashboard, DashboardProperty } from './dashboard';
export type { DocumentView, ComplianceStats, DocStatus } from './documents';
export type { MonthSummary, SeriesPoint, PropertyKpis, PortfolioKpis, RoiResult, OwnerStatement, TransactionView } from './finance';
export type { LeaseView, TenantHome } from './leases';
export type { CleaningTaskView, OrderView, IncidentView, PreventiveView, VendorView, ProjectedCheckout } from './operations';
export type { PersonView, ThreadView, GuestRegistryRow, EngagementStats } from './people';
export type { PropertyView, PropertyOperations } from './properties';
export type { NotificationView, CalendarEvent, CalendarEventKind, DemoAccount, DemoInfo, TeamMember } from './system';

/** Mensaje legible de cualquier error de servicio (para avisos en pantalla). */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Algo salió mal. Intenta de nuevo.';
}
