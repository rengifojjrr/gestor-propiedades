/**
 * Bandeja de mensajes: todas las conversaciones (por reserva o contrato), con búsqueda y «Sin leer».
 * En la computadora: lista + conversación al lado. En el teléfono: la lista abre cada conversación.
 */
import { Inbox, MessageSquareText, Users } from 'lucide-react';
import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { clock } from '@/lib/clock';
import { timeAgo } from '@/lib/dates';
import { svc, type ThreadView } from '@/services';
import { Avatar, Card, cn, EmptyState, LinkButton, Loading, PageHeader, SearchInput, Tabs } from '@/ui';
import { useMediaQuery } from './hooks';
import { ThreadPanel } from './ThreadPanel';

function ThreadRow({ t, active, onSelect }: { t: ThreadView; active?: boolean; onSelect?: () => void }) {
  const unread = t.unreadTeam > 0;
  const content = (
    <>
      <Avatar name={t.personName} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-label-md', unread ? 'font-extrabold text-primary' : 'text-on-surface')}>{t.personName}</span>
          <span className="shrink-0 text-label-sm font-normal text-on-surface-variant">{timeAgo(t.lastMessageAt, clock.now())}</span>
        </span>
        <span className="block truncate text-body-sm text-on-surface-variant">
          {t.propertyName}
          {(t.bookingCode ?? t.leaseCode) && ` · ${t.bookingCode ?? t.leaseCode}`}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={cn('line-clamp-1 text-body-sm', unread ? 'font-semibold text-on-surface' : 'text-on-surface-variant', !t.lastMessagePreview && 'italic')}>
            {t.lastMessagePreview || 'Sin mensajes todavía'}
          </span>
          {unread && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-error px-1.5 text-label-sm text-on-error" aria-label={`${t.unreadTeam} sin leer`}>
              {t.unreadTeam}
            </span>
          )}
        </span>
      </span>
    </>
  );
  const cls = cn(
    'flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors',
    active ? 'bg-secondary-container/50' : 'hover:bg-surface-low',
  );
  if (onSelect)
    return (
      <button type="button" onClick={onSelect} className={cls} aria-current={active ? 'true' : undefined} data-testid={`hilo-${t.id}`}>
        {content}
      </button>
    );
  return (
    <Link to={`/mensajes/${t.id}`} className={cls} data-testid={`hilo-${t.id}`}>
      {content}
    </Link>
  );
}

export default function InboxPage() {
  const actor = useActor();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 1024px)');
  const threads = useLive(() => svc.people.listThreads(actor, { q: query, unreadOnly: tab === 'unread' }), [actor, query, tab]);
  const unreadThreads = useLive(() => svc.people.listThreads(actor, { unreadOnly: true }), [actor]);
  const selected = params.get('c');

  // En la computadora queda elegida la conversación más reciente (una sola vez: no salta sola).
  const first = threads?.[0]?.id;
  useEffect(() => {
    if (wide && !selected && first) setParams({ c: first }, { replace: true });
  }, [wide, selected, first, setParams]);

  const list = !threads ? (
    <Loading />
  ) : !threads.length ? (
    <EmptyState
      icon={Inbox}
      title={tab === 'unread' ? 'No hay mensajes sin leer' : 'No hay conversaciones'}
      body={q ? 'Prueba con otra búsqueda.' : tab === 'unread' ? 'Todo respondido. ¡Bien!' : 'Cuando un huésped o inquilino escriba, aparece aquí.'}
      className="border-none"
    />
  ) : (
    <ul className="space-y-1" aria-label="Conversaciones">
      {threads.map((t) => (
        <li key={t.id}>
          <ThreadRow t={t} active={wide && t.id === selected} onSelect={wide ? () => setParams({ c: t.id }) : undefined} />
        </li>
      ))}
    </ul>
  );

  const unreadCount = unreadThreads?.length ?? 0;
  const filters = (
    <div className="space-y-3">
      <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, propiedad o mensaje…" label="Buscar conversaciones" />
      <Tabs
        ariaLabel="Filtrar conversaciones"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'all', label: 'Todas' },
          { id: 'unread', label: 'Sin leer', count: unreadCount },
        ]}
      />
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Mensajes"
        subtitle="Todas las conversaciones con huéspedes e inquilinos, en un solo lugar."
        actions={
          <LinkButton to="/huespedes" variant="secondary" icon={Users}>
            Huéspedes y plantillas
          </LinkButton>
        }
      />
      {wide ? (
        <Card padding="none" className="grid h-[calc(100dvh-13rem)] min-h-[560px] grid-cols-[minmax(300px,380px)_1fr] overflow-hidden">
          <div className="flex min-h-0 flex-col border-r border-outline-variant/50">
            <div className="border-b border-outline-variant/50 p-3">{filters}</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">{list}</div>
          </div>
          <div className="min-h-0">
            {selected ? (
              <ThreadPanel key={selected} threadId={selected} layout="pane" />
            ) : (
              <EmptyState icon={MessageSquareText} title="Elige una conversación" body="Toca una conversación de la lista para leerla y responder." className="m-6 border-none" />
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {filters}
          <Card padding="sm">{list}</Card>
        </div>
      )}
    </div>
  );
}
