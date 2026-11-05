/**
 * Conversación del equipo con un huésped o inquilino: encabezado con la persona, la propiedad y los
 * links a la reserva o al contrato; burbujas; y el redactor con plantillas ES/EN. Se usa como página
 * completa (/mensajes/:id) o como panel dentro de la bandeja en la computadora.
 */
import { CalendarDays, FileSignature, Lock, Maximize2, Send, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useBusyAction } from '@/app/hooks';
import { useActor, useSession } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import type { Lang } from '@/domain/types';
import { ChatMessages } from '@/features/guest/ChatMessages';
import { clock } from '@/lib/clock';
import { formatRange } from '@/lib/dates';
import { can, svc, type ThreadView } from '@/services';
import { Avatar, Badge, Banner, Button, Card, cn, ErrorState, LinkButton, Loading, PageHeader, Select, TextArea } from '@/ui';
import { useSubject } from './hooks';
import { SPEAKS, STAGE_LABEL, STAGE_TONE, tidyText } from './text';

function LangSwitch({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex shrink-0 rounded-full bg-surface-container p-0.5" role="group" aria-label="Idioma del mensaje">
      {(['es', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={value === l}
          onClick={() => onChange(l)}
          className={cn('h-9 rounded-full px-3 text-label-md uppercase', value === l ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Redactor: plantilla (se rellena con los datos de la conversación), idioma y envío. */
function Composer({ thread, compact }: { thread: ThreadView; compact?: boolean }) {
  const actor = useActor();
  const templates = useLive(() => svc.people.listTemplates(actor), [actor]);
  const [lang, setLang] = useState<Lang>(thread.personLanguage);
  const [templateId, setTemplateId] = useState('');
  const [rendered, setRendered] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [run, busy] = useBusyAction();
  const area = useRef<HTMLTextAreaElement>(null);

  const fill = async (id: string, l: Lang) => {
    const raw = await run(() => svc.people.renderForThread(actor, id, thread.id, l));
    if (raw === undefined) return;
    const body = tidyText(raw);
    setText(body);
    setRendered(body);
    area.current?.focus();
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    const tpl = templates?.find((x) => x.id === templateId);
    const msg = await run(() => svc.people.sendMessage(actor, thread.id, body, tpl?.key));
    if (!msg) return;
    setText('');
    setTemplateId('');
    setRendered(null);
  };

  return (
    <form
      className="space-y-2 border-t border-outline-variant/50 bg-surface-low p-3 md:p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select
            aria-label="Usar una plantilla"
            value={templateId}
            placeholder="Plantilla…"
            options={(templates ?? []).map((x) => ({ value: x.id, label: x.name }))}
            onChange={(e) => {
              const id = e.target.value;
              setTemplateId(id);
              if (id) void fill(id, lang);
              else setRendered(null);
            }}
            data-testid="plantilla-mensaje"
          />
        </div>
        <LangSwitch
          value={lang}
          onChange={(l) => {
            setLang(l);
            if (templateId && (text === rendered || !text.trim())) void fill(templateId, l);
          }}
        />
      </div>
      <div className="flex items-end gap-2">
        <TextArea
          ref={area}
          aria-label={`Mensaje para ${thread.personName}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
          rows={compact ? 2 : 3}
          maxLength={4000}
          placeholder={`Escribe a ${thread.personName.split(' ')[0]}… (${SPEAKS[thread.personLanguage].toLowerCase()})`}
          className={cn('flex-1 resize-y', compact ? 'min-h-16' : 'min-h-24')}
          data-testid="texto-mensaje"
        />
        <Button type="submit" icon={Send} loading={busy} disabled={!text.trim()} data-testid="enviar-mensaje">
          <span className="hidden sm:inline">Enviar</span>
          <span className="sr-only sm:hidden">Enviar</span>
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-label-sm font-normal text-on-surface-variant">
        <Lock size={13} className="shrink-0" aria-hidden />
        Se envía dentro de la app. WhatsApp y correo: próximamente.
      </p>
    </form>
  );
}

function ThreadLinks({ thread, size = 'sm' }: { thread: ThreadView; size?: 'sm' | 'md' }) {
  const { user } = useSession();
  const seesLeases = user?.role === 'owner' || user?.role === 'admin';
  return (
    <>
      <LinkButton to={`/personas/${thread.personId}`} variant="secondary" size={size} icon={UserRound}>
        Ver ficha
      </LinkButton>
      {thread.bookingId && (
        <LinkButton to={`/reservas/${thread.bookingId}`} variant="secondary" size={size} icon={CalendarDays}>
          Reserva {thread.bookingCode}
        </LinkButton>
      )}
      {thread.leaseId && seesLeases && (
        <LinkButton to={`/contratos/${thread.leaseId}`} variant="secondary" size={size} icon={FileSignature}>
          Contrato {thread.leaseCode}
        </LinkButton>
      )}
    </>
  );
}

export function ThreadPanel({ threadId, layout }: { threadId: string; layout: 'page' | 'pane' }) {
  const actor = useActor();
  const res = useLiveResult(() => svc.people.getThread(actor, threadId), [actor, threadId]);
  const subject = useSubject();
  const thread = res.data?.thread;
  const messages = res.data?.messages;
  const bookingId = thread?.bookingId;
  const booking = useLive(() => (bookingId ? svc.bookings.getBooking(actor, bookingId).catch(() => null) : Promise.resolve(null)), [actor, bookingId]);
  const canSend = !!thread && !!subject && can(subject, 'message.send', { propertyId: thread.propertyId, personId: thread.personId });

  // Al abrir (o si llega algo mientras está abierta), queda leída para el equipo.
  const unread = thread?.unreadTeam ?? 0;
  useEffect(() => {
    if (unread > 0) void svc.people.markThreadRead(actor, threadId).catch(() => undefined);
  }, [actor, threadId, unread]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const count = messages?.length ?? 0;
  useEffect(() => {
    if (!count) return;
    if (layout === 'pane') {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else endRef.current?.scrollIntoView({ block: 'end' });
  }, [count, layout, threadId]);

  if (!res.data) {
    if (res.error) return <ErrorState error={res.error} className={layout === 'pane' ? 'm-4' : undefined} />;
    return <Loading label="Abriendo la conversación…" />;
  }
  const t = res.data.thread;
  const where = [t.propertyName, t.propertyCity, booking ? `${formatRange(booking.checkIn, booking.checkOut)} · ${booking.nights} noches` : null].filter(Boolean).join(' · ');
  const chips = (
    <span className="flex flex-wrap items-center gap-1.5">
      {t.stage && <Badge tone={STAGE_TONE[t.stage]}>{t.leaseId ? 'Inquilino' : STAGE_LABEL[t.stage]}</Badge>}
      <Badge tone="neutral">{SPEAKS[t.personLanguage]}</Badge>
    </span>
  );
  const body = <ChatMessages messages={res.data.messages} viewer="team" lang="es" now={clock.now()} />;
  const composer = canSend ? (
    <Composer key={t.id} thread={t} compact={layout === 'pane'} />
  ) : (
    <div className="border-t border-outline-variant/50 p-3">
      <Banner tone="warn" icon={Lock}>
        Solo mirar: desde aquí no se pueden enviar mensajes.
      </Banner>
    </div>
  );

  if (layout === 'pane')
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-start gap-3 border-b border-outline-variant/50 px-4 py-3">
          <Avatar name={t.personName} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link to={`/personas/${t.personId}`} className="truncate text-headline-md text-primary hover:underline">
                {t.personName}
              </Link>
              {chips}
            </div>
            <p className="truncate text-body-sm text-on-surface-variant">{where}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <ThreadLinks thread={t} />
              <LinkButton to={`/mensajes/${t.id}`} variant="ghost" size="sm" icon={Maximize2}>
                Pantalla completa
              </LinkButton>
            </div>
          </div>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {body}
        </div>
        {composer}
      </div>
    );

  return (
    <div className="space-y-4">
      <PageHeader
        back="/mensajes"
        eyebrow={chips}
        title={t.personName}
        subtitle={where}
        actions={<ThreadLinks thread={t} size="md" />}
      />
      <Card padding="none" className="overflow-hidden">
        <div className="px-3 py-4 md:px-5">{body}</div>
        {composer}
      </Card>
      {/* Al abrir se baja hasta aquí: quedan a la vista los últimos mensajes y el redactor. */}
      <div ref={endRef} className="scroll-mb-36" aria-hidden />
    </div>
  );
}
