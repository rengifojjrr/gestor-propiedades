/**
 * Ajustes del sistema: empresa (nombre y logo), monedas y tasas manuales, umbral de aprobación,
 * datos privados, idiomas y plantillas. Lo del sistema solo lo cambia el propietario.
 */
import { ArrowRight, Building2, Coins, Eye, Languages, MessageSquareText, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/app/hooks';
import { useLive } from '@/data/live';
import type { Settings } from '@/domain/types';
import { todayLocal } from '@/lib/clock';
import { formatDate } from '@/lib/dates';
import { formatMoney, formatNumber, parseAmount } from '@/lib/money';
import { svc } from '@/services';
import { Badge, Button, EmptyState, LinkButton, PhotoInput, Select, TextInput, Toggle, useConfirm, useFileUrl } from '@/ui';
import { OwnerOnlyNote, SettingsSection, ToneIconButton, useSettingsPerms } from './SettingsSection';

const BASE_URL = import.meta.env.BASE_URL;

export function CompanySection({ settings }: { settings: Settings }) {
  const { actor, canSystem } = useSettingsPerms();
  const run = useAction();
  const [name, setName] = useState(settings.companyName);
  const [saving, setSaving] = useState(false);
  const logoUrl = useFileUrl(settings.logoFileId);
  const dirty = name.trim() !== settings.companyName;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await run(() => svc.system.updateSettings(actor, { companyName: name.trim() }), { success: 'Nombre guardado.' });
    setSaving(false);
  };

  return (
    <SettingsSection id="empresa" icon={Building2} title="Empresa" subtitle="Se ve en la barra de arriba, en la entrada y en los estados de cuenta.">
      {!canSystem && <OwnerOnlyNote>Solo el propietario cambia el nombre y el logo.</OwnerOnlyNote>}
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <div className="flex items-center gap-4">
          <img src={logoUrl ?? `${BASE_URL}logo.svg`} alt="Logo actual" className="h-20 w-20 shrink-0 rounded-lg border border-outline-variant object-cover" />
          {canSystem && (
            <PhotoInput
              camera={false}
              size="md"
              variant="secondary"
              label="Cambiar logo"
              onPhoto={async (blob) => {
                await run(() => svc.system.setCompanyLogo(actor, blob), { success: 'Logo actualizado.' });
              }}
            />
          )}
        </div>
        <form onSubmit={save} className="flex-1 space-y-3">
          <TextInput
            label="Nombre de la empresa"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canSystem}
            hint="Nombre provisional: «Gestor de Propiedades». Cámbialo cuando tengas el definitivo."
            data-testid="nombre-empresa"
          />
          {canSystem && (
            <Button type="submit" disabled={!dirty || name.trim().length < 2} loading={saving}>
              Guardar nombre
            </Button>
          )}
        </form>
      </div>
    </SettingsSection>
  );
}

const CURRENCIES: { code: string; name: string }[] = [
  { code: 'USD', name: 'Dólar estadounidense' },
  { code: 'EUR', name: 'Euro' },
  { code: 'MXN', name: 'Peso mexicano' },
  { code: 'COP', name: 'Peso colombiano' },
  { code: 'CAD', name: 'Dólar canadiense' },
  { code: 'GBP', name: 'Libra esterlina' },
  { code: 'DOP', name: 'Peso dominicano' },
];

