/**
 * Importar un calendario .ics (`/reservas/importar`): cada evento se vuelve una reserva «por completar»
 * o un bloqueo («Not available»); lo que se cruza o ya se importó se salta con su motivo.
 * Incluye un .ics de ejemplo con fechas libres para probar la demo sin un archivo real.
 */
import { ArrowRight, CalendarSync, CheckCircle2, ClipboardPaste, FileDown, FileUp, Info, Lock, SkipForward, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { downloadFile, useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { CHANNEL_LABEL } from '@/domain/labels';
import { todayLocal } from '@/lib/clock';
import { addDays, formatDate, formatRange } from '@/lib/dates';
import { svc, type IcsImportResult } from '@/services';
import { Badge, Banner, Button, Card, CardHeader, Eyebrow, PageHeader, Select, TextArea } from '@/ui';
import { buildSampleIcs, sampleEvents } from './icsSample';
import { BLOCK_REASON_LABEL, findFreeWindows, occupiedRanges } from './shared';

export default function IcsImportPage() {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const today = todayLocal();
  const fileRef = useRef<HTMLInputElement>(null);
  const allProperties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const properties = useMemo(() => (allProperties ?? []).filter((p) => p.rentalMode !== 'monthly'), [allProperties]);
  const occ = useLive(() => svc.bookings.calendarData(actor, today, addDays(today, 200)), [actor, today]);
  const [propertyId, setPropertyId] = useState('');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<{ propertyName: string; data: IcsImportResult } | null>(null);
  const property = properties.find((p) => p.id === propertyId);
  const resultRef = useRef<HTMLDivElement>(null);

  // El resultado queda debajo del botón: se lleva a la vista al terminar.
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  /** Ejemplo con fechas libres de la propiedad elegida (o fechas genéricas si no hay propiedad). */
  const sample = useMemo(() => {
    const from = addDays(today, 7);
    const windows = propertyId && occ ? findFreeWindows(occupiedRanges(occ, propertyId), from, [4, 3, 2], 2) : [];
    const fallback = [
      { start: addDays(today, 21), end: addDays(today, 25) },
      { start: addDays(today, 28), end: addDays(today, 31) },
      { start: addDays(today, 35), end: addDays(today, 37) },
    ];
    const events = sampleEvents(windows.length === 3 ? windows : fallback);
    return { events, ics: buildSampleIcs(propertyId || 'demo', events, today) };
  }, [occ, propertyId, today]);

  const importNow = async () => {
    if (!property || !text.trim()) return;
    const data = await run(() => svc.bookings.importIcs(actor, property.id, text), { success: 'Calendario importado' });
    if (data) setResult({ propertyName: property.name, data });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Importar calendario (.ics)" subtitle="Trae las reservas de Airbnb, Vrbo u otro canal desde su archivo de calendario." back="/reservas" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="1. Elige la propiedad" />
            <Select
              aria-label="Propiedad"
              value={propertyId}
              placeholder="Elige una propiedad"
              onChange={(e) => {
                setPropertyId(e.target.value);
                setResult(null);
              }}
              options={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
              hint="Solo las que se alquilan por noches o en modo mixto."
              data-testid="ics-propiedad"
            />
          </Card>

          <Card>
            <CardHeader title="2. Sube el archivo o pega el texto" />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" icon={FileUp} onClick={() => fileRef.current?.click()}>
                Elegir archivo .ics
              </Button>
              {fileName && (
                <Badge tone="info" className="max-w-full">
                  {fileName}
                </Badge>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".ics,text/calendar"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                data-testid="ics-archivo"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  setText(await f.text());
                  setFileName(f.name);
                  setResult(null);
                }}
              />
            </div>
            <div className="mt-4">
              <TextArea
                label="O pega el contenido del .ics"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setFileName(null);
                }}
                rows={7}
                spellCheck={false}
                placeholder={'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:…'}
                className="font-mono text-body-sm"
                data-testid="ics-texto"
              />
            </div>

            <div className="mt-4 rounded-md bg-surface-low p-3">
              <p className="flex items-center gap-1.5 text-label-md text-primary">
                <Info size={16} aria-hidden />
                ¿No tienes un archivo a mano?
              </p>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Usa el ejemplo: dos reservas de Airbnb y un día no disponible
                {property ? ` en fechas libres de ${property.name}` : ''}:{' '}
                {sample.events.map((e, i) => (
                  <span key={e.start}>
                    {i > 0 && ', '}
                    {formatRange(e.start, e.end)}
                  </span>
                ))}
                .{!property && ' Elige antes la propiedad para que caigan en días libres.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={ClipboardPaste}
                  onClick={() => {
                    setText(sample.ics);
                    setFileName('ejemplo-airbnb.ics');
                    setResult(null);
                  }}
                  data-testid="usar-ejemplo-ics"
                >
                  Usar el ejemplo
                </Button>
                <Button size="sm" variant="ghost" icon={FileDown} onClick={() => downloadFile(sample.ics, 'ejemplo-airbnb.ics', 'text/calendar;charset=utf-8')} data-testid="descargar-ejemplo-ics">
                  Descargar un .ics de ejemplo
                </Button>
              </div>
            </div>
          </Card>

          <Button size="lg" icon={Upload} fullWidth onClick={importNow} loading={busy} disabled={!property || !text.trim()} data-testid="importar">
            Importar
          </Button>

          <div ref={resultRef} className="scroll-mt-24">
            {result && <ImportResult result={result.data} propertyName={result.propertyName} />}
          </div>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="¿Dónde consigo el .ics?" />
            <div className="space-y-4 text-body-sm text-on-surface-variant">
              <div>
                <Eyebrow className="mb-1">Airbnb</Eyebrow>
                <p>
                  En <strong className="text-on-surface">Calendario</strong>, elige el anuncio y entra a <strong className="text-on-surface">Disponibilidad → Conectar calendarios → Exportar calendario</strong>. Copia el enlace y ábrelo en el navegador: se descarga el .ics.
                </p>
              </div>
              <div>
                <Eyebrow className="mb-1">Vrbo</Eyebrow>
                <p>
                  En <strong className="text-on-surface">Calendario → Importar y exportar → Exportar calendario</strong>, copia el enlace y ábrelo para descargar el archivo.
                </p>
              </div>
              <div>
                <Eyebrow className="mb-1">Qué se importa</Eyebrow>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Cada reserva entra confirmada y «por completar»: el .ics no trae huésped ni montos.</li>
                  <li>Los días «Not available» quedan como bloqueos.</li>
                  <li>Lo que se cruza, ya pasó o ya se importó se salta y te decimos por qué.</li>
                </ul>
              </div>
            </div>
          </Card>
          <Card tone="muted">
            <div className="flex items-start gap-3">
              <span className="rounded-md bg-surface-lowest p-2 text-primary shadow-card">
                <CalendarSync size={20} aria-hidden />
              </span>
              <div>
                <p className="text-label-md text-primary">Sincronización automática: próximamente</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  Más adelante el enlace del canal se revisará solo cada cierto tiempo. Por ahora, la importación es a mano y solo agrega: nunca borra reservas.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ImportResult({ result, propertyName }: { result: IcsImportResult; propertyName: string }) {
  const nothing = !result.created.length && !result.blocks.length;
  return (
    <Card data-testid="resultado-importacion">
      <CardHeader title="Resultado" subtitle={propertyName} />
      <Banner tone={nothing ? 'warn' : 'good'} icon={nothing ? Info : CheckCircle2} className="mb-4">
        {result.created.length} {result.created.length === 1 ? 'reserva creada' : 'reservas creadas'} · {result.blocks.length} {result.blocks.length === 1 ? 'bloqueo' : 'bloqueos'} ·{' '}
        {result.skipped.length} {result.skipped.length === 1 ? 'saltada' : 'saltadas'}
      </Banner>

      {result.created.length > 0 && (
        <section className="mb-4" aria-label="Reservas creadas">
          <Eyebrow className="mb-2">Reservas creadas</Eyebrow>
          <ul className="space-y-2">
            {result.created.map((b) => (
              <li key={b.id}>
                <Link to={`/reservas/${b.id}`} className="flex items-center gap-3 rounded-md bg-surface-low px-3 py-2.5 hover:bg-surface-container">
                  <span className="min-w-0 flex-1">
                    <span className="block text-label-md text-primary">
                      {b.code} · {formatRange(b.checkIn, b.checkOut)}
                    </span>
                    <span className="block text-body-sm text-on-surface-variant">{CHANNEL_LABEL[b.channel]} · montos estimados con la tarifa</span>
                  </span>
                  <Badge tone="warn">Por completar</Badge>
                  <ArrowRight size={16} className="shrink-0 text-on-surface-variant" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.blocks.length > 0 && (
        <section className="mb-4" aria-label="Bloqueos creados">
          <Eyebrow className="mb-2">Bloqueos</Eyebrow>
          <ul className="space-y-2">
            {result.blocks.map((bl) => (
              <li key={bl.id} className="flex items-center gap-3 rounded-md bg-surface-low px-3 py-2.5">
                <Lock size={16} className="shrink-0 text-on-surface-variant" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-label-md text-primary">
                    {BLOCK_REASON_LABEL[bl.reason]} · del {formatDate(bl.start)} al {formatDate(addDays(bl.end, -1))}
                  </span>
                  <span className="block truncate text-body-sm text-on-surface-variant">{bl.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.skipped.length > 0 && (
        <section aria-label="Eventos saltados">
          <Eyebrow className="mb-2">Saltados</Eyebrow>
          <ul className="space-y-2">
            {result.skipped.map((s, i) => (
              <li key={`${s.summary}-${i}`} className="flex items-start gap-3 rounded-md border border-outline-variant/60 px-3 py-2.5">
                <SkipForward size={16} className="mt-0.5 shrink-0 text-on-surface-variant" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-label-md text-on-surface">{s.summary}</span>
                  <span className="block text-body-sm text-on-surface-variant">{s.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.created.length > 0 && (
        <p className="mt-4 text-body-sm text-on-surface-variant">
          Abre cada reserva y usa <strong className="text-on-surface">Completar</strong> para poner personas, tarifa y canal. El nombre del huésped se cambia en su ficha.
        </p>
      )}
    </Card>
  );
}
