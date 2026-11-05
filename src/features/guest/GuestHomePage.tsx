/**
 * App del huésped: su estadía (la actual, la próxima o la última), cómo llegar, instrucciones,
 * códigos (solo durante la estadía), manual de la casa y atajos a mensajes y reportes. ES/EN.
 */
import type { LucideIcon } from 'lucide-react';
import {
  BedDouble,
  BookOpen,
  CalendarCheck,
  CalendarX,
  Copy,
  DoorOpen,
  ExternalLink,
  Fence,
  KeyRound,
  Lock,
  MessageSquare,
  Moon,
  Navigation,
  ShieldAlert,
  Siren,
  Wifi,
} from 'lucide-react';
import { Suspense } from 'react';
import { Link } from 'react-router';
import { useActor } from '@/app/session';
import { useLiveResult } from '@/data/live';
import type { AccessCodeView, Lang } from '@/domain/types';
import { diffDays } from '@/lib/dates';
import { useLang } from '@/lib/i18n';
import { svc, type GuestHome } from '@/services';
import { Badge, buttonClass, Card, EmptyState, ErrorState, LazyMap, Loading, useToast, type Tone } from '@/ui';
import { fDate, fDateLong, firstName, fRange, fTime, mapsUrl } from './format';
import { CODE_KIND, COMMON, GUEST, makeT } from './i18n';
import { HeroChip, InfoCard, PersonHero } from './PersonHero';

const CODE_ICON: Record<AccessCodeView['kind'], LucideIcon> = { door: DoorOpen, lockbox: KeyRound, gate: Fence, alarm: ShieldAlert, wifi: Wifi };

type Home = GuestHome & { booking: NonNullable<GuestHome['booking']>; property: NonNullable<GuestHome['property']> };

function CopyButton({ value, what, lang }: { value: string; what: string; lang: Lang }) {
  const toast = useToast();
  const tc = makeT(COMMON, lang);
  const label = tc('copyWhat', { what });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        navigator.clipboard
          ?.writeText(value)
          .then(() => toast.success(`${tc('copied')}: ${what}`))
          .catch(() => undefined);
      }}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-primary-container transition-colors hover:bg-on-primary-container/15"
    >
      <Copy size={20} aria-hidden />
    </button>
  );
}

