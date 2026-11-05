/**
 * Avisos (la campana): para todos los roles. Los guardados (eventos) y los que salen del estado
 * actual (urgencias, rentas atrasadas, documentos por vencer, limpiezas…), sin leer primero.
 * Tocar un aviso lo marca como leído y lleva a lo que avisa.
 */
import type { LucideIcon } from 'lucide-react';
import { BadgeDollarSign, BellOff, CalendarCheck, CheckCheck, ChevronRight, FileWarning, MessageSquare, RefreshCcw, Siren, SprayCan, TriangleAlert, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLiveResult } from '@/data/live';
import { NOTIFICATION_KIND_LABEL } from '@/domain/labels';
import type { NotificationKind } from '@/domain/types';
import { clock } from '@/lib/clock';
import { timeAgo } from '@/lib/dates';
import { svc, type NotificationView } from '@/services';
import { Button, cn, EmptyState, ErrorState, Loading, PageHeader } from '@/ui';

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  urgent: Siren,
  payment: Wallet,
  document: FileWarning,
  cleaning: SprayCan,
  booking: CalendarCheck,
  approval: BadgeDollarSign,
  message: MessageSquare,
  incident: TriangleAlert,
  renewal: RefreshCcw,
};

const TONE_CLASS: Record<NotificationView['tone'], string> = {
  urgent: 'bg-error-container text-on-error-container',
  warn: 'bg-warning-container text-on-warning-container',
  good: 'bg-secondary-container text-on-secondary-container',
  info: 'bg-info-container text-on-info-container',
};

export default function NotificationsPage() {
  const actor = useActor();
  const run = useAction();
  const navigate = useNavigate();
  const res = useLiveResult(() => svc.system.listNotifications(actor), [actor]);
  const list = res.data;

  if (res.error && !list) return <ErrorState error={res.error} />;
  if (!list) return <Loading />;

  const unread = list.filter((n) => !n.read);
  const read = list.filter((n) => n.read);
  const now = clock.now();

  const openItem = async (n: NotificationView) => {
    if (!n.read) await run(() => svc.system.markNotificationRead(actor, n.id));
    if (n.link) navigate(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="avisos">
      <PageHeader
        title="Avisos"
        subtitle={unread.length ? `${unread.length} sin leer. Toca uno para ir a lo que avisa.` : 'Estás al día.'}
        actions={
          unread.length > 0 &&
          !actor.readOnly && (
            <Button variant="secondary" icon={CheckCheck} onClick={() => run(() => svc.system.markAllNotificationsRead(actor), { success: 'Todo marcado como leído.' })} data-testid="marcar-todo-leido">
              Marcar todo como leído
            </Button>
          )
        }
      />

      {list.length === 0 ? (
        <EmptyState icon={BellOff} title="No tienes avisos" body="Aquí aparecen las urgencias, los pagos, los vencimientos y lo que te asignen." />
      ) : (
        <>
          <Group title="Sin leer" count={unread.length} items={unread} now={now} onOpen={openItem} empty="Nada nuevo por ahora." />
          {read.length > 0 && <Group title="Leídos" count={read.length} items={read} now={now} onOpen={openItem} />}
        </>
      )}
    </div>
  );
}

function Group({ title, count, items, now, onOpen, empty }: { title: string; count: number; items: NotificationView[]; now: ReturnType<typeof clock.now>; onOpen: (n: NotificationView) => void; empty?: string }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="flex items-center gap-2 text-label-sm tracking-wider text-on-surface-variant uppercase">
        {title}
        <span className="rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-on-surface-variant">{count}</span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-outline-variant px-4 py-5 text-center text-body-sm text-on-surface-variant">{empty}</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-lowest shadow-card">
          {items.map((n, i) => {
            const Icon = KIND_ICON[n.kind];
            return (
              <li key={n.id} className={cn(i > 0 && 'border-t border-outline-variant/40')}>
                <button
                  type="button"
                  onClick={() => onOpen(n)}
                  className={cn('flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-low md:px-5', !n.read && 'bg-surface-low/50')}
                  data-testid={`aviso-${n.id}`}
                >
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', TONE_CLASS[n.tone])} role="img" aria-label={NOTIFICATION_KIND_LABEL[n.kind]}>
                    <Icon size={20} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-3">
                      <span className={cn('text-label-md', n.read ? 'text-on-surface' : 'text-primary')}>
                        {n.title}
                        <span className="sr-only">{n.read ? ' (leído)' : ' (sin leer)'}</span>
                      </span>
                      <span className="shrink-0 text-label-sm font-normal text-on-surface-variant">{timeAgo(n.at, now)}</span>
                    </span>
                    <span className="mt-0.5 block text-body-sm text-on-surface-variant">{n.body}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-center gap-2 self-center">
                    {!n.read && <span className="h-2.5 w-2.5 rounded-full bg-secondary" aria-hidden />}
                    {n.link && <ChevronRight size={18} className="text-on-surface-variant" aria-hidden />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