export function CurrencySection({ settings }: { settings: Settings }) {
  const { actor, canSystem } = useSettingsPerms();
  const run = useAction();
  const confirm = useConfirm();
  const rates = useLive(() => svc.finance.listRates(actor), [actor]);
  const [currency, setCurrency] = useState('');
  const [rate, setRate] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const base = settings.baseCurrency;
  const today = todayLocal();
  const options = CURRENCIES.some((c) => c.code === base) ? CURRENCIES : [{ code: base, name: base }, ...CURRENCIES];

  // La vigente de cada moneda: la más reciente con fecha de hoy o anterior (listRates viene por moneda y fecha descendente).
  const currentIds = new Set<string>();
  const seen = new Set<string>();
  for (const r of rates ?? []) {
    if (r.date > today || seen.has(r.currency)) continue;
    seen.add(r.currency);
    currentIds.add(r.id);
  }

  const changeBase = async (code: string) => {
    if (code === base) return;
    const ok = await confirm({
      title: `¿Cambiar la moneda base a ${code}?`,
      body: 'Todo se consolidará en la nueva moneda. Lo ya registrado conserva su conversión y las tasas actuales quedan expresadas en la moneda anterior: revísalas.',
      confirmLabel: 'Cambiar',
    });
    if (ok) await run(() => svc.system.updateSettings(actor, { baseCurrency: code }), { success: `Moneda base: ${code}.` });
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const code = currency.trim().toUpperCase();
    const value = parseAmount(rate);
    if (!/^[A-Z]{3}$/.test(code)) return setError('Escribe el código de 3 letras (ej. EUR).');
    if (code === base) return setError('La moneda base no necesita tasa.');
    if (!Number.isFinite(value) || value <= 0) return setError('Escribe una tasa mayor que cero.');
    setError(undefined);
    setSaving(true);
    const saved = await run(() => svc.finance.setRate(actor, { currency: code, rate: value, date }), { success: `Tasa guardada: 1 ${code} = ${value} ${base}.` });
    setSaving(false);
    if (saved) {
      setCurrency('');
      setRate('');
    }
  };

  const remove = async (id: string, label: string) => {
    if (await confirm({ title: '¿Eliminar esta tasa?', body: `${label}. Los movimientos ya registrados conservan su conversión.`, confirmLabel: 'Eliminar', danger: true }))
      await run(() => svc.finance.removeRate(actor, id), { success: 'Tasa eliminada.' });
  };

  return (
    <SettingsSection id="monedas" icon={Coins} title="Monedas" subtitle="Cada propiedad registra en su moneda; todo se consolida en la moneda base con estas tasas manuales.">
      {!canSystem && <OwnerOnlyNote>Solo el propietario cambia la moneda base y las tasas.</OwnerOnlyNote>}
      <div className="space-y-6">
        <div className="max-w-md space-y-2">
          <Select
            label="Moneda base"
            value={base}
            disabled={!canSystem}
            onChange={(e) => changeBase(e.target.value)}
            options={options.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))}
          />
          <p className="text-body-sm text-on-surface-variant">Nunca se suman monedas distintas sin convertir. Cada movimiento usa la tasa vigente en su fecha.</p>
        </div>

        <div className="min-w-0">
          <p className="mb-2 text-label-md text-on-surface">Tasas de cambio (1 unidad = X {base})</p>
          {!rates ? null : rates.length === 0 ? (
            <EmptyState icon={Coins} title="Sin tasas" body="Agrega una si alguna propiedad registra en otra moneda." />
          ) : (
            <ul className="divide-y divide-outline-variant/40 rounded-md border border-outline-variant/60">
              {rates.map((r) => {
                const label = `1 ${r.currency} = ${formatNumber(r.rate, 6)} ${base}`;
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2 pr-1 pl-3">
                    <span className="w-11 shrink-0 text-label-md text-primary">{r.currency}</span>
                    <span className="min-w-0 flex-1">
                      <span className="tabular block text-body-sm text-on-surface">{label}</span>
                      <span className="block text-label-sm font-normal text-on-surface-variant">Desde el {formatDate(r.date, { year: true })}</span>
                    </span>
                    {currentIds.has(r.id) ? <Badge tone="good">Vigente</Badge> : <Badge tone="neutral">{r.date > today ? 'Futura' : 'Anterior'}</Badge>}
                    {canSystem && <ToneIconButton icon={Trash2} tone="danger" label={`Eliminar la tasa ${label}`} onClick={() => remove(r.id, label)} />}
                  </li>
                );
              })}
            </ul>
          )}

          {canSystem && (
            <form onSubmit={add} className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-surface-low p-3 md:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <TextInput label="Moneda" value={currency} maxLength={3} placeholder="EUR" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              <TextInput label={`Vale (en ${base})`} inputMode="decimal" value={rate} placeholder="1.08" onChange={(e) => setRate(e.target.value)} />
              <TextInput label="Desde" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <Button type="submit" icon={Plus} loading={saving} className="self-end">
                Agregar
              </Button>
              {error && <p className="col-span-2 text-label-sm text-error md:col-span-4">{error}</p>}
            </form>
          )}
        </div>
      </div>
    </SettingsSection>
  );
}

