/**
 * «Reportar un problema» del huésped y del inquilino: qué pasó, categoría, urgencia y foto
 * (cámara primero o foto de ejemplo). Debajo, «Mis reportes» con su estado.
 */
import type { LucideIcon } from 'lucide-react';
import { AirVent, Bug, CircleHelp, Clock, Droplets, KeyRound, Lock, Phone, Refrigerator, Send, Siren, Sparkles, Trees, Waves, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { MAINTENANCE_CATEGORIES, type Incident, type Lang, type MaintenanceCategory } from '@/domain/types';
import { sampleImage } from '@/lib/images';
import { svc } from '@/services';
import { Badge, Banner, Button, Card, cn, EmptyState, FileImage, PhotoInput, useToast, type Tone } from '@/ui';
import { BigInput, BigTextArea } from './fields';
import { fStamp } from './format';
import { categoryKey, COMMON, incidentStatusKey, makeT, REPORT } from './i18n';

const CATEGORY_ICON: Record<MaintenanceCategory, LucideIcon> = {
  plumbing: Droplets,
  electrical: Zap,
  hvac: AirVent,
  appliances: Refrigerator,
  pests: Bug,
  pool: Waves,
  garden: Trees,
  locks: KeyRound,
  general: CircleHelp,
};

const STATUS_TONE: Record<Incident['status'], Tone> = { open: 'info', in_progress: 'warn', resolved: 'good', dismissed: 'neutral' };

/** URL temporal para ver una foto antes de enviarla. */
function useBlobUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export interface ReportPlace {
  propertyId: string;
  propertyName: string;
  bookingId?: string;
  leaseId?: string;
}

function ReportFormCard({ lang, source, place }: { lang: Lang; source: 'guest' | 'tenant'; place: ReportPlace }) {
  const actor = useActor();
  const toast = useToast();
  const t = makeT(REPORT, lang);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<MaintenanceCategory>('general');
  const [urgent, setUrgent] = useState(false);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [touched, setTouched] = useState(false);
  const [run, busy] = useBusyAction();
  const photoUrl = useBlobUrl(photo);
  const titleError = touched && title.trim().length < 3 ? t('whatError') : undefined;

  const submit = async () => {
    setTouched(true);
    if (title.trim().length < 3) return;
    const result = await run(() =>
      svc.operations.createIncident(actor, {
        propertyId: place.propertyId,
        title: title.trim(),
        description: description.trim(),
        category,
        severity: urgent ? 'urgent' : 'medium',
        source,
        kind: 'problem',
        bookingId: place.bookingId,
        leaseId: place.leaseId,
        photo: photo ?? undefined,
      }),
    );
    if (!result) return;
    toast.success(urgent ? t('sentUrgent') : t('sentNormal'));
    setTitle('');
    setDescription('');
    setCategory('general');
    setUrgent(false);
    setPhoto(null);
    setTouched(false);
  };

  return (
    <Card padding="lg" as="section" aria-label={t('title')}>
      <form
        className="space-y-6"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <BigInput
          label={t('whatLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title && setTouched(true)}
          placeholder={t('whatPlaceholder')}
          error={titleError}
          maxLength={120}
          data-testid="reporte-titulo"
        />

        <fieldset>
          <legend className="mb-2 text-body-lg font-semibold text-on-surface">{t('categoryLabel')}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('categoryLabel')}>
            {MAINTENANCE_CATEGORIES.map((c) => {
              const Icon = CATEGORY_ICON[c];
              const on = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'flex min-h-14 items-center gap-2.5 rounded-md border px-3 py-2 text-left text-label-md transition-colors',
                    on ? 'border-secondary bg-secondary-container text-on-secondary-container' : 'border-outline-variant bg-surface-lowest text-on-surface hover:border-primary',
                  )}
                >
                  <Icon size={20} className="shrink-0" aria-hidden />
                  <span>{t(categoryKey(c))}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-body-lg font-semibold text-on-surface">{t('urgencyLabel')}</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('urgencyLabel')}>
            {[
              { value: true, icon: Siren, label: t('urgent'), hint: t('urgentHint') },
              { value: false, icon: Clock, label: t('normal'), hint: t('normalHint') },
            ].map((o) => {
              const on = urgent === o.value;
              return (
                <button
                  key={String(o.value)}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setUrgent(o.value)}
                  className={cn(
                    'flex items-start gap-3 rounded-md border-2 p-4 text-left transition-colors',
                    on && o.value && 'border-error bg-error-container text-on-error-container',
                    on && !o.value && 'border-primary bg-surface-container text-primary',
                    !on && 'border-outline-variant bg-surface-lowest text-on-surface hover:border-primary',
                  )}
                >
                  <o.icon size={24} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    <span className="block text-body-lg font-bold">{o.label}</span>
                    <span className="block text-body-sm opacity-90">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {urgent && (
            <p className="mt-2 flex items-start gap-2 text-body-sm text-on-surface-variant">
              <Phone size={16} className="mt-0.5 shrink-0" aria-hidden />
              {t('emergency')}
            </p>
          )}
        </fieldset>

        <BigTextArea
          label={t('detailsLabel')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('detailsPlaceholder')}
          rows={3}
          maxLength={1500}
        />

        <div>
          <p className="mb-2 text-body-lg font-semibold text-on-surface">{t('photoLabel')}</p>
          {photoUrl ? (
            <div className="relative inline-block">
              <img src={photoUrl} alt={t('photoAlt')} className="h-40 w-56 rounded-md object-cover shadow-card" />
              <button
                type="button"
                onClick={() => setPhoto(null)}
                aria-label={t('removePhoto')}
                title={t('removePhoto')}
                className="absolute -top-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-on-primary shadow-pop"
              >
                <X size={18} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <PhotoInput onPhoto={(b) => setPhoto(b)} label={t('takePhoto')} variant="secondary" size="md" testId="reporte-foto" />
              <Button variant="ghost" size="sm" icon={Sparkles} onClick={async () => setPhoto(await sampleImage('report', title.trim()))}>
                {t('samplePhoto')}
              </Button>
            </div>
          )}
        </div>

        <Button type="submit" size="lg" icon={Send} fullWidth loading={busy} data-testid="reporte-enviar">
          {t('submit')}
        </Button>
      </form>
    </Card>
  );
}

function MyReports({ lang }: { lang: Lang }) {
  const actor = useActor();
  const t = makeT(REPORT, lang);
  const list = useLive(() => svc.operations.myIncidents(actor), [actor]);
  return (
    <section className="space-y-3" aria-label={t('myReports')}>
      <h2 className="text-headline-md text-primary">{t('myReports')}</h2>
      {list && !list.length && <p className="text-body-md text-on-surface-variant">{t('noReports')}</p>}
      <ul className="space-y-3">
        {list?.map((i) => (
          <li key={i.id}>
            <Card padding="sm" className="flex items-start gap-3">
              {i.photos[0] ? (
                <FileImage fileId={i.photos[0]} alt={t('photoAlt')} className="h-16 w-16 shrink-0 rounded-md" />
              ) : (
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-surface-container text-primary">
                  {(() => {
                    const Icon = CATEGORY_ICON[i.category];
                    return <Icon size={24} aria-hidden />;
                  })()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[i.status]}>{t(incidentStatusKey(i.status))}</Badge>
                  {i.severity === 'urgent' && <Badge tone="bad">{t('urgentTag')}</Badge>}
                </div>
                <p className="mt-1.5 text-body-lg font-semibold text-on-surface">{i.title}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {t('reportedOn', { date: fStamp(i.createdAt, lang) })} · {t(categoryKey(i.category))}
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Pantalla completa: encabezado, formulario y «Mis reportes». */
export function ReportScreen({ lang, source, place }: { lang: Lang; source: 'guest' | 'tenant'; place: ReportPlace | null }) {
  const actor = useActor();
  const t = makeT(REPORT, lang);
  const tc = makeT(COMMON, lang);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-headline-lg text-primary md:text-headline-xl">{t('title')}</h1>
        <p className="mt-1 text-body-lg text-on-surface-variant">
          {t('subtitle')}
          {place && <span className="block text-body-md">{t('forPlace', { name: place.propertyName })}</span>}
        </p>
      </header>
      {!place ? (
        <EmptyState icon={Siren} title={t('noPlaceTitle')} body={t('noPlaceBody')} />
      ) : actor.readOnly ? (
        <Banner tone="warn" icon={Lock}>
          {tc('viewOnly')}
        </Banner>
      ) : (
        <ReportFormCard lang={lang} source={source} place={place} />
      )}
      <MyReports lang={lang} />
    </div>
  );
}
