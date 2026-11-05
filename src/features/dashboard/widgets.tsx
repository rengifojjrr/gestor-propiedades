/**
 * Bloques del panel: alertas recientes, estado de las propiedades, mapa, entradas y salidas,
 * tareas de hoy y órdenes urgentes. Se usan en el panel del propietario y en el de atención.
 */
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BadgeDollarSign,
  Banknote,
  CalendarCheck,
  ChevronRight,
  FileWarning,
  LogIn,
  LogOut,
  MessageSquare,
  RefreshCw,
  Siren,
  SprayCan,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { Suspense, useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { CLEANING_TYPE_LABEL, PROPERTY_STATUS_LABEL } from '@/domain/labels';
import type { NotificationKind } from '@/domain/types';
import { formatDate, formatTime } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import type { BookingView, CleaningTaskView, DashboardProperty, NotificationView, OrderView } from '@/services';
import { HealthChip, InfoRow, propertyMarker, when } from '@/features/properties/shared';
import {
  Badge,
  Card,
  CleaningStatusBadge,
  cn,
  EmptyState,
  LazyMap,
  Loading,
  Money,
  PriorityBadge,
  ProgressBar,
  PropertyImage,
  PropertyStatusBadge,
  Section,
} from '@/ui';

// ───────────────────────── Enlaces de sección ─────────────────────────

/** Enlace «Ver todas →» de la cabecera de una sección. */
export function SectionLink({ to, children, className, hideOnPhone }: { to: string; children: ReactNode; className?: string; hideOnPhone?: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        hideOnPhone ? 'hidden sm:inline-flex' : 'inline-flex',
        'shrink-0 items-center gap-1 rounded-md px-2 py-1 text-label-md whitespace-nowrap hover:underline',
        className ?? 'text-primary',
      )}
    >
      {children} <ArrowRight size={16} aria-hidden />
    </Link>
  );
}

// ───────────────────────── Alertas ─────────────────────────

const ALERT_ICON: Record<NotificationKind, LucideIcon> = {
  urgent: Siren,
  payment: Banknote,
  document: FileWarning,
  cleaning: SprayCan,
  booking: CalendarCheck,
  approval: BadgeDollarSign,
  message: MessageSquare,
  incident: TriangleAlert,
  renewal: RefreshCw,
};

const ALERT_TONE: Record<NotificationView['tone'], { border: string; icon: string }> = {
  urgent: { border: 'border-l-error', icon: 'text-error' },
  warn: { border: 'border-l-warning', icon: 'text-warning' },
  good: { border: 'border-l-secondary', icon: 'text-secondary' },
  info: { border: 'border-l-primary', icon: 'text-primary' },
};

