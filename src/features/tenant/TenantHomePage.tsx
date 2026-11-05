/**
 * App del inquilino: su contrato, el próximo pago (o el atraso con su recargo), el aviso de
 * renovación, los documentos de la casa y el manual. La app no cobra: los pagos se registran.
 */
import {
  BookOpen,
  CalendarClock,
  ExternalLink,
  FileSignature,
  FileText,
  MapPin,
  MessageSquare,
  Navigation,
  PartyPopper,
  Receipt,
  RefreshCw,
  Siren,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router';
import { useAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLiveResult } from '@/data/live';
import type { Lang } from '@/domain/types';
import { fDate, firstName, fMonth, fMonthName, mapsUrl } from '@/features/guest/format';
import { COMMON, makeT } from '@/features/guest/i18n';
import { HeroChip, InfoCard, PersonHero, QuickTiles } from '@/features/guest/PersonHero';
import { addDays, diffDays } from '@/lib/dates';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { svc, type LeaseView, type TenantHome } from '@/services';
import { Badge, Banner, buttonClass, Card, EmptyState, ErrorState, KeyValue, Loading, Money } from '@/ui';
import { docKey, leaseStatusKey, ledgerKey, TENANT } from './i18n';

type Home = TenantHome & { lease: LeaseView };

function dueLine(lease: LeaseView, dueDate: string, lang: Lang): string {
  const t = makeT(TENANT, lang);
  const n = diffDays(lease.today, dueDate);
  if (n === 0) return t('dueToday');
  if (n === 1) return t('dueTomorrow');
  if (n > 1) return t('dueInDays', { n, date: fDate(dueDate, lang) });
  return t('dueOn', { date: fDate(dueDate, lang) });
}

function PaymentCard({ home, lang }: { home: Home; lang: Lang }) {
  const t = makeT(TENANT, lang);
  const lease = home.lease;
  const overdue = lease.ledger.filter((r) => r.status === 'overdue');
  const next = lease.ledger.find((r) => r.status === 'due' || r.status === 'upcoming');
  const note = (
    <p className="mt-4 flex items-start gap-2 rounded-md bg-surface-low px-4 py-3 text-body-md text-on-surface" data-testid="nota-pagos">
      <Wallet size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden />
      {t('payNote')}
    </p>
  );

  if (overdue.length) {
    const first = overdue[0];
    const total = lease.overdue.amount + lease.overdue.lateFees;
    return (
      <Card padding="lg" accent="bad" as="section" aria-label={t('overdueTitle')} data-testid="pago-atrasado">
        <Badge tone="bad" icon={TriangleAlert} upper>
          {t('overdueTitle')}
        </Badge>
        <p className="mt-3 text-headline-xl text-error tabular">{formatMoney(total, lease.currency)}</p>
        <p className="mt-1 text-body-lg text-on-surface">
          {t('overdueBody', { month: fMonthName(first.period, lang), date: fDate(first.dueDate, lang), days: first.daysLate })}
          {overdue.length > 1 && <span className="block">{t('overdueMany', { count: overdue.length })}</span>}
        </p>
        <dl className="mt-4 rounded-md border border-outline-variant/60 px-4">
          <KeyValue label={t('rent')} value={<Money amount={lease.overdue.amount} currency={lease.currency} />} />
          <KeyValue label={t('lateFee')} value={<Money amount={lease.overdue.lateFees} currency={lease.currency} className="text-error" />} />
          <KeyValue label={<strong className="text-on-surface">{t('totalDue')}</strong>} value={<Money amount={total} currency={lease.currency} className="text-error" />} />
        </dl>
        {note}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link to="/inquilino/mensajes" className={buttonClass('primary', 'lg', true)}>
            <MessageSquare size={22} aria-hidden />
            {t('tellUsPaid')}
          </Link>
          <Link to="/inquilino/pagos" className={buttonClass('secondary', 'lg', true)}>
            <Receipt size={22} aria-hidden />
            {t('seePayments')}
          </Link>
        </div>
        {next && (
          <p className="mt-4 flex items-start gap-2 border-t border-outline-variant/50 pt-3 text-body-md text-on-surface-variant">
            <CalendarClock size={18} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {t('nextPayment')}: <Money amount={next.rent} currency={lease.currency} className="font-semibold text-on-surface" /> · {dueLine(lease, next.dueDate, lang)}
            </span>
          </p>
        )}
      </Card>
    );
  }

  if (next) {
    const graceEnd = addDays(next.dueDate, lease.lateFee.graceDays);
    return (
      <Card padding="lg" accent={next.status === 'due' ? 'warn' : 'info'} as="section" aria-label={t('nextPayment')} data-testid="proximo-pago">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-label-md text-on-surface-variant uppercase">{t('nextPayment')}</p>
          <Badge tone={next.status === 'due' ? 'warn' : 'info'}>{t(ledgerKey(next.status))}</Badge>
        </div>
        <p className="mt-2 text-headline-xl text-primary tabular">{formatMoney(next.rent, lease.currency)}</p>
        <p className="text-body-lg text-on-surface">
          {fMonth(next.period, lang)} · {dueLine(lease, next.dueDate, lang)}
        </p>
        {next.status === 'due' && <p className="mt-1 text-body-md text-on-warning-container">{t('inGrace', { date: fDate(graceEnd, lang) })}</p>}
        {note}
        <Link to="/inquilino/pagos" className={buttonClass('secondary', 'lg', true, 'mt-4')}>
          <Receipt size={22} aria-hidden />
          {t('seePayments')}
        </Link>
      </Card>
    );
  }

  return (
    <Card padding="lg" accent="good" as="section" aria-label={t('allPaid')}>
      <p className="flex items-center gap-2 text-headline-md text-secondary">
        <PartyPopper size={22} aria-hidden />
        {t('allPaid')}
      </p>
      <p className="mt-1 text-body-lg text-on-surface">{t('allPaidBody')}</p>
      {note}
    </Card>
  );
}

function ContractCard({ home, lang }: { home: Home; lang: Lang }) {
  const t = makeT(TENANT, lang);
  const l = home.lease;
  const lateRule =
    l.lateFee.kind === 'percent'
      ? t('lateRulePercent', { value: l.lateFee.value, grace: l.lateFee.graceDays })
      : t('lateRuleFixed', { amount: formatMoney(l.lateFee.value, l.currency), grace: l.lateFee.graceDays });
  return (
    <InfoCard icon={FileSignature} title={t('contractTitle')} action={<Badge tone={l.status === 'active' ? 'good' : 'neutral'}>{t(leaseStatusKey(l.status))}</Badge>}>
      <dl>
        <KeyValue label={t('period')} value={`${fDate(l.start, lang, { year: true })} – ${fDate(l.end, lang, { year: true })}`} />
        <KeyValue label={t('monthlyRent')} value={<Money amount={l.rent} currency={l.currency} className="text-body-lg font-bold" />} />
        <KeyValue label={t('dueDay')} value={t('dueDayValue', { day: l.dueDay })} />
        <KeyValue label={t('deposit')} value={<Money amount={l.deposit} currency={l.currency} />} />
        <KeyValue label={t('lateRule')} value={lateRule} />
      </dl>
      {l.status === 'active' && l.daysToEnd >= 0 && <p className="mt-3 text-body-sm text-on-surface-variant">{t('endsIn', { n: l.daysToEnd })}</p>}
    </InfoCard>
  );
}

function DocumentsCard({ home, lang }: { home: Home; lang: Lang }) {
  const actor = useActor();
  const run = useAction();
  const t = makeT(TENANT, lang);
  const open = async (id: string) => {
    // La pestaña se abre antes de leer el archivo para que el navegador no la bloquee.
    const tab = window.open('', '_blank');
    const file = await run(() => svc.documents.openDocument(actor, id));
    if (!file) {
      tab?.close();
      return;
    }
    const url = URL.createObjectURL(file.blob);
    if (tab) tab.location.href = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <InfoCard icon={FileText} title={t('documentsTitle')}>
      {!home.documents.length ? (
        <p className="text-body-md text-on-surface-variant">{t('noDocuments')}</p>
      ) : (
        <ul className="space-y-2">
          {home.documents.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => void open(d.id)}
                aria-label={t('openWhat', { name: d.name })}
                className="flex min-h-16 w-full items-center gap-3 rounded-md bg-surface-low px-3 py-2.5 text-left transition-colors hover:bg-surface-container"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-surface-lowest text-primary shadow-card">
                  <FileText size={20} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-md font-semibold text-on-surface">{d.name}</span>
                  <span className="block text-body-sm text-on-surface-variant">
                    {t(docKey(d.category))}
                    {d.expiresOn && ` · ${t('expires', { date: fDate(d.expiresOn, lang, { year: true }) })}`}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-label-md text-primary">
                  {t('open')}
                  <ExternalLink size={16} aria-hidden />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </InfoCard>
  );
}

function LeaseHome({ home, lang }: { home: Home; lang: Lang }) {
  const t = makeT(TENANT, lang);
  const tc = makeT(COMMON, lang);
  const l = home.lease;
  const p = home.property;
  return (
    <>
      <PersonHero
        photo={p?.photos[0]}
        alt={t('heroAlt', { name: p?.name ?? l.propertyName })}
        place={`${p?.name ?? l.propertyName} · ${p?.city ?? l.propertyCity}`}
        title={t('hello', { name: firstName(home.person.name) })}
        subtitle={l.status === 'active' ? t('leaseUntil', { date: fDate(l.end, lang, { year: true }) }) : undefined}
      >
        <HeroChip>
          <FileSignature size={16} aria-hidden />
          {t('lease', { code: l.code })}
        </HeroChip>
      </PersonHero>

      {l.renewalDue && (
        <Banner
          tone="warn"
          icon={RefreshCw}
          action={
            <Link to="/inquilino/mensajes" className={buttonClass('secondary', 'sm')}>
              {t('talkRenewal')}
            </Link>
          }
        >
          <strong className="block">{t('renewalTitle')}</strong>
          {t('renewalBody', { date: fDate(l.end, lang, { year: true }), n: l.daysToEnd })}
        </Banner>
      )}

      <PaymentCard home={home} lang={lang} />

      <QuickTiles
        label={t('contractTitle')}
        items={[
          { to: '/inquilino/mensajes', icon: MessageSquare, label: tc('messageUs'), primary: true },
          { to: '/inquilino/reportar', icon: Siren, label: tc('reportProblem') },
        ]}
      />

      <ContractCard home={home} lang={lang} />
      <DocumentsCard home={home} lang={lang} />

      {p && (
        <InfoCard icon={BookOpen} title={t('manualTitle')}>
          <p className="text-body-lg whitespace-pre-line text-on-surface">{p.houseManual[lang]}</p>
        </InfoCard>
      )}

      {p && (
        <InfoCard icon={MapPin} title={t('addressTitle')}>
          <p className="text-body-lg font-semibold text-on-surface">{p.address}</p>
          <p className="text-body-md text-on-surface-variant">{p.city}</p>
          {p.directions[lang] && <p className="mt-3 text-body-lg whitespace-pre-line text-on-surface">{p.directions[lang]}</p>}
          <a href={mapsUrl(p.lat, p.lng)} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'md', false, 'mt-4')}>
            <Navigation size={18} aria-hidden />
            {tc('openMaps')}
            <ExternalLink size={16} aria-hidden />
          </a>
        </InfoCard>
      )}
    </>
  );
}

export default function TenantHomePage() {
  const actor = useActor();
  const res = useLiveResult(() => svc.leases.tenantHome(actor), [actor]);
  const home = res.data;
  const [lang] = useLang(home?.person.language ?? 'es');
  const t = makeT(TENANT, lang);
  const tc = makeT(COMMON, lang);
  return (
    <div data-testid="app-inquilino" lang={lang} className="space-y-5">
      {!home ? (
        res.error ? (
          <ErrorState error={tc('loadError')} />
        ) : (
          <Loading label={tc('loading')} />
        )
      ) : home.lease ? (
        <LeaseHome home={home as Home} lang={lang} />
      ) : (
        <>
          <h1 className="text-headline-lg text-primary md:text-headline-xl">{t('hello', { name: firstName(home.person.name) })}</h1>
          <EmptyState icon={FileSignature} title={t('noLeaseTitle')} body={t('noLeaseBody')} />
        </>
      )}
    </div>
  );
}
