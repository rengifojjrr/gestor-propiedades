/**
 * Huéspedes y mensajes (pantalla de Stitch): registro de huéspedes en casa, por llegar y recientes,
 * inquilinos, «Enviar a todos», plantillas ES/EN, indicadores de atención y la bandeja.
 */
import { ChevronDown, ChevronUp, Inbox, Megaphone, UserRound, Users } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { can, svc } from '@/services';
import { Button, EmptyState, LinkButton, Loading, PageHeader, SearchInput, Tabs } from '@/ui';
import { BroadcastModal } from './BroadcastModal';
import { useSubject } from './hooks';
import { GuestCard, TenantCard } from './PeopleCards';
import { ComingSoonCard, EngagementCard, InboxCard } from './SideCards';
import { TemplatesCard } from './TemplatesCard';
import type { Stage } from './text';

type StageFilter = 'all' | Stage;

/** Cuántos huéspedes se ven antes de «Ver todos». */
const PAGE = 8;

export default function GuestsMessagesPage() {
  const actor = useActor();
  const subject = useSubject();
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const [stage, setStage] = useState<StageFilter>('all');
  const [showAll, setShowAll] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const rows = useLive(() => svc.people.guestRegistry(actor, query), [actor, query]);
  const tenants = useLive(() => svc.people.listPeople(actor, { kind: 'tenant', q: query }), [actor, query]);
  const threads = useLive(() => svc.people.listThreads(actor), [actor]);
  const leases = useLive(() => svc.leases.listLeases(actor), [actor]);
  const stats = useLive(() => svc.people.engagementStats(actor), [actor]);

  const canSend = !!subject && can(subject, 'message.send');
  const canBroadcast = !!subject && can(subject, 'message.broadcast');
  const canTemplates = !!subject && can(subject, 'template.write');
  const unreadThreads = threads?.filter((t) => t.unreadTeam > 0);
  const unread = unreadThreads?.reduce((s, t) => s + t.unreadTeam, 0) ?? 0;

  const count = (s: Stage) => rows?.filter((r) => r.stage === s).length ?? 0;
  const visible = rows?.filter((r) => stage === 'all' || r.stage === stage);
  const shown = showAll ? visible : visible?.slice(0, PAGE);

  return (
    <div>
      <PageHeader
        title="Huéspedes y mensajes"
        subtitle="Quién está en casa, quién llega y quién se fue, con sus conversaciones."
        actions={
          <>
            {canBroadcast && (
              <Button icon={Megaphone} onClick={() => setBroadcastOpen(true)} data-testid="enviar-a-todos">
                Enviar a todos
              </Button>
            )}
            <LinkButton to="/mensajes" variant="secondary" icon={Inbox}>
              <span className="sm:hidden">Bandeja</span>
              <span className="hidden sm:inline">Bandeja de mensajes</span>
              {unread ? ` (${unread})` : ''}
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-8 lg:col-span-8">
          <section className="space-y-4" aria-label="Huéspedes">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-headline-md text-primary">Huéspedes</h2>
              <SearchInput value={q} onChange={setQ} placeholder="Buscar huésped, propiedad o código…" label="Buscar huéspedes e inquilinos" className="sm:w-80" />
            </div>
            <Tabs
              ariaLabel="Etapa de la estadía"
              value={stage}
              onChange={(v) => {
                setStage(v);
                setShowAll(false);
              }}
              tabs={[
                { id: 'all', label: 'Todos', count: rows?.length ?? 0 },
                { id: 'active', label: 'En casa', count: count('active') },
                { id: 'upcoming', label: 'Por llegar', count: count('upcoming') },
                { id: 'past', label: 'Se fueron', count: count('past') },
              ]}
            />
            {!visible ? (
              <Loading />
            ) : !visible.length ? (
              <EmptyState
                icon={UserRound}
                title={q ? 'Nadie coincide con la búsqueda' : 'No hay huéspedes en esta etapa'}
                body="Aquí aparecen los que están en casa, los que llegan en los próximos 30 días y los que se fueron hace menos de 2 semanas."
              />
            ) : (
              <div className="space-y-3">
                {shown?.map((r) => (
                  <GuestCard key={r.bookingId} row={r} canSend={canSend} />
                ))}
                {visible.length > PAGE && (
                  <Button variant="tonal" fullWidth icon={showAll ? ChevronUp : ChevronDown} onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Ver menos' : `Ver todos (${visible.length - PAGE} más)`}
                  </Button>
                )}
              </div>
            )}
          </section>

          <section className="space-y-4" aria-label="Inquilinos">
            <h2 className="flex items-center gap-2 text-headline-md text-primary">
              Inquilinos
              {tenants && <span className="rounded-full bg-surface-container px-2 text-label-sm text-on-surface-variant">{tenants.length}</span>}
            </h2>
            {!tenants ? (
              <Loading />
            ) : !tenants.length ? (
              <EmptyState icon={Users} title={q ? 'Ningún inquilino coincide' : 'No hay inquilinos'} />
            ) : (
              <div className="space-y-3">
                {tenants.map((p) => (
                  <TenantCard
                    key={p.id}
                    person={p}
                    canSend={canSend}
                    thread={threads?.find((t) => t.personId === p.id && (p.lease ? t.leaseId === p.lease.id : true))}
                    lease={leases?.find((l) => l.tenantId === p.id && l.status === 'active')}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-6 lg:col-span-4" aria-label="Plantillas e indicadores">
          <InboxCard unread={unreadThreads} />
          <TemplatesCard canWrite={canTemplates} />
          <EngagementCard stats={stats} />
          <ComingSoonCard />
        </aside>
      </div>

      {canBroadcast && <BroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />}
    </div>
  );
}
