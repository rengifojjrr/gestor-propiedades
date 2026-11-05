/**
 * Nuevo contrato (`/contratos/nuevo`): propiedad por meses o mixta, inquilino (existente o nuevo),
 * fechas, renta en la moneda de la propiedad, día de pago, depósito y recargo por atraso.
 */
import { Check, UserPlus, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import type { Lang } from '@/domain/types';
import { todayLocal } from '@/lib/clock';
import { addDays, addMonths, addMonthsToKey, diffDays, formatDate, monthKeyOf, monthStart } from '@/lib/dates';
import { formatMoney, parseAmount } from '@/lib/money';
import { errorMessage, svc, ValidationError } from '@/services';
import { Banner, Button, Card, CardHeader, cn, PageHeader, Select, TextArea, TextInput, useToast } from '@/ui';
import { humanizeDates } from '../bookings/shared';
import { lateFeeText } from './shared';

export default function LeaseFormPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const today = todayLocal();
  const allProperties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const properties = useMemo(() => (allProperties ?? []).filter((p) => p.rentalMode !== 'nightly'), [allProperties]);
  const tenants = useLive(() => svc.people.listPeople(actor, { kind: 'tenant' }), [actor]);

  const defaultStart = monthStart(addMonthsToKey(monthKeyOf(today), 1));
  const [propertyId, setPropertyId] = useState(params.get('propiedad') ?? '');
  const [tenantMode, setTenantMode] = useState<'existing' | 'new'>('existing');
  const [tenantId, setTenantId] = useState('');
  const [newTenant, setNewTenant] = useState<{ name: string; email: string; phone: string; language: Lang }>({ name: '', email: '', phone: '', language: 'es' });
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(addDays(addMonths(defaultStart, 12), -1));
  const [rentText, setRentText] = useState<string | null>(null);
  const [dueDay, setDueDay] = useState('1');
  const [depositText, setDepositText] = useState<string | null>(null);
  const [feeKind, setFeeKind] = useState<'percent' | 'fixed'>('percent');
  const [feeValue, setFeeValue] = useState('5');
  const [grace, setGrace] = useState('3');
  const [notes, setNotes] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const property = properties.find((p) => p.id === propertyId);
  const currency = property?.currency ?? 'USD';
  const rent = parseAmount(rentText ?? String(property?.monthlyRent ?? ''));
  const deposit = parseAmount(depositText ?? rentText ?? String(property?.monthlyRent ?? ''));
  const day = Number(dueDay);
  const fee = parseAmount(feeValue);
  const graceDays = Number(grace);
  const months = start && end && end > start ? Math.round(diffDays(start, addDays(end, 1)) / 30.44) : 0;

  const errors = {
    property: !property ? 'Elige una propiedad' : undefined,
    tenant: tenantMode === 'existing' ? (!tenantId ? 'Elige un inquilino o crea uno nuevo' : undefined) : newTenant.name.trim().length < 2 ? 'Escribe el nombre del inquilino' : undefined,
    start: !start ? 'Elige el inicio' : undefined,
    end: !end ? 'Elige el fin' : start && end <= start ? 'El fin debe ser después del inicio' : undefined,
    rent: !(rent > 0) ? 'Escribe la renta mensual' : undefined,
    dueDay: !Number.isInteger(day) || day < 1 || day > 28 ? 'Del 1 al 28' : undefined,
    deposit: !(deposit >= 0) ? 'Escribe el depósito (0 si no hay)' : undefined,
    fee: !(fee >= 0) ? 'Escribe el recargo (0 si no hay)' : undefined,
    grace: !Number.isInteger(graceDays) || graceDays < 0 ? 'Días enteros (0 o más)' : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (e?: string) => (tried ? e : undefined);

  const submit = async () => {
    setTried(true);
    setError(null);
    if (!valid || !property) return;
    setBusy(true);
    try {
      let tid = tenantId;
      if (tenantMode === 'new') {
        const person = await svc.people.savePerson(actor, {
          kind: 'tenant',
          name: newTenant.name.trim(),
          email: newTenant.email.trim() || undefined,
          phone: newTenant.phone.trim() || undefined,
          language: newTenant.language,
          notes: '',
          doNotRent: false,
          idVerified: false,
          tags: [],
        });
        tid = person.id;
        // Si el contrato falla (por ejemplo, por un cruce), no se vuelve a crear la persona al reintentar.
        setTenantId(person.id);
        setTenantMode('existing');
      }
      const lease = await svc.leases.createLease(actor, {
        propertyId: property.id,
        tenantId: tid,
        start,
        end,
        rent,
        currency,
        dueDay: day,
        deposit,
        lateFee: { kind: feeKind, value: fee, graceDays },
        notes: notes.trim(),
      });
      toast.success(`Contrato ${lease.code} creado`);
      navigate(`/contratos/${lease.id}`, { replace: true });
    } catch (err) {
      setError(humanizeDates(err instanceof ValidationError ? err.issues.map((i) => i.message).join(' · ') : errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Nuevo contrato" subtitle="Alquiler por meses: inquilino, fechas, renta y condiciones de pago." back="/contratos" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Propiedad e inquilino" />
            <div className="space-y-4">
              <Select
                label="Propiedad"
                value={property?.id ?? ''}
                placeholder="Elige una propiedad"
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setRentText(null);
                  setDepositText(null);
                }}
                options={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
                hint="Solo las que se alquilan por meses o en modo mixto."
                error={show(errors.property)}
              />

              <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-container p-1" role="radiogroup" aria-label="Inquilino">
                {(
                  [
                    { id: 'existing', label: 'Inquilino existente', icon: UserRound },
                    { id: 'new', label: 'Inquilino nuevo', icon: UserPlus },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={tenantMode === o.id}
                    onClick={() => setTenantMode(o.id)}
                    className={cn(
                      'flex h-10 items-center justify-center gap-2 rounded-md text-label-md transition-colors',
                      tenantMode === o.id ? 'bg-surface-lowest text-primary shadow-card' : 'text-on-surface-variant hover:text-primary',
                    )}
                  >
                    <o.icon size={16} aria-hidden />
                    {o.label}
                  </button>
                ))}
              </div>

              {tenantMode === 'existing' ? (
                <Select
                  label="Inquilino"
                  value={tenantId}
                  placeholder={tenants?.length ? 'Elige un inquilino' : 'No hay inquilinos: crea uno nuevo'}
                  onChange={(e) => setTenantId(e.target.value)}
                  options={(tenants ?? []).map((t) => ({ value: t.id, label: t.lease ? `${t.name} · contrato en ${t.lease.propertyName}` : t.name }))}
                  error={show(errors.tenant)}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <TextInput label="Nombre completo" value={newTenant.name} onChange={(e) => setNewTenant((t) => ({ ...t, name: e.target.value }))} error={show(errors.tenant)} autoComplete="off" />
                  <Select
                    label="Idioma de los mensajes"
                    value={newTenant.language}
                    onChange={(e) => setNewTenant((t) => ({ ...t, language: e.target.value as Lang }))}
                    options={[
                      { value: 'es', label: 'Español (ES)' },
                      { value: 'en', label: 'Inglés (EN)' },
                    ]}
                  />
                  <TextInput label="Correo (opcional)" type="email" value={newTenant.email} onChange={(e) => setNewTenant((t) => ({ ...t, email: e.target.value }))} autoComplete="off" />
                  <TextInput label="Teléfono (opcional)" type="tel" value={newTenant.phone} onChange={(e) => setNewTenant((t) => ({ ...t, phone: e.target.value }))} autoComplete="off" />
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Fechas y renta" />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="Inicio"
                  type="date"
                  value={start}
                  onChange={(e) => {
                    const v = e.target.value;
                    setStart(v);
                    if (v && end <= v) setEnd(addDays(addMonths(v, 12), -1));
                  }}
                  error={show(errors.start)}
                />
                <TextInput label="Fin (último día)" type="date" value={end} min={start ? addDays(start, 1) : undefined} onChange={(e) => setEnd(e.target.value)} error={show(errors.end) ?? (start && end && end <= start ? errors.end : undefined)} />
              </div>
              {months > 0 && (
                <p className="-mt-2 text-body-sm text-on-surface-variant">
                  Unos {months} {months === 1 ? 'mes' : 'meses'}: del {formatDate(start, { year: true })} al {formatDate(end, { year: true })}, incluido.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <TextInput label={`Renta mensual (${currency})`} inputMode="decimal" value={rentText ?? String(property?.monthlyRent ?? '')} onChange={(e) => setRentText(e.target.value)} error={show(errors.rent)} />
                <TextInput label="Día de pago" type="number" inputMode="numeric" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} error={show(errors.dueDay) ?? (dueDay && errors.dueDay ? errors.dueDay : undefined)} hint="Del 1 al 28" />
                <TextInput label={`Depósito (${currency})`} inputMode="decimal" value={depositText ?? rentText ?? String(property?.monthlyRent ?? '')} onChange={(e) => setDepositText(e.target.value)} error={show(errors.deposit)} />
              </div>
              <p className="text-body-sm text-on-surface-variant">La moneda es la de la propiedad ({currency}).</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Recargo por atraso" subtitle="Se suma cuando la renta se paga después de los días de gracia." />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Select
                label="Tipo"
                value={feeKind}
                onChange={(e) => {
                  const k = e.target.value as 'percent' | 'fixed';
                  setFeeKind(k);
                  setFeeValue(k === 'percent' ? '5' : '75');
                }}
                options={[
                  { value: 'percent', label: 'Porcentaje' },
                  { value: 'fixed', label: 'Monto fijo' },
                ]}
              />
              <TextInput label={feeKind === 'percent' ? 'Porcentaje (%)' : `Monto (${currency})`} inputMode="decimal" value={feeValue} onChange={(e) => setFeeValue(e.target.value)} error={show(errors.fee)} />
              <TextInput label="Días de gracia" type="number" inputMode="numeric" min={0} value={grace} onChange={(e) => setGrace(e.target.value)} error={show(errors.grace)} />
            </div>
            <div className="mt-4">
              <TextArea label="Notas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Ej.: incluye estacionamiento; el inquilino paga la luz" />
            </div>
          </Card>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader title="Resumen" subtitle={property?.name ?? 'Elige una propiedad'} />
            <dl className="space-y-2 text-body-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-on-surface-variant">Renta</dt>
                <dd className="text-label-md text-on-surface">{rent > 0 ? `${formatMoney(rent, currency)} /mes` : '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-on-surface-variant">Pago</dt>
                <dd className="text-label-md text-on-surface">{!errors.dueDay ? `El ${day} de cada mes` : '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-on-surface-variant">Depósito</dt>
                <dd className="text-label-md text-on-surface">{deposit >= 0 ? formatMoney(deposit, currency) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-on-surface-variant">Recargo</dt>
                <dd className="text-right text-label-md text-on-surface">{fee >= 0 && graceDays >= 0 ? lateFeeText({ lateFee: { kind: feeKind, value: fee, graceDays }, currency }) : '—'}</dd>
              </div>
              {months > 0 && rent > 0 && (
                <div className="flex justify-between gap-3 border-t border-outline-variant pt-2">
                  <dt className="text-on-surface-variant">Total del contrato (aprox.)</dt>
                  <dd className="text-label-md text-secondary">{formatMoney(rent * months, currency)}</dd>
                </div>
              )}
            </dl>
            {error && (
              <Banner tone="bad" className="mt-4">
                {error}
              </Banner>
            )}
            {tried && !valid && !error && (
              <p className="mt-4 text-label-sm text-error" role="alert">
                Revisa los datos marcados en rojo.
              </p>
            )}
            <Button fullWidth size="lg" icon={Check} className="mt-4" onClick={submit} loading={busy} data-testid="crear-contrato">
              Crear contrato
            </Button>
            <p className="mt-2 text-center text-label-sm font-normal text-on-surface-variant">Se abre su conversación con el inquilino. La app solo registra pagos: no cobra.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
