/** El huésped reporta un problema de su estadía (con foto) y ve el estado de sus reportes. */
import { useActor } from '@/app/session';
import { useLiveResult } from '@/data/live';
import { useLang } from '@/lib/i18n';
import { svc } from '@/services';
import { ErrorState, Loading } from '@/ui';
import { COMMON, makeT } from './i18n';
import { ReportScreen } from './ReportForm';

export default function GuestReportPage() {
  const actor = useActor();
  const res = useLiveResult(() => svc.bookings.guestHome(actor), [actor]);
  const home = res.data;
  const [lang] = useLang(home?.person.language ?? 'es');
  const tc = makeT(COMMON, lang);
  if (!home) return res.error ? <ErrorState error={tc('loadError')} /> : <Loading label={tc('loading')} />;
  const place = home.booking && home.property ? { propertyId: home.property.id, propertyName: home.property.name, bookingId: home.booking.id } : null;
  return (
    <div lang={lang}>
      <ReportScreen lang={lang} source="guest" place={place} />
    </div>
  );
}