function CodesCard({ home, lang }: { home: Home; lang: Lang }) {
  const t = makeT(GUEST, lang);
  const visible = home.codes.some((c) => c.value);
  const keys = home.codes.filter((c) => c.kind !== 'wifi');
  const wifi = home.codes.filter((c) => c.kind === 'wifi');
  const range = fRange(home.booking.checkIn, home.booking.checkOut, lang);
  return (
    <Card tone="dark" padding="lg" as="section" aria-label={t('codesTitle')} data-testid="codigos">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
          <KeyRound size={22} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-headline-md">{t('codesTitle')}</h2>
          <p className="text-body-sm text-on-primary-container-muted">{t('codesHint')}</p>
        </div>
      </div>

      {!home.codes.length ? (
        <p className="mt-4 text-body-lg">{t('codesNone')}</p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {keys.map((c) => {
              const Icon = CODE_ICON[c.kind];
              const kind = CODE_KIND[lang][c.kind];
              return (
                <div key={c.id} className="rounded-md bg-on-primary-container/10 p-4">
                  <p className="flex items-center gap-2 text-label-md text-on-primary-container-muted">
                    <Icon size={18} aria-hidden />
                    <span className="truncate">{kind}</span>
                  </p>
                  {c.value ? (
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <span className="tabular font-mono text-headline-xl tracking-[0.12em] break-all">{c.value}</span>
                      <CopyButton value={c.value} what={kind} lang={lang} />
                    </div>
                  ) : (
                    <p className="mt-2 flex items-center gap-2 font-mono text-headline-lg tracking-widest text-on-primary-container-muted" aria-label={`${kind}: ${t('hidden')}`}>
                      <Lock size={18} aria-hidden />
                      <span aria-hidden>{c.masked}</span>
                    </p>
                  )}
                </div>
              );
            })}
            {wifi.map((c) => (
              <div key={c.id} className="col-span-2 rounded-md bg-on-primary-container/10 p-4">
                <p className="flex items-center gap-2 text-label-md text-on-primary-container-muted">
                  <Wifi size={18} aria-hidden />
                  {CODE_KIND[lang].wifi}
                </p>
                {c.value ? (
                  <dl className="mt-2 grid gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <dt className="text-label-sm text-on-primary-container-muted">{t('wifiNetwork')}</dt>
                        <dd className="text-headline-md break-all">{c.label}</dd>
                      </div>
                      <CopyButton value={c.label} what={t('wifiNetwork')} lang={lang} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <dt className="text-label-sm text-on-primary-container-muted">{t('wifiPassword')}</dt>
                        <dd className="font-mono text-headline-lg tracking-wide break-all">{c.value}</dd>
                      </div>
                      <CopyButton value={c.value} what={t('wifiPassword')} lang={lang} />
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 flex items-center gap-2 font-mono text-headline-lg tracking-widest text-on-primary-container-muted" aria-label={`${CODE_KIND[lang].wifi}: ${t('hidden')}`}>
                    <Lock size={18} aria-hidden />
                    <span aria-hidden>{c.masked}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
          {!visible && (
            <p className="mt-4 flex items-start gap-2 rounded-md bg-on-primary-container/10 px-4 py-3 text-body-md">
              <Lock size={18} className="mt-0.5 shrink-0" aria-hidden />
              {home.stay === 'past' ? t('codesPast') : t('codesLocked', { range })}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function DatesCard({ home, lang }: { home: Home; lang: Lang }) {
  const t = makeT(GUEST, lang);
  const b = home.booking;
  const p = home.property;
  const cell = (icon: LucideIcon, label: string, date: string, time: string) => {
    const Icon = icon;
    return (
      <div className="rounded-md bg-surface-low p-4">
        <p className="flex items-center gap-2 text-label-md text-on-surface-variant">
          <Icon size={18} aria-hidden />
          {label}
        </p>
        <p className="mt-1.5 text-headline-md text-primary">{fDate(date, lang, { weekday: true })}</p>
        <p className="text-body-md text-on-surface">{time}</p>
      </div>
    );
  };
  return (
    <Card padding="lg" as="section" aria-label={`${t('checkIn')} · ${t('checkOut')}`}>
      <div className="grid grid-cols-2 gap-3">
        {cell(CalendarCheck, t('checkIn'), b.checkIn, t('fromTime', { time: fTime(p.checkInTime, lang) }))}
        {cell(CalendarX, t('checkOut'), b.checkOut, t('byTime', { time: fTime(p.checkOutTime, lang) }))}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5">
          <Moon size={16} aria-hidden />
          {b.nights === 1 ? t('nights_one') : t('nights_other', { n: b.nights })}
        </span>
        <span aria-hidden>·</span>
        <span>{b.guests === 1 ? t('guests_one') : t('guests_other', { n: b.guests })}</span>
        <span aria-hidden>·</span>
        <span>{t('booking', { code: b.code })}</span>
      </p>
    </Card>
  );
}

function stayLine(home: Home, lang: Lang): string {
  const t = makeT(GUEST, lang);
  const b = home.booking;
  if (home.stay === 'during') {
    if (b.today >= b.checkOut) return t('stayCheckoutToday', { time: fTime(home.property.checkOutTime, lang) });
    if (b.today === b.checkIn) return t('stayCheckinToday', { time: fTime(home.property.checkInTime, lang) });
    return t('stayDuring', { date: fDateLong(b.checkOut, lang) });
  }
  if (home.stay === 'upcoming') {
    const n = diffDays(b.today, b.checkIn);
    return n <= 1 ? t('stayTomorrow') : t('stayInDays', { n });
  }
  return t('stayPast', { date: fDate(b.checkOut, lang, { year: true }) });
}

const STAGE_TONE: Record<'upcoming' | 'during' | 'past', Tone> = { upcoming: 'info', during: 'good', past: 'neutral' };

function Stay({ home, lang }: { home: Home; lang: Lang }) {
  const t = makeT(GUEST, lang);
  const tc = makeT(COMMON, lang);
  const b = home.booking;
  const p = home.property;
  const night = diffDays(b.checkIn, b.today) + 1;
  const others = home.bookings.filter((x) => x.id !== b.id);
  return (
    <>
      <PersonHero
        photo={p.photos[0]}
        alt={t('heroAlt', { name: p.name })}
        place={`${p.name} · ${p.city}`}
        title={t('hello', { name: firstName(home.person.name) })}
        subtitle={stayLine(home, lang)}
      >
        {home.stay === 'during' && b.today < b.checkOut && (
          <HeroChip>
            <BedDouble size={16} aria-hidden />
            {t('nightOf', { n: night, total: b.nights })}
          </HeroChip>
        )}
        <HeroChip>{fRange(b.checkIn, b.checkOut, lang)}</HeroChip>
      </PersonHero>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/huesped/mensajes" className={buttonClass('primary', 'lg', true, 'h-16')}>
          <MessageSquare size={22} aria-hidden />
          {tc('messageUs')}
        </Link>
        <Link to="/huesped/reportar" className={buttonClass('secondary', 'lg', true, 'h-16')}>
          <Siren size={22} aria-hidden />
          <span className="truncate">{tc('reportProblem')}</span>
        </Link>
      </div>

      <DatesCard home={home} lang={lang} />
      <CodesCard home={home} lang={lang} />

      <InfoCard icon={DoorOpen} title={t('instructionsTitle')}>
        <p className="text-body-lg whitespace-pre-line text-on-surface">{p.checkInInstructions[lang]}</p>
      </InfoCard>

      <InfoCard icon={Navigation} title={t('directionsTitle')}>
        <p className="text-body-lg font-semibold text-on-surface">{p.address}</p>
        <p className="text-body-md text-on-surface-variant">{[p.neighborhood, p.city, p.region].filter(Boolean).join(', ')}</p>
        <p className="mt-3 text-body-lg whitespace-pre-line text-on-surface">{p.directions[lang]}</p>
        <a href={mapsUrl(p.lat, p.lng)} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'md', false, 'mt-4')}>
          <Navigation size={18} aria-hidden />
          {tc('openMaps')}
          <ExternalLink size={16} aria-hidden />
        </a>
        <Suspense fallback={<div className="mt-4 h-48 animate-pulse rounded-md bg-surface-container" />}>
          <LazyMap
            markers={[{ id: p.id, lat: p.lat, lng: p.lng, label: p.name, tone: 'info' }]}
            zoom={14}
            className="mt-4 h-48 overflow-hidden rounded-md"
            ariaLabel={t('mapLabel', { name: p.name })}
          />
        </Suspense>
      </InfoCard>

      <InfoCard icon={BookOpen} title={t('manualTitle')}>
        <p className="mb-3 text-body-sm text-on-surface-variant">{t('facts', { bedrooms: p.bedrooms, bathrooms: p.bathrooms, capacity: p.capacity })}</p>
        <p className="text-body-lg whitespace-pre-line text-on-surface">{p.houseManual[lang]}</p>
      </InfoCard>

      {others.length > 0 && (
        <section className="space-y-3" aria-label={t('staysTitle')}>
          <h2 className="text-headline-md text-primary">{t('staysTitle')}</h2>
          <ul className="space-y-2">
            {[b, ...others].map((x) => {
              const stage = x.status === 'in_progress' || (x.status === 'confirmed' && x.checkIn <= x.today && x.today <= x.checkOut) ? 'during' : x.status === 'confirmed' ? 'upcoming' : 'past';
              return (
                <li key={x.id}>
                  <Card padding="sm" className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-label-md text-primary">{x.propertyName}</p>
                      <p className="text-body-sm text-on-surface-variant">
                        {fRange(x.checkIn, x.checkOut, lang)} · {x.code}
                      </p>
                    </div>
                    <Badge tone={STAGE_TONE[stage]}>{t(`stage_${stage}`)}</Badge>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

export default function GuestHomePage() {
  const actor = useActor();
  const res = useLiveResult(() => svc.bookings.guestHome(actor), [actor]);
  const home = res.data;
  const [lang] = useLang(home?.person.language ?? 'es');
  const t = makeT(GUEST, lang);
  const tc = makeT(COMMON, lang);
  return (
    <div data-testid="app-huesped" lang={lang} className="space-y-5">
      {!home ? (
        res.error ? (
          <ErrorState error={tc('loadError')} />
        ) : (
          <Loading label={tc('loading')} />
        )
      ) : home.booking && home.property && home.stay !== 'none' ? (
        <Stay home={home as Home} lang={lang} />
      ) : (
        <>
          <header>
            <h1 className="text-headline-lg text-primary md:text-headline-xl">{t('hello', { name: firstName(home.person.name) })}</h1>
          </header>
          <EmptyState icon={CalendarCheck} title={t('noStayTitle')} body={t('noStayBody')} />
          <Link to="/huesped/mensajes" className={buttonClass('primary', 'lg', true)}>
            <MessageSquare size={22} aria-hidden />
            {tc('messageUs')}
          </Link>
        </>
      )}
    </div>
  );
}
