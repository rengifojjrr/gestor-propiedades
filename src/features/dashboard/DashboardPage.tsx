/**
 * Panel (/panel): propietario y administración ven el portafolio completo; atención al cliente,
 * «Hoy en atención» (sin dinero). Cada parte respeta los permisos de quien mira.
 */
import { useActor, useSession } from '@/app/session';
import { useLiveResult } from '@/data/live';
import { svc } from '@/services';
import { ErrorState, Loading } from '@/ui';
import { usePermissions } from '@/features/properties/shared';
import { OwnerDashboard } from './OwnerDashboard';
import { SupportDashboard } from './SupportDashboard';

function OwnerPanel() {
  const actor = useActor();
  const perms = usePermissions();
  const res = useLiveResult(() => svc.dashboard.ownerDashboard(actor), [actor]);
  if (res.error && !res.data) return <ErrorState error={res.error} />;
  if (!res.data) return <Loading label="Cargando el panel…" />;
  return (
    <OwnerDashboard
      data={res.data}
      userName={actor.user.name}
      canCreate={perms.allowed('property.create')}
      canApprove={actor.user.role === 'owner'}
    />
  );
}

function SupportPanel() {
  const actor = useActor();
  const res = useLiveResult(() => svc.dashboard.supportDashboard(actor), [actor]);
  if (res.error && !res.data) return <ErrorState error={res.error} />;
  if (!res.data) return <Loading label="Cargando lo de hoy…" />;
  return <SupportDashboard data={res.data} userName={actor.user.name} />;
}

export default function DashboardPage() {
  const { user } = useSession();
  if (!user) return null;
  return user.role === 'support' ? <SupportPanel /> : <OwnerPanel />;
}