export function AlertsSection({ alerts, limit = 4, className, title = 'Alertas recientes' }: { alerts: NotificationView[]; limit?: number; className?: string; title?: string }) {
  const shown = alerts.slice(0, limit);
  return (
    <Section title={title} className={className} action={<SectionLink to="/avisos" className="text-secondary">Ver todas</SectionLink>}>
      {shown.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="Sin alertas" body="Todo en orden por ahora." />
      ) : (
        <ul className="space-y-3">
          {shown.map((a) => {
            const Icon = ALERT_ICON[a.kind];
            const tone = ALERT_TONE[a.tone];
            const body = (
              <>
                <Icon size={20} className={cn('mt-0.5 shrink-0', tone.icon)} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-label-md text-primary">{a.title}</span>
                    {!a.read && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-error">
                        <span className="sr-only">Sin leer</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-body-sm text-on-surface-variant">{a.body}</span>
                </span>
                {a.link && <ChevronRight size={18} className="mt-0.5 shrink-0 text-on-surface-variant" aria-hidden />}
              </>
            );
            const cls = cn('flex items-start gap-3 rounded-lg border-l-4 bg-surface-low p-4', tone.border);
            return (
              <li key={a.id}>
                {a.link ? (
                  <Link to={a.link} className={cn(cls, 'transition-colors hover:bg-surface-container')}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// ───────────────────────── Estado de las propiedades ─────────────────────────

export function PropertyStatusSection({ rows, baseCurrency, className }: { rows: DashboardProperty[]; baseCurrency?: string; className?: string }) {
  const navigate = useNavigate();
  const showMoney = !!baseCurrency && rows.some((r) => r.kpis);
  const showOccupancy = rows.some((r) => r.kpis);
  return (
    <Section title="Estado de las propiedades" className={className} action={
        <SectionLink to="/propiedades" hideOnPhone>
          Ver todas
        </SectionLink>
      }>
      <Card padding="none" className="overflow-hidden">
        {/* Tableta y computadora: tabla */}
        <table className="hidden w-full table-fixed text-left md:table">
          <colgroup>
            <col />
            <col className="w-38" />
            {showOccupancy && <col className="w-22" />}
            {showMoney && <col className="w-26" />}
            <col className="w-22" />
          </colgroup>
          <thead className="border-b border-outline-variant/40 bg-surface-low">
            <tr>
              <th scope="col" className="py-3 pr-2 pl-5 text-label-md text-on-surface-variant">
                Propiedad
              </th>
              <th scope="col" className="px-2 py-3 text-label-md text-on-surface-variant">
                Estado
              </th>
              {showOccupancy && (
                <th scope="col" className="px-2 py-3 text-label-md text-on-surface-variant">
                  Ocupación
                </th>
              )}
              {showMoney && (
                <th scope="col" className="px-2 py-3 text-right text-label-md text-on-surface-variant">
                  Ingresos
                </th>
              )}
              <th scope="col" className="py-3 pr-5 pl-2 text-right text-label-md text-on-surface-variant">
                Salud
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/30">
            {rows.map(({ property: p, health, kpis }) => (
              <tr key={p.id} className="cursor-pointer transition-colors hover:bg-surface-low" onClick={() => navigate(`/propiedades/${p.id}`)}>
                <td className="py-3 pr-2 pl-5">
                  <div className="flex items-center gap-3">
                    <PropertyImage photo={p.photos[0]} alt="" className="h-10 w-10 shrink-0 rounded-md" />
                    <div className="min-w-0">
                      <Link to={`/propiedades/${p.id}`} className="line-clamp-2 text-label-md text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                      <span className="block truncate text-body-sm text-on-surface-variant">{p.city}</span>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-3">
                  <PropertyStatusBadge status={p.status} />
                </td>
                {showOccupancy && (
                  <td className="px-2 py-3">
                    {kpis ? (
                      <>
                        <span className="tabular text-label-md text-on-surface">{formatPercent(kpis.occupancy)}</span>
                        <ProgressBar value={kpis.occupancy} tone="info" className="mt-1.5" label={`Ocupación de ${p.name}`} />
                      </>
                    ) : (
                      <span className="text-body-sm text-on-surface-variant">—</span>
                    )}
                  </td>
                )}
                {showMoney && (
                  <td className="px-2 py-3 text-right text-label-md">
                    {kpis ? <Money amount={kpis.income} currency={baseCurrency!} tone="income" whole /> : '—'}
                  </td>
                )}
                <td className="py-3 pr-5 pl-2 text-right">
                  <HealthChip health={health} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Teléfono: lista */}
        <ul className="divide-y divide-outline-variant/30 md:hidden">
          {rows.map(({ property: p, health, kpis }) => (
            <li key={p.id}>
              <Link to={`/propiedades/${p.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-low">
                <PropertyImage photo={p.photos[0]} alt="" className="h-12 w-12 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-label-md text-primary">{p.name}</span>
                    <PropertyStatusBadge status={p.status} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-on-surface-variant">
                    {kpis && <span className="tabular">Ocupación {formatPercent(kpis.occupancy)}</span>}
                    {kpis && showMoney && <Money amount={kpis.income} currency={baseCurrency!} tone="income" whole className="text-label-md" />}
                    <HealthChip health={health} />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/propiedades" className="flex items-center justify-center gap-1 border-t border-outline-variant/40 py-3 text-label-md text-primary sm:hidden">
          Ver todas las propiedades <ArrowRight size={16} aria-hidden />
        </Link>
      </Card>
    </Section>
  );
}

// ───────────────────────── Mapa ─────────────────────────

const LEGEND: { label: string; dot: string }[] = [
  { label: PROPERTY_STATUS_LABEL.occupied, dot: 'bg-secondary' },
  { label: PROPERTY_STATUS_LABEL.vacant, dot: 'bg-primary' },
  { label: PROPERTY_STATUS_LABEL.maintenance, dot: 'bg-error' },
  { label: PROPERTY_STATUS_LABEL.blocked, dot: 'bg-outline' },
];

export function PortfolioMapSection({ properties, className }: { properties: DashboardProperty['property'][]; className?: string }) {
  const markers = useMemo(() => properties.map((p) => propertyMarker(p)), [properties]);
  return (
    <Section title="Mapa del portafolio" className={className}>
      <Card padding="none" className="overflow-hidden">
        <Suspense fallback={<Loading label="Cargando el mapa…" className="h-80" />}>
          <LazyMap markers={markers} className="h-80 rounded-none" ariaLabel="Mapa de las propiedades" />
        </Suspense>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-outline-variant/40 px-4 py-3" aria-label="Colores del mapa">
          {LEGEND.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
              <span className={cn('h-2.5 w-2.5 rounded-full', l.dot)} aria-hidden />
              {l.label}
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

// ───────────────────────── Entradas y salidas ─────────────────────────

function GroupTitle({ icon: Icon, children, count }: { icon: LucideIcon; children: ReactNode; count: number }) {
  return (
    <h3 className="mb-2 flex items-center gap-2 text-label-md text-on-surface-variant">
      <Icon size={16} aria-hidden />
      {children}
      <span className="rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-primary">{count}</span>
    </h3>
  );
}

const EnBadge = () => (
  <Badge tone="info">
    <abbr title="Habla inglés" className="no-underline">
      EN
    </abbr>
  </Badge>
);

function BookingRows({ bookings, kind }: { bookings: BookingView[]; kind: 'in' | 'out' }) {
  return (
    <ul className="space-y-2">
      {bookings.map((b) => (
        <li key={b.id}>
          <InfoRow
            to={`/reservas/${b.id}`}
            icon={kind === 'in' ? LogIn : LogOut}
            title={b.guestName}
            titleEnd={b.guestLanguage === 'en' ? <EnBadge /> : undefined}
            meta={`${kind === 'in' ? when(b.checkIn, b.today, b.checkInTime) : when(b.checkOut, b.today, b.checkOutTime)} · ${b.propertyName}`}
          />
        </li>
      ))}
    </ul>
  );
}

export function MovementsSection({
  arrivals,
  departures,
  className,
  title = 'Próximas entradas y salidas',
}: {
  arrivals: BookingView[];
  departures: BookingView[];
  className?: string;
  title?: string;
}) {
  return (
    <Section title={title} className={className}>
      <Card className="space-y-5">
        <div>
          <GroupTitle icon={LogIn} count={arrivals.length}>
            Entradas (48 h)
          </GroupTitle>
          {arrivals.length ? <BookingRows bookings={arrivals} kind="in" /> : <p className="text-body-sm text-on-surface-variant">Nadie llega en las próximas 48 horas.</p>}
        </div>
        <div>
          <GroupTitle icon={LogOut} count={departures.length}>
            Salidas (hoy y mañana)
          </GroupTitle>
          {departures.length ? <BookingRows bookings={departures} kind="out" /> : <p className="text-body-sm text-on-surface-variant">No hay salidas hoy ni mañana.</p>}
        </div>
      </Card>
    </Section>
  );
}

export function InHouseSection({ guests, className }: { guests: BookingView[]; className?: string }) {
  return (
    <Section title="Huéspedes en casa" className={className}>
      <Card>
        {guests.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">No hay huéspedes alojados ahora.</p>
        ) : (
          <ul className="space-y-2">
            {guests.map((b) => (
              <li key={b.id}>
                <InfoRow
                  to={`/reservas/${b.id}`}
                  icon={CalendarCheck}
                  title={b.guestName}
                  titleEnd={b.guestLanguage === 'en' ? <EnBadge /> : undefined}
                  meta={`Sale ${when(b.checkOut, b.today, b.checkOutTime).toLowerCase()} · ${b.propertyName}`}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  );
}

// ───────────────────────── Tareas de hoy ─────────────────────────

export function TodayTasksSection({ cleanings, orders, className }: { cleanings: CleaningTaskView[]; orders: OrderView[]; className?: string }) {
  const empty = cleanings.length === 0 && orders.length === 0;
  return (
    <Section title="Tareas de hoy" className={className} action={<SectionLink to="/operacion">Operación</SectionLink>}>
      <Card className="space-y-5">
        {empty ? (
          <p className="text-body-sm text-on-surface-variant">Nada pendiente para hoy.</p>
        ) : (
          <>
            {cleanings.length > 0 && (
              <div>
                <GroupTitle icon={SprayCan} count={cleanings.length}>
                  Limpiezas
                </GroupTitle>
                <ul className="space-y-2">
                  {cleanings.map((t) => (
                    <li key={t.id}>
                      <InfoRow
                        to={`/operacion/limpieza/${t.id}`}
                        icon={SprayCan}
                        title={t.propertyName}
                        badge={t.overdue ? <Badge tone="bad">Atrasada</Badge> : <CleaningStatusBadge status={t.status} />}
                        meta={`${t.overdue ? `Era para el ${formatDate(t.date)}` : formatTime(t.time)} · ${t.assigneeName ?? 'Sin asignar'} · ${CLEANING_TYPE_LABEL[t.type]}`}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {orders.length > 0 && (
              <div>
                <GroupTitle icon={Wrench} count={orders.length}>
                  Mantenimiento
                </GroupTitle>
                <OrderRows orders={orders} />
              </div>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

export function OrderRows({ orders }: { orders: OrderView[] }) {
  return (
    <ul className="space-y-2">
      {orders.map((o) => (
        <li key={o.id}>
          <InfoRow
            to={`/operacion/mantenimiento/${o.id}`}
            icon={Wrench}
            title={o.title}
            badge={<PriorityBadge priority={o.priority} />}
            meta={`${o.propertyName} · ${o.assigneeName ?? o.vendorName ?? 'Sin asignar'} · ${o.code}`}
          />
        </li>
      ))}
    </ul>
  );
}
