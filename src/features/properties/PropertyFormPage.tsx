/**
 * Alta y edición de una propiedad (/propiedades/nueva y /propiedades/:id/editar).
 * Los datos privados (compra, hipoteca, seguro…) solo los ve y los manda el propietario.
 */
import type { LucideIcon } from 'lucide-react';
import { BedDouble, Building2, DoorOpen, Languages, Lock, MapPin, Save, SprayCan, Wallet } from 'lucide-react';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { useLive, useLiveResult } from '@/data/live';
import { PROPERTY_TYPE_LABEL, RENTAL_MODE_LABEL } from '@/domain/labels';
import { PROPERTY_TYPES, RENTAL_MODES } from '@/domain/types';
import { svc } from '@/services';
import { Button, Card, CardHeader, ErrorState, LinkButton, Loading, PageHeader, Select, TextArea, TextInput, useToast } from '@/ui';
import { buildInput, EMPTY_FORM, fromView, TIMEZONES, type FormErrors, type FormState } from './formModel';
import { hasAppHistory } from './shared';

const FORM_ID = 'formulario-propiedad';

function FormSection({ icon: Icon, title, subtitle, children }: { icon: LucideIcon; title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card padding="lg" as="section" aria-label={title}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-container text-primary">
              <Icon size={18} aria-hidden />
            </span>
            {title}
          </span>
        }
        subtitle={subtitle}
      />
      {children}
    </Card>
  );
}

function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="mt-2 text-label-md text-on-surface-variant md:col-span-full">{children}</h3>;
}

