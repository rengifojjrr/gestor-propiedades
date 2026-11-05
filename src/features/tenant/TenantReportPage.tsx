/** El inquilino reporta un problema de la casa (con foto) y ve el estado de sus reportes. */
import { useActor } from '@/app/session';
import { useLiveResult } from '@/data/live';
import { COMMON, makeT } from '@/features/guest/i18n';
import { ReportScreen } from '@/features/guest/ReportForm';
import { useLang } from '@/lib/i18n';
import { svc } from '@/services';
import { ErrorState, Loading } from '@/ui';

export default function TenantReportPage() {
  const actor = useActor();
  const res = useLiveResult(() => svc.leases.tenantHome(actor), [actor]);
  const home = res.data;
  const [lang] = useLang(home?.person.language ?? 'es');
  const tc = makeT(COMMON, lang);
  if (!home) return res.error ? <ErrorState error={tc('loadError')} /> : <Loading label={tc('loading')} />;
  const place = home.lease ? { propertyId: home.lease.propertyId, propertyName: home.property?.name ?? home.lease.propertyName, leaseId: home.lease.id } : null;
  return (
    <div lang={lang}>
      <ReportScreen lang={lang} source="tenant" place={place} />
    </div>
  );
}
