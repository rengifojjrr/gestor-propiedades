/**
 * Rutas con hash (GitHub Pages no sabe de rutas: así recargar no da 404).
 * Cada ruta se protege por rol; los permisos de verdad están en los servicios.
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createHashRouter, Navigate } from 'react-router';
import type { Role } from '@/domain/types';
import { AppShell } from '@/layout/AppShell';
import { Loading } from '@/ui';
import { HOME_BY_ROLE, useSession } from './session';

const page = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return <C />;
};

const OWNER_ADMIN: Role[] = ['owner', 'admin'];
const FRONT: Role[] = ['owner', 'admin', 'support'];
const FIN: Role[] = ['owner', 'admin', 'accountant'];
const TEAM: Role[] = ['owner', 'admin', 'support', 'accountant'];
const ALL: Role[] = ['owner', 'admin', 'support', 'accountant', 'cleaner', 'technician', 'guest', 'tenant'];

function Protected({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  if (!ready) return <Loading label="Preparando los datos de ejemplo…" className="min-h-dvh" />;
  if (!user) return <Navigate to="/entrar" replace />;
  return <>{children}</>;
}

function Gate({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useSession();
  if (!user) return <Navigate to="/entrar" replace />;
  if (!roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useSession();
  return <Navigate to={user ? HOME_BY_ROLE[user.role] : '/entrar'} replace />;
}

const r = (path: string, roles: Role[], el: ReactNode) => ({ path, element: <Gate roles={roles}>{el}</Gate> });

export const router = createHashRouter([
  { path: '/entrar', element: <Suspense fallback={<Loading />}>{page(() => import('@/features/auth/LoginPage'))}</Suspense> },
  { path: '/creditos', element: <Suspense fallback={<Loading />}>{page(() => import('@/features/credits/CreditsPage'))}</Suspense> },
  {
    path: '/',
    element: (
      <Protected>
        <AppShell />
      </Protected>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      r('panel', FRONT, page(() => import('@/features/dashboard/DashboardPage'))),

      r('propiedades', TEAM, page(() => import('@/features/properties/PropertiesPage'))),
      r('propiedades/nueva', OWNER_ADMIN, page(() => import('@/features/properties/PropertyFormPage'))),
      r('propiedades/:id', TEAM, page(() => import('@/features/properties/PropertyDetailPage'))),
      r('propiedades/:id/editar', OWNER_ADMIN, page(() => import('@/features/properties/PropertyFormPage'))),

      r('reservas', FRONT, page(() => import('@/features/bookings/BookingsPage'))),
      r('reservas/nueva', OWNER_ADMIN, page(() => import('@/features/bookings/BookingFormPage'))),
      r('reservas/importar', OWNER_ADMIN, page(() => import('@/features/bookings/IcsImportPage'))),
      r('reservas/:id', FRONT, page(() => import('@/features/bookings/BookingDetailPage'))),

      r('contratos', FIN, page(() => import('@/features/leases/LeasesPage'))),
      r('contratos/nuevo', OWNER_ADMIN, page(() => import('@/features/leases/LeaseFormPage'))),
      r('contratos/:id', FIN, page(() => import('@/features/leases/LeaseDetailPage'))),

      r('calendario', TEAM, page(() => import('@/features/calendar/CalendarPage'))),

      r('operacion', FRONT, page(() => import('@/features/operations/OperationsPage'))),
      r('operacion/limpieza/nueva', OWNER_ADMIN, page(() => import('@/features/operations/CleaningFormPage'))),
      r('operacion/limpieza/:id', FRONT, page(() => import('@/features/operations/CleaningDetailPage'))),
      r('operacion/mantenimiento/nueva', OWNER_ADMIN, page(() => import('@/features/operations/OrderFormPage'))),
      r('operacion/mantenimiento/:id', FRONT, page(() => import('@/features/operations/OrderDetailPage'))),
      r('operacion/preventivo', OWNER_ADMIN, page(() => import('@/features/operations/PreventivePage'))),
      r('operacion/proveedores', FRONT, page(() => import('@/features/operations/VendorsPage'))),
      r('operacion/incidencias', FRONT, page(() => import('@/features/operations/IncidentsPage'))),

      r('huespedes', FRONT, page(() => import('@/features/people/GuestsMessagesPage'))),
      r('mensajes', FRONT, page(() => import('@/features/people/InboxPage'))),
      r('mensajes/:threadId', FRONT, page(() => import('@/features/people/ThreadPage'))),
      r('personas/:id', FRONT, page(() => import('@/features/people/PersonDetailPage'))),

      r('finanzas', FIN, page(() => import('@/features/finances/FinancesPage'))),
      r('finanzas/movimientos', FIN, page(() => import('@/features/finances/TransactionsPage'))),
      r('finanzas/estado-de-cuenta', FIN, page(() => import('@/features/finances/StatementPage'))),

      r('documentos', TEAM, page(() => import('@/features/documents/DocumentsPage'))),
      r('avisos', ALL, page(() => import('@/features/notifications/NotificationsPage'))),
      r('ajustes', OWNER_ADMIN, page(() => import('@/features/settings/SettingsPage'))),
      r('mas', TEAM, page(() => import('@/features/more/MorePage'))),
      r('perfil', ALL, page(() => import('@/features/more/ProfilePage'))),

      r('limpieza', ['cleaner'], page(() => import('@/features/cleaner/CleanerHomePage'))),
      r('limpieza/tarea/:id', ['cleaner'], page(() => import('@/features/cleaner/CleanerTaskPage'))),
      r('tecnico', ['technician'], page(() => import('@/features/technician/TechnicianHomePage'))),
      r('tecnico/orden/:id', ['technician'], page(() => import('@/features/technician/TechnicianOrderPage'))),

      r('huesped', ['guest'], page(() => import('@/features/guest/GuestHomePage'))),
      r('huesped/mensajes', ['guest'], page(() => import('@/features/guest/GuestMessagesPage'))),
      r('huesped/reportar', ['guest'], page(() => import('@/features/guest/GuestReportPage'))),
      r('inquilino', ['tenant'], page(() => import('@/features/tenant/TenantHomePage'))),
      r('inquilino/pagos', ['tenant'], page(() => import('@/features/tenant/TenantPaymentsPage'))),
      r('inquilino/mensajes', ['tenant'], page(() => import('@/features/tenant/TenantMessagesPage'))),
      r('inquilino/reportar', ['tenant'], page(() => import('@/features/tenant/TenantReportPage'))),

      { path: '*', element: <HomeRedirect /> },
    ],
  },
]);
