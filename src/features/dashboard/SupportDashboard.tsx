/** Panel de atención al cliente: «Hoy en atención» (mensajes, llegadas, salidas e incidencias; sin dinero). */
import { BedDouble, LogIn, LogOut, MessageSquare, Siren, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { todayLocal } from '@/lib/clock';
import { formatDateLong } from '@/lib/dates';
import type { SupportDashboard as SupportDashboardData } from '@/services';
import { Card, cn, Eyebrow, PageHeader, Section, StatCard } from '@/ui';
import { AlertsSection, InHouseSection, MovementsSection, OrderRows } from './widgets';

function Tile({ to, label, children, className }: { to?: string; label: string; children: ReactNode; className?: string }) {
  if (!to) return <div className={className}>{children}</div>;
  return (
    <Link to={to} aria-label={label} className={cn('block rounded-lg transition-transform hover:-translate-y-0.5', className)}>
      {children}
    </Link>
  );
}

export function SupportDashboard({ data, userName }: { data: SupportDashboardData; userName: string }) {
  const first = userName.split(/\s+/)[0];
  const date = formatDateLong(todayLocal());
  const urgent = data.urgentOrders.length;
  return (
    <div data-testid="panel-atencion" className="space-y-8">
      <PageHeader
        eyebrow={<Eyebrow>{date.charAt(0).toUpperCase() + date.slice(1)}</Eyebrow>}
        title="Hoy en atención"
        subtitle={`Hola, ${first}. Esto es lo que necesita respuesta hoy.`}
      />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3" aria-label="Lo de hoy">
        <Tile to="/mensajes" label={`Conversaciones sin leer: ${data.unreadThreads}. Abrir mensajes`}>
          <StatCard
            icon={MessageSquare}
            label="Conversaciones sin leer"
            value={data.unreadThreads}
            accent={data.unreadThreads > 0 ? 'warn' : undefined}
            hint={data.unreadThreads > 0 ? 'Responde primero las más viejas' : 'Bandeja al día'}
            hintTone={data.unreadThreads > 0 ? 'warn' : 'good'}
            className="h-full"
          />
        </Tile>
        <StatCard icon={LogIn} label="Llegadas (48 h)" value={data.arrivals.length} hint="Confirmadas" className="h-full" />
        <StatCard icon={LogOut} label="Salidas (hoy y mañana)" value={data.departures.length} hint="Revisa la limpieza de salida" className="h-full" />
        <StatCard icon={BedDouble} label="Huéspedes en casa" value={data.inHouse.length} hint="Estadías en curso" className="h-full" />
        <Tile to="/operacion/incidencias" label={`Incidencias abiertas: ${data.openIncidents}. Ver incidencias`}>
          <StatCard
            icon={Siren}
            label="Incidencias abiertas"
            value={data.openIncidents}
            accent={data.openIncidents > 0 ? 'bad' : undefined}
            hint={data.openIncidents > 0 ? 'Asígnalas o conviértelas en orden' : 'Ninguna abierta'}
            hintTone={data.openIncidents > 0 ? 'bad' : 'good'}
            className="h-full"
          />
        </Tile>
        <Tile to="/operacion" label={`Órdenes urgentes: ${urgent}. Ver operación`}>
          <StatCard
            icon={Wrench}
            label="Órdenes urgentes"
            value={urgent}
            accent={urgent > 0 ? 'bad' : undefined}
            hint={urgent > 0 ? 'Avisa al huésped si le afecta' : 'Sin urgencias'}
            hintTone={urgent > 0 ? 'bad' : 'good'}
            className="h-full"
          />
        </Tile>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <MovementsSection arrivals={data.arrivals} departures={data.departures} title="Llegadas y salidas" />
        <InHouseSection guests={data.inHouse} />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Section title="Órdenes urgentes">
          <Card>{urgent ? <OrderRows orders={data.urgentOrders} /> : <p className="text-body-sm text-on-surface-variant">No hay órdenes urgentes abiertas.</p>}</Card>
        </Section>
        <AlertsSection alerts={data.alerts} limit={5} title="Alertas" />
      </div>
    </div>
  );
}
