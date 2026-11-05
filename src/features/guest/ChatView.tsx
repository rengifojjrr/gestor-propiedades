/**
 * Chat del huésped o inquilino con atención al cliente (lo comparten las dos apps).
 * Marca como leído al abrir, letra grande y todo en el idioma de la persona.
 */
import { Headset, Lock, MessageSquare, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLiveResult } from '@/data/live';
import { clock } from '@/lib/clock';
import { useLang } from '@/lib/i18n';
import { svc } from '@/services';
import { Banner, Button, Card, cn, EmptyState, ErrorState, Loading } from '@/ui';
import { ChatMessages } from './ChatMessages';
import { bigControl } from './fields';
import { CHAT, COMMON, makeT } from './i18n';

export function ChatView() {
  const actor = useActor();
  const res = useLiveResult(() => svc.people.myThread(actor), [actor]);
  const data = res.data;
  const thread = data?.thread;
  const [lang] = useLang(thread?.personLanguage ?? 'es');
  const t = makeT(CHAT, lang);
  const tc = makeT(COMMON, lang);
  const [text, setText] = useState('');
  const [run, busy] = useBusyAction();
  const endRef = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;

  // Al abrir (y si llega algo nuevo), queda leído para la persona.
  const unread = thread?.unreadPerson ?? 0;
  const threadId = thread?.id;
  useEffect(() => {
    if (threadId && unread > 0) void svc.people.markThreadRead(actor, threadId).catch(() => undefined);
  }, [actor, threadId, unread]);

  useEffect(() => {
    if (count) endRef.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  if (res.loading && !data) return <Loading label={tc('loading')} />;
  if (res.error && !data) return <ErrorState error={tc('loadError')} />;

  const send = async () => {
    const body = text.trim();
    if (!body || !thread) return;
    const sent = await run(() => svc.people.sendMessage(actor, thread.id, body));
    if (sent) setText('');
  };

  return (
    <div className="space-y-4" lang={lang}>
      <header>
        <h1 className="text-headline-lg text-primary md:text-headline-xl">{t('title')}</h1>
        <p className="mt-1 text-body-lg text-on-surface-variant">{t('subtitle')}</p>
      </header>

      {!data ? (
        <EmptyState icon={MessageSquare} title={t('noThreadTitle')} body={t('noThreadBody')} />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-outline-variant/50 px-4 py-3 md:px-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
              <Headset size={22} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-headline-md text-primary">{t('team')}</p>
              <p className="truncate text-body-sm text-on-surface-variant">
                {t('about', { property: data.thread.propertyName, code: data.thread.bookingCode ?? data.thread.leaseCode ?? '' })}
              </p>
            </div>
          </div>

          <div className="px-3 py-4 md:px-5">
            <ChatMessages messages={data.messages} viewer="person" lang={lang} now={clock.now()} large />
          </div>

          {actor.readOnly ? (
            <div className="border-t border-outline-variant/50 p-3">
              <Banner tone="warn" icon={Lock}>
                {tc('viewOnly')}
              </Banner>
            </div>
          ) : (
            <form
              className="flex items-end gap-2 border-t border-outline-variant/50 bg-surface-low p-3 md:p-4"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="chat-text">
                {t('messageLabel')}
              </label>
              <textarea
                id="chat-text"
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={t('placeholder')}
                maxLength={4000}
                className={cn(bigControl, 'min-h-14 flex-1 resize-y py-3')}
              />
              <Button type="submit" size="lg" icon={Send} loading={busy} disabled={!text.trim()} aria-label={t('send')} className="px-4 md:px-6">
                <span className="hidden sm:inline">{t('send')}</span>
              </Button>
            </form>
          )}
        </Card>
      )}

      <p className="flex items-start gap-2 px-1 text-body-sm text-on-surface-variant">
        <Lock size={16} className="mt-0.5 shrink-0" aria-hidden />
        {t('footnote')}
      </p>
      {/* Al abrir se baja hasta aquí: quedan a la vista los últimos mensajes y el redactor. */}
      <div ref={endRef} className="scroll-mb-36" aria-hidden />
    </div>
  );
}