export function ApprovalSection({ settings }: { settings: Settings }) {
  const { actor, canSystem } = useSettingsPerms();
  const run = useAction();
  const [value, setValue] = useState(String(settings.approvalThreshold));
  const [saving, setSaving] = useState(false);
  const parsed = parseAmount(value);
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const base = settings.baseCurrency;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setSaving(true);
    await run(() => svc.system.updateSettings(actor, { approvalThreshold: parsed }), { success: `Umbral de aprobación: ${formatMoney(parsed, base)}.` });
    setSaving(false);
  };

  return (
    <SettingsSection id="aprobacion" icon={ShieldCheck} title="Aprobación de gastos" subtitle="Lo que pasa de este monto espera tu visto bueno antes de sumar.">
      {!canSystem && <OwnerOnlyNote>Solo el propietario cambia el umbral.</OwnerOnlyNote>}
      <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextInput
          label={`Umbral (${base})`}
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!canSystem}
          error={valid ? undefined : 'Escribe un monto válido.'}
          className="sm:w-48"
          data-testid="umbral-aprobacion"
        />
        {canSystem && (
          <Button type="submit" disabled={!valid || parsed === settings.approvalThreshold} loading={saving}>
            Guardar umbral
          </Button>
        )}
      </form>
      <p className="mt-3 text-body-sm text-on-surface-variant">
        Hoy: {formatMoney(settings.approvalThreshold, base)}. Los gastos que registre Administración (a mano o al cerrar una orden) por encima de ese monto quedan «por aprobar» y no suman
        hasta que el propietario los apruebe. Los del propietario entran directo.
      </p>
    </SettingsSection>
  );
}

export function PrivacySection({ settings }: { settings: Settings }) {
  const { actor, canSystem } = useSettingsPerms();
  const run = useAction();
  return (
    <SettingsSection id="privados" icon={Eye} title="Datos privados" subtitle="Compra, valor estimado, hipoteca, seguro y ROI de cada propiedad.">
      {!canSystem && <OwnerOnlyNote>Solo el propietario decide si se comparten.</OwnerOnlyNote>}
      <Toggle
        checked={settings.shareOwnerFinancials}
        disabled={!canSystem}
        onChange={(v) =>
          run(() => svc.system.updateSettings(actor, { shareOwnerFinancials: v }), {
            success: v ? 'Administración y Contabilidad ya ven los datos privados.' : 'Los datos privados vuelven a ser solo del propietario.',
          })
        }
        label="Compartir con Administración y Contabilidad"
        description={settings.shareOwnerFinancials ? 'Compartidos: también los ven Administración y Contabilidad.' : 'Ahora solo los ve el propietario.'}
      />
    </SettingsSection>
  );
}

export function LanguagesSection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="idiomas" icon={Languages} title="Idiomas" subtitle="Informativo: así habla la app con cada quien.">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md bg-surface-low p-4">
          <dt className="text-label-md text-on-surface">Equipo</dt>
          <dd className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="info">ES · Español</Badge>
          </dd>
          <dd className="mt-2 text-body-sm text-on-surface-variant">Propietario, administración, atención, limpieza, mantenimiento y contabilidad.</dd>
        </div>
        <div className="rounded-md bg-surface-low p-4">
          <dt className="text-label-md text-on-surface">Huéspedes e inquilinos</dt>
          <dd className="mt-2 flex flex-wrap items-center gap-2">
            {settings.guestLanguages.map((l) => (
              <Badge key={l} tone="good">
                {l === 'es' ? 'ES · Español' : 'EN · English'}
              </Badge>
            ))}
          </dd>
          <dd className="mt-2 text-body-sm text-on-surface-variant">Cada uno ve su app en el idioma de su ficha y lo cambia con el botón ES/EN. Las plantillas tienen las dos versiones.</dd>
        </div>
      </dl>
    </SettingsSection>
  );
}

export function TemplatesSection() {
  return (
    <SettingsSection id="plantillas" icon={MessageSquareText} title="Plantillas" subtitle="Bienvenida, llegada, salida, recordatorio de renta… en español e inglés.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-md text-on-surface-variant">Se editan junto a los mensajes, donde se usan.</p>
        <LinkButton to={{ pathname: '/huespedes', hash: '#plantillas' }} variant="secondary" iconRight={ArrowRight}>
          Abrir plantillas
        </LinkButton>
      </div>
    </SettingsSection>
  );
}