function PropertyForm({ initial, propertyId, isOwner }: { initial: FormState; propertyId?: string; isOwner: boolean }) {
  const actor = useActor();
  const navigate = useNavigate();
  const location = useLocation();
  const fromDetail = (location.state as { from?: string } | null)?.from === 'detail';
  const toast = useToast();
  const [run, busy] = useBusyAction();
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const editing = !!propertyId;

  const team = useLive(() => svc.system.listTeam(actor).catch(() => []), [actor]);
  const cleaners = useMemo(() => (team ?? []).filter((u) => u.role === 'cleaner' && (u.active || u.id === initial.defaultCleanerId)), [team, initial.defaultCleanerId]);
  const timezones = useMemo(
    () => (TIMEZONES.some((t) => t.value === initial.timezone) ? TIMEZONES : [...TIMEZONES, { value: initial.timezone, label: initial.timezone }]),
    [initial.timezone],
  );

  /** Props comunes de un campo de texto: valor, cambio, error e id (para enfocar el primer error). */
  const field = (key: keyof FormState) => ({
    id: `campo-${key}`,
    name: key,
    value: form[key],
    error: errors[key],
    onChange: (e: { target: { value: string } }) => {
      const value = e.target.value;
      setForm((f) => ({ ...f, [key]: value }));
      if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined }));
    },
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { errors: found, input } = buildInput(form, { includePrivate: isOwner });
    setErrors(found);
    if (!input) {
      toast.error('Revisa los campos marcados en rojo.');
      const first = Object.keys(found)[0];
      if (first) document.getElementById(`campo-${first}`)?.focus();
      return;
    }
    const saved = editing
      ? await run(() => svc.properties.updateProperty(actor, propertyId, input), { success: 'Cambios guardados.' })
      : await run(
          () =>
            svc.properties.createProperty(actor, {
              ...input,
              ownerPrivate: input.ownerPrivate ?? {},
              photos: [],
              statusOverride: 'none',
              vendorIds: [],
              notes: '',
            }),
          { success: 'Propiedad creada.' },
        );
    if (!saved) return;
    // Si se vino desde la ficha, se vuelve a esa misma entrada del historial (sin duplicarla).
    if (editing && fromDetail && hasAppHistory()) navigate(-1);
    else navigate(`/propiedades/${saved.id}`, { replace: true });
  };

  const cancel = () => {
    if (hasAppHistory()) navigate(-1);
    else navigate(editing ? `/propiedades/${propertyId}` : '/propiedades');
  };

  const usesNights = form.rentalMode !== 'monthly';

  return (
    <form id={FORM_ID} onSubmit={submit} noValidate className="space-y-6">
      <FormSection icon={Building2} title="Básicos" subtitle="Nombre, tipo y cómo se alquila.">
        <div className="grid gap-4 md:grid-cols-3">
          <TextInput label="Nombre" placeholder="Ej. Apartamento Brickell" autoComplete="off" {...field('name')} />
          <Select label="Tipo" options={PROPERTY_TYPES.map((t) => ({ value: t, label: PROPERTY_TYPE_LABEL[t] }))} {...field('type')} />
          <Select
            label="Modo de alquiler"
            options={RENTAL_MODES.map((m) => ({ value: m, label: RENTAL_MODE_LABEL[m] }))}
            hint={form.rentalMode === 'mixed' ? 'Por noches y por meses según la temporada.' : undefined}
            {...field('rentalMode')}
          />
        </div>
      </FormSection>

      <FormSection icon={MapPin} title="Ubicación" subtitle="Dirección, coordenadas para el mapa, zona horaria y moneda.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextInput label="País" autoComplete="country-name" {...field('country')} />
          <TextInput label="Región o estado" placeholder="Ej. FL" {...field('region')} />
          <TextInput label="Ciudad" autoComplete="address-level2" {...field('city')} />
          <TextInput label="Barrio" {...field('neighborhood')} />
          <div className="md:col-span-2">
            <TextInput label="Dirección" autoComplete="street-address" {...field('address')} />
          </div>
          <TextInput label="Latitud" type="number" step="any" inputMode="decimal" placeholder="25.7617" hint="Para el mapa. Cópiala de cualquier mapa en línea." {...field('lat')} />
          <TextInput label="Longitud" type="number" step="any" inputMode="decimal" placeholder="-80.1918" {...field('lng')} />
          <Select label="Zona horaria" options={timezones} hint="Las fechas de entrada y salida se cuentan en esta zona." {...field('timezone')} />
          <TextInput
            label="Moneda"
            maxLength={3}
            autoCapitalize="characters"
            hint="Código de 3 letras: USD, COP, MXN, EUR…"
            {...field('currency')}
            onChange={(e) => {
              const value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
              setForm((f) => ({ ...f, currency: value }));
              if (errors.currency) setErrors((x) => ({ ...x, currency: undefined }));
            }}
          />
        </div>
      </FormSection>

      <FormSection icon={BedDouble} title="Espacio" subtitle="Cuartos, baños, capacidad, tamaño y comodidades.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <TextInput label="Cuartos" type="number" min={0} step={1} inputMode="numeric" hint="0 si es estudio." {...field('bedrooms')} />
          <TextInput label="Baños" type="number" min={0} step={0.5} inputMode="decimal" {...field('bathrooms')} />
          <TextInput label="Capacidad" type="number" min={1} step={1} inputMode="numeric" hint="Personas." {...field('capacity')} />
          <TextInput label="Tamaño (m²)" type="number" min={0} step="any" inputMode="decimal" {...field('sizeM2')} />
          <div className="col-span-2 md:col-span-4">
            <TextInput label="Comodidades" hint="Separadas por coma." {...field('amenities')} />
          </div>
        </div>
      </FormSection>

      <FormSection icon={Wallet} title="Precios" subtitle={`En la moneda de la propiedad (${form.currency || '—'}).`}>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <TextInput label="Tarifa por noche" inputMode="decimal" placeholder={usesNights ? '0' : 'Opcional'} {...field('nightlyRate')} />
          <TextInput label="Cargo de limpieza" inputMode="decimal" hint="Lo paga el huésped." placeholder="0" {...field('cleaningFee')} />
          <TextInput label="Pago a limpieza por tarea" inputMode="decimal" hint="Lo que recibe quien limpia." placeholder="0" {...field('cleaningPay')} />
          <TextInput label="Renta mensual" inputMode="decimal" placeholder={form.rentalMode === 'monthly' ? '0' : 'Opcional'} {...field('monthlyRent')} />
          <TextInput label="Impuesto de hospedaje (%)" type="number" min={0} max={100} step="any" inputMode="decimal" hint="Ej. 13 para 13 %." {...field('taxPercent')} />
        </div>
      </FormSection>

      <FormSection icon={DoorOpen} title="Entrada" subtitle="Horarios y licencia de alquiler.">
        <div className="grid grid-cols-2 gap-4">
          <TextInput label="Hora de entrada" type="time" {...field('checkInTime')} />
          <TextInput label="Hora de salida" type="time" {...field('checkOutTime')} />
          <TextInput label="Número de licencia" placeholder="Opcional" {...field('licenseNumber')} />
          <TextInput label="Vence" type="date" {...field('licenseExpires')} />
        </div>
      </FormSection>

      <FormSection icon={Languages} title="Textos para huéspedes" subtitle="En español e inglés. Los ve el huésped durante su estadía.">
        <div className="grid gap-4 md:grid-cols-2">
          <TextArea label="Manual de la casa (ES)" rows={4} {...field('manualEs')} />
          <TextArea label="House manual (EN)" rows={4} lang="en" {...field('manualEn')} />
          <TextArea label="Instrucciones de entrada (ES)" rows={3} {...field('instructionsEs')} />
          <TextArea label="Check-in instructions (EN)" rows={3} lang="en" {...field('instructionsEn')} />
          <TextArea label="Cómo llegar (ES)" rows={3} {...field('directionsEs')} />
          <TextArea label="Directions (EN)" rows={3} lang="en" {...field('directionsEn')} />
        </div>
      </FormSection>

      <FormSection icon={SprayCan} title="Limpieza por defecto" subtitle="Quién recibe las limpiezas de salida de esta propiedad.">
        <Select
          label="Persona de limpieza"
          placeholder="Sin asignar"
          options={cleaners.map((u) => ({ value: u.id, label: u.title ? `${u.name} · ${u.title}` : u.name }))}
          className="md:max-w-md"
          {...field('defaultCleanerId')}
        />
      </FormSection>

      {isOwner && (
        <FormSection icon={Lock} title="Datos privados" subtitle="Solo tú los ves (salvo que los compartas en Ajustes).">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <TextInput label="Precio de compra" inputMode="decimal" {...field('purchasePrice')} />
            <TextInput label="Fecha de compra" type="date" {...field('purchaseDate')} />
            <TextInput label="Valor estimado" inputMode="decimal" {...field('estimatedValue')} />
            <SubTitle>Hipoteca</SubTitle>
            <div className="col-span-2 md:col-span-1">
              <TextInput label="Prestamista" {...field('mortgageLender')} />
            </div>
            <TextInput label="Cuota mensual" inputMode="decimal" {...field('mortgagePayment')} />
            <TextInput label="Saldo" inputMode="decimal" {...field('mortgageBalance')} />
            <SubTitle>Seguro</SubTitle>
            <TextInput label="Aseguradora" {...field('insuranceProvider')} />
            <TextInput label="Póliza" {...field('insurancePolicy')} />
            <TextInput label="Prima anual" inputMode="decimal" {...field('insurancePremium')} />
            <TextInput label="Vencimiento del seguro" type="date" {...field('insuranceExpires')} />
            <SubTitle>Gastos fijos</SubTitle>
            <TextInput label="HOA (al mes)" inputMode="decimal" {...field('hoaMonthly')} />
            <TextInput label="Impuesto predial (al año)" inputMode="decimal" {...field('propertyTaxAnnual')} />
          </div>
        </FormSection>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={cancel}>
          Cancelar
        </Button>
        <Button type="submit" icon={Save} loading={busy} data-testid="guardar-propiedad">
          {editing ? 'Guardar cambios' : 'Crear propiedad'}
        </Button>
      </div>
    </form>
  );
}

export default function PropertyFormPage() {
  const { id } = useParams();
  const actor = useActor();
  const isOwner = actor.user.role === 'owner';
  const existing = useLiveResult(() => (id ? svc.properties.getProperty(actor, id) : Promise.resolve(null)), [actor, id]);
  const [initial, setInitial] = useState<{ id: string | undefined; state: FormState } | null>(null);

  // El formulario arranca una sola vez con los datos guardados (no se pisa si cambian mientras editas).
  const loaded = id ? (existing.data?.id === id ? existing.data : undefined) : existing.data === null ? null : undefined;
  if (loaded !== undefined && (!initial || initial.id !== id)) {
    setInitial({ id, state: loaded ? fromView(loaded) : EMPTY_FORM });
  }

  const title = id ? 'Editar propiedad' : 'Nueva propiedad';
  if (existing.error && !existing.data)
    return (
      <div className="space-y-4">
        <PageHeader title={title} back="/propiedades" />
        <ErrorState error={existing.error} />
        <LinkButton to="/propiedades" variant="secondary">
          Ver todas las propiedades
        </LinkButton>
      </div>
    );
  if (!initial || initial.id !== id) return <Loading label="Cargando…" />;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        back={hasAppHistory() ? true : id ? `/propiedades/${id}` : '/propiedades'}
        title={title}
        subtitle={id ? existing.data?.name : 'Completa la ficha. Después podrás agregar fotos, códigos y documentos.'}
        actions={
          <div className="hidden md:block">
            <Button type="submit" form={FORM_ID} icon={Save}>
              Guardar
            </Button>
          </div>
        }
      />
      <PropertyForm key={id ?? 'nueva'} initial={initial.state} propertyId={id} isOwner={isOwner} />
    </div>
  );
}
