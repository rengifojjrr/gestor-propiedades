/** Tarjetas de la columna derecha: bandeja, indicadores de atención y «WhatsApp y correo: próximamente». */
import { ArrowRight, Inbox, Mail, MessageCircle } from 'lucide-react';
import { formatPercent } from '@/lib/money';
import type { EngagementStats, ThreadView } from '@/services';
import { Badge, Card, LinkButton } from '@/ui';
import { formatWait, previewText } from './text';

export function InboxCard({ unread }: { unread?: ThreadView[] }) {
  const count = unread?.reduce((s, t) => s + t.unreadTeam, 0) ?? 0;
  return (
    <Card padding="lg" as="section" aria-label="Bandeja de mensajes">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-headline-md text-primary">Bandeja de mensajes</h2>
          <p className="text-body-sm text-on-surface-variant">{count ? `${count} ${count === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}` : 'Todo leído'}</p>
        </div>
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-container text-primary">
          <Inbox size={22} aria-hidden />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-label-sm text-on-error" aria-hidden>
              {count > 9 ? '9+' : count}
            </span>
          )}
        </span>
      </div>
      {!!unread?.length && (
        <ul className="mt-3 space-y-1">
          {unread.slice(0, 3).map((t) => (
            <li key={t.id} className="truncate text-body-sm text-on-surface">
              <span className="font-semibold">{t.personName.split(' ')[0]}:</span> <span className="text-on-surface-variant">{previewText(t.lastMessagePreview)}</span>
            </li>
          ))}
        </ul>
      )}
      <LinkButton to="/mensajes" variant="secondary" iconRight={ArrowRight} fullWidth className="mt-4" data-testid="abrir-bandeja">
        Abrir la bandeja
      </LinkButton>
    </Card>
  );
}

export function EngagementCard({ stats }: { stats?: EngagementStats }) {
  const rows: [string, string][] = [
    ['Tasa de respuesta', stats ? formatPercent(stats.responseRate, 1) : '—'],
    ['Espera promedio', stats ? formatWait(stats.avgWaitMinutes) : '—'],
    ['Conversaciones activas', stats ? String(stats.activeChats) : '—'],
    ['Sin leer', stats ? String(stats.unread) : '—'],
  ];
  return (
    <Card tone="dark" padding="lg" as="section" aria-label="Indicadores de atención" data-testid="indicadores-atencion">
      <h2 className="mb-4 text-label-md tracking-widest text-on-primary-container-muted uppercase">Indicadores de atención</h2>
      <dl className="space-y-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-end justify-between gap-3 border-b border-on-primary-container/10 pb-2 last:border-b-0 last:pb-0">
            <dt className="text-body-md">{label}</dt>
            <dd className="text-headline-md tabular">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-label-sm font-normal text-on-primary-container-muted">Respuesta: cada mensaje de un huésped o inquilino contra la siguiente respuesta del equipo. Activas: con mensajes en los últimos 7 días.</p>
    </Card>
  );
}

export function ComingSoonCard() {
  return (
    <Card tone="muted" padding="lg" as="section" aria-label="WhatsApp y correo: próximamente">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-lowest text-primary shadow-card">
          <MessageCircle size={20} aria-hidden />
        </span>
        <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-lowest text-primary shadow-card">
          <Mail size={20} aria-hidden />
        </span>
        <Badge tone="warn" className="ml-auto">
          Próximamente
        </Badge>
      </div>
      <h2 className="mt-3 text-headline-md text-primary">WhatsApp y correo: próximamente</h2>
      <p className="mt-1 text-body-sm text-on-surface-variant">Hoy todo queda dentro de la app: los huéspedes e inquilinos leen y responden desde su propia app, en español o en inglés.</p>
    </Card>
  );
}
