/** Reservas (`/reservas`): cifras del mes, lista con acciones, línea de tiempo de todas las propiedades y mes por propiedad. */
import { CalendarDays, ChartGantt, List, Plus, Upload } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useSession, useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { todayLocal } from '@/lib/clock';
import { addDays, monthEndExclusive, monthLabel, monthStart } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import { svc } from '@/services';
import { LinkButton, PageHeader, StatCard, Tabs } from '@/ui';
import { BookingList } from './BookingList';
import { BookingMonth } from './BookingMonth';
import { BookingTimeline } from './BookingTimeline';
import { canManageBookings, MoneyTotals, seesBookingMoney, sumByCurrency } from './shared';

type View = 'lista' | 'linea' | 'mes';
const VIEWS: View[] = ['lista', 'linea', 'mes'];

function BookingStats({ money }: { money: boolean }) {
  const actor = useActor();
  const month = svc.finance.currentMonth();
  const active = useLive(() => svc.bookings.listBookings(actor, { status: ['confirmed', 'in_progress'] }), [actor]);
  const kpis = useLive(() => (money ? svc.finance.portfolioKpis(actor, month).catch(() => null) : Promise.resolve(null)), [actor, money, month]);

  const stats = useMemo(() => {
    const list = active ?? [];
    const from = monthStart(month);
    const to = monthEndExclusive(month);
    const inMonth = list.filter((b) => b.checkIn < to && b.checkOut > from);
    const confirmed = list.filter((b) => b.status === 'confirmed');
    const inProgress = list.filter((b) => b.status === 'in_progress');
    const today = todayLocal();
    return {
      revenue: sumByCurrency(inMonth.map((b) => ({ amount: b.netPayout, currency: b.currency }))),
      inMonth: inMonth.length,
      confirmed: confirmed.length,
      arrivingWeek: confirmed.filter((b) => b.checkIn <= addDays(today, 7)).length,
      inProgress: inProgress.length,
      leavingToday: inProgress.filter((b) => b.checkOut === b.today).length,
      arrivalsToday: list.filter((b) => b.checkIn === b.today).length,
    };
  }, [active, month]);

  const loading = active === undefined;
  const dash = '—';

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {money ? (
        <>
          <StatCard
            label="Ocupación del mes"
            value={kpis ? formatPercent(kpis.occupancy) : dash}
            progress={kpis?.occupancy}
            hint={monthLabel(month)}
            testId="stat-ocupacion"
          />
          <StatCard
            label="Ingresos esperados"
            value={loading ? dash : <MoneyTotals totals={stats.revenue} />}
            hint={`Pago neto · ${stats.inMonth} ${stats.inMonth === 1 ? 'reserva' : 'reservas'}`}
            hintTone="good"
            testId="stat-ingresos"
          />
        </>
      ) : (
        <>
          <StatCard label="Entradas hoy" value={loading ? dash : stats.arrivalsToday} hint="Huéspedes que llegan" />
          <StatCard label="Salidas hoy" value={loading ? dash : stats.leavingToday} hint="Huéspedes que se van" />
        </>
      )}
      <StatCard
        label="Confirmadas"
        value={loading ? dash : stats.confirmed}
        accent="good"
        hint={stats.arrivingWeek ? `${stats.arrivingWeek} ${stats.arrivingWeek === 1 ? 'entra' : 'entran'} esta semana` : 'Ninguna entra esta semana'}
      />
      <StatCard
        label="En curso"
        value={loading ? dash : stats.inProgress}
        accent="warn"
        hint={stats.leavingToday ? `${stats.leavingToday} ${stats.leavingToday === 1 ? 'sale' : 'salen'} hoy` : 'Nadie sale hoy'}
        hintTone={stats.leavingToday ? 'warn' : 'neutral'}
      />
    </div>
  );
}

export default function BookingsPage() {
  const { user } = useSession();
  const role = user?.role;
  const manage = canManageBookings(role);
  const money = seesBookingMoney(role);
  const [params, setParams] = useSearchParams();
  const raw = params.get('vista');
  const view: View = VIEWS.includes(raw as View) ? (raw as View) : 'lista';

  const setView = (v: View) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('vista', v);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reservas"
        subtitle="Reservas por noche, entradas y salidas de huéspedes."
        actions={
          manage && (
            <>
              <LinkButton to="/reservas/importar" variant="secondary" icon={Upload} className="flex-1 md:flex-none" data-testid="importar-ics">
                Importar .ics
              </LinkButton>
              <LinkButton to="/reservas/nueva" icon={Plus} className="flex-1 md:flex-none" data-testid="nueva-reserva">
                Nueva reserva
              </LinkButton>
            </>
          )
        }
      />

      <BookingStats money={money} />

      <Tabs<View>
        ariaLabel="Vista de reservas"
        value={view}
        onChange={setView}
        className="w-full md:w-fit"
        tabs={[
          {
            id: 'lista',
            label: (
              <>
                <List size={16} aria-hidden /> Lista
              </>
            ),
          },
          {
            id: 'linea',
            label: (
              <>
                <ChartGantt size={16} aria-hidden /> Línea de tiempo
              </>
            ),
          },
          {
            id: 'mes',
            label: (
              <>
                <CalendarDays size={16} aria-hidden /> Mes
              </>
            ),
          },
        ]}
      />

      {view === 'lista' && <BookingList manage={manage} money={money} />}
      {view === 'linea' && <BookingTimeline canOpenLeases={manage} />}
      {view === 'mes' && <BookingMonth manage={manage} canOpenLeases={manage} />}
    </div>
  );
}
