/**
 * Burbujas de una conversación. La usan el equipo (sus mensajes a la derecha, en marino) y el
 * huésped o inquilino (los suyos a la derecha). Los avisos del sistema van al centro, pequeños.
 */
import { FileText, Megaphone } from 'lucide-react';
import type { DateTime } from 'luxon';
import { Fragment } from 'react';
import type { Lang, Message } from '@/domain/types';
import { cn } from '@/ui';
import { fChatDay, fClock, firstName } from './format';
import { CHAT, makeT } from './i18n';

export interface ChatMessagesProps {
  messages: Message[];
  /** Quién mira la conversación. */
  viewer: 'team' | 'person';
  lang: Lang;
  now: DateTime;
  /** Letra más grande (app del huésped e inquilino). */
  large?: boolean;
  className?: string;
}

export function ChatMessages({ messages, viewer, lang, now, large, className }: ChatMessagesProps) {
  const t = makeT(CHAT, lang);
  if (!messages.length)
    return <p className={cn('py-10 text-center text-body-md text-on-surface-variant', className)}>{t('empty')}</p>;

  return (
    <ol className={cn('flex flex-col gap-3', className)} aria-label={t('title')}>
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const day = fChatDay(m.at, now, lang);
        const showDay = !prev || fChatDay(prev.at, now, lang) !== day;
        const separator = showDay && (
          <li className="flex justify-center pt-1" aria-hidden>
            <span className="rounded-full bg-surface-container px-3 py-1 text-label-sm text-on-surface-variant">{day}</span>
          </li>
        );

        if (m.author.kind === 'system')
          return (
            <Fragment key={m.id}>
              {separator}
              <li className="flex justify-center">
                <p className="max-w-[90%] rounded-md bg-surface-container px-3 py-1.5 text-center text-label-sm font-normal text-on-surface-variant">
                  <span className="font-semibold">{t('system')}:</span> {m.body} · {fClock(m.at, lang)}
                </p>
              </li>
            </Fragment>
          );

        const mine = viewer === 'team' ? m.author.kind === 'team' : m.author.kind === 'person';
        const author =
          m.author.kind === 'team'
            ? viewer === 'team'
              ? m.author.name
              : `${t('team')} · ${firstName(m.author.name)}`
            : viewer === 'person'
              ? t('you')
              : m.author.name;
        return (
          <Fragment key={m.id}>
            {separator}
            <li className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div className={cn('flex max-w-[86%] flex-col md:max-w-[72%]', mine ? 'items-end' : 'items-start')}>
                <div
                  className={cn(
                    'rounded-lg px-4 py-2.5 break-words whitespace-pre-wrap shadow-card',
                    large ? 'text-body-lg' : 'text-body-md',
                    mine ? 'rounded-br-sm bg-primary text-on-primary' : 'rounded-bl-sm bg-surface-low text-on-surface',
                  )}
                >
                  {m.body}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-label-sm font-normal text-on-surface-variant">
                  <span className="font-semibold">{author}</span>
                  <span aria-hidden>·</span>
                  <time dateTime={m.at}>{fClock(m.at, lang)}</time>
                  {m.broadcastId && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden>·</span>
                      <Megaphone size={12} aria-hidden />
                      {t('toAll')}
                    </span>
                  )}
                  {viewer === 'team' && m.templateKey && !m.broadcastId && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden>·</span>
                      <FileText size={12} aria-hidden />
                      {t('template')}
                    </span>
                  )}
                </p>
              </div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
