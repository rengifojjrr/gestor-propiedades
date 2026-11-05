/**
 * Nueva reserva (`/reservas/nueva`): propiedad (por noches o mixta), huésped existente o nuevo, canal,
 * fechas, personas y precios, con resumen en vivo (bookingMoney) y aviso de cruces antes de guardar.
 * Si el huésped está marcado «no volver a alquilar», se pide confirmación y se reintenta.
 */
import { AlertTriangle, CalendarCheck, CalendarX, Check, Search, UserPlus, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useActor } from '@/app/session';
import { useLive } from '@/data/live';
import { bookingMoney, nights as countNights, rangesOverlap } from '@/domain/rules';
import type { Channel, Lang } from '@/domain/types';
import { todayLocal } from '@/lib/clock';
import { addDays, formatDate, formatRange } from '@/lib/dates';
import { parseAmount } from '@/lib/money';
import { errorMessage, svc, ValidationError } from '@/services';
import { Avatar, Badge, Banner, Button, Card, CardHeader, cn, PageHeader, SearchInput, Select, TextArea, TextInput, useConfirm, useToast } from '@/ui';
import { CHANNEL_OPTIONS, findFreeWindows, humanizeDates, MoneyBreakdown, occupiedRanges } from './shared';

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export default function BookingFormPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [params] = useSearchParams();
  const today = todayLocal();

  const allProperties = useLive(() => svc.properties.listProperties(actor), [actor]);
  const properties = useMemo(() => (allProperties ?? []).filter((p) => p.rentalMode !== 'monthly'), [allProperties]);
  const guests = useLive(() => svc.people.listPeople(actor, { kind: 'guest' }), [actor]);
  const horizon = addDays(today, 365);
  const occ = useLive(() => svc.bookings.calendarData(actor, addDays(today, -1), horizon), [actor, today, horizon]);

  const [propertyId, setPropertyId] = useState(params.get('propiedad') ?? '');
  const [dates, setDates] = useState({ checkIn: '', checkOut: '', touched: false, suggested: false });
  const [guestMode, setGuestMode] = useState<'existing' | 'new'>('existing');
  const [guestId, setGuestId] = useState('');
  const [guestQuery, setGuestQuery] = useState('');
  const [newGuest, setNewGuest] = useState<{ name: string; email: string; phone: string; language: Lang }>({ name: '', email: '', phone: '', language: 'es' });
  const [channel, setChannel] = useState<Channel>('direct');
  const [guestCount, setGuestCount] = useState('2');
  const [rateText, setRateText] = useState<string | null>(null);
  const [cleaningText, setCleaningText] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const property = properties.find((p) => p.id === propertyId);
  const pid = property?.id ?? '';

  // Propone las primeras 3 noches libres de la propiedad (mientras no se toquen las fechas).
  useEffect(() => {
    if (!occ || !pid || dates.touched) return;
    const w = findFreeWindows(occupiedRanges(occ, pid), addDays(today, 1), [3])[0];
    if (w && (w.start !== dates.checkIn || w.end !== dates.checkOut)) setDates({ checkIn: w.start, checkOut: w.end, touched: false, suggested: true });
  }, [occ, pid, dates.touched, dates.checkIn, dates.checkOut, today]);

  const { checkIn, checkOut } = dates;
  const rate = parseAmount(rateText ?? String(property?.nightlyRate ?? ''));
  const cleaningFee = parseAmount(cleaningText ?? String(property?.cleaningFee ?? ''));
  const n = checkIn && checkOut && checkOut > checkIn ? countNights(checkIn, checkOut) : 0;
  const people = Number(guestCount);
  const selectedGuest = guests?.find((g) => g.id === guestId);

  const conflicts = useMemo(() => {
    if (!occ || !pid || !n || checkOut > horizon) return [];
    return occupiedRanges(occ, pid).filter((o) => rangesOverlap(checkIn, checkOut, o.start, o.end));
  }, [occ, pid, n, checkIn, checkOut, horizon]);

  const errors = {
    property: !property ? 'Elige una propiedad' : undefined,
    guest:
      guestMode === 'existing'
        ? !guestId
          ? 'Elige un huésped (o crea uno nuevo)'
          : undefined
        : newGuest.name.trim().length < 2
          ? 'Escribe el nombre del huésped'
          : undefined,
    checkIn: !checkIn ? 'Elige la entrada' : undefined,
    checkOut: !checkOut ? 'Elige la salida' : checkIn && checkOut <= checkIn ? 'La salida debe ser después de la entrada' : undefined,
    guests: !Number.isInteger(people) || people < 1 ? 'Al menos 1 persona' : property && people > property.capacity ? `${property.name} recibe máximo ${property.capacity} personas` : undefined,
    rate: !(rate > 0) ? 'Escribe la tarifa por noche' : undefined,
    cleaning: !(cleaningFee >= 0) ? 'Escribe la limpieza (0 si no se cobra)' : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (e?: string) => (tried ? e : undefined);
  const preview = property && n > 0 && rate > 0 && cleaningFee >= 0 ? bookingMoney({ nightlyRate: rate, nights: n, cleaningFee, channel, taxRate: property.taxRate }) : null;

  const guestMatches = useMemo(() => {
    const list = (guests ?? []).filter((g) => !g.tags.includes('Importado'));
    const q = normalize(guestQuery.trim());
    return (q ? list.filter((g) => normalize(`${g.name} ${g.email ?? ''} ${g.phone ?? ''}`).includes(q)) : list).slice(0, 6);
  }, [guests, guestQuery]);

  const submit = async (allowDoNotRent = false): Promise<void> => {
    setTried(true);
    setError(null);
    if (!valid || !property) return;
    setBusy(true);
    try {
      const b = await svc.bookings.createBooking(actor, {
        propertyId: property.id,
        guestId: guestMode === 'existing' ? guestId : undefined,
        newGuest:
          guestMode === 'new'
            ? { name: newGuest.name.trim(), email: newGuest.email.trim() || undefined, phone: newGuest.phone.trim() || undefined, language: newGuest.language }
            : undefined,
        channel,
        checkIn,
        checkOut,
        guests: people,
        nightlyRate: rate,
        cleaningFee,
        note: note.trim() || undefined,
        allowDoNotRent,
      });
      toast.success(`Reserva ${b.code} creada`);
      navigate(`/reservas/${b.id}`, { replace: true });
    } catch (err) {
      const msg = humanizeDates(err instanceof ValidationError ? err.issues.map((i) => i.message).join(' · ') : errorMessage(err));
      if (!allowDoNotRent && /no volver a alquilar/i.test(msg)) {
        setBusy(false);
        const ok = await confirm({ title: '¿Reservar de todas formas?', body: msg, confirmLabel: 'Sí, reservar', cancelLabel: 'No', danger: true });
        if (ok) return submit(true);
        return;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Nueva reserva" subtitle="Reserva por noches: elige la propiedad, el huésped y las fechas." back="/reservas" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Propiedad y fechas" />
            <div className="space-y-4">
              <Select
                label="Propiedad"
                value={property?.id ?? ''}
                placeholder="Elige una propiedad"
                onChange={(e) => {
                  setPropertyId(e.target.value);
                  setRateText(null);
                  setCleaningText(null);
                }}
                options={properties.map((p) => ({ value: p.id, label: `${p.name} · ${p.city}` }))}
                error={show(errors.property)}
                hint="Solo las que se alquilan por noches o en modo mixto."
                data-testid="reserva-propiedad"
              />
              <div className="grid grid-cols-2 gap-3">
                <TextInput
                  label="Entrada"
                  type="date"
                  value={checkIn}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDates((d) => ({ checkIn: v, checkOut: v && d.checkOut <= v ? addDays(v, 1) : d.checkOut, touched: true, suggested: false }));
                  }}
                  error={show(errors.checkIn)}
                  data-testid="reserva-entrada"
                />
                <TextInput
                  label="Salida"
                  type="date"
                  value={checkOut}
                  min={checkIn ? addDays(checkIn, 1) : undefined}
                  onChange={(e) => {
                    const v = e.target.value;
                    setDates((d) => ({ ...d, checkOut: v, touched: true, suggested: false }));
                  }}
                  error={show(errors.checkOut)}
                  data-testid="reserva-salida"
                />
              </div>
              {property && n > 0 && checkOut <= horizon && occ && (
                <Banner tone={conflicts.length ? 'bad' : 'good'} icon={conflicts.length ? CalendarX : CalendarCheck}>
                  {conflicts.length ? (
                    <>
                      <strong>Se cruza con {conflicts[0].label}</strong> ({formatRange(conflicts[0].start, conflicts[0].end)}). Elige otras fechas.
                    </>
                  ) : (
                    <>
                      <strong>Fechas libres</strong> en {property.name}: {n} {n === 1 ? 'noche' : 'noches'}, del {formatDate(checkIn)} al {formatDate(checkOut)}.
                      {dates.suggested && ' Son las primeras fechas libres: cámbialas si quieres.'}
                    </>
                  )}
                </Banner>
              )}
              <TextInput
                label="Personas"
                type="number"
                inputMode="numeric"
                min={1}
                max={property?.capacity}
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
                error={show(errors.guests) ?? (property && people > property.capacity ? errors.guests : undefined)}
                hint={property ? `Máximo ${property.capacity} personas` : undefined}
                className="max-w-40"
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Huésped" />
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-md bg-surface-container p-1" role="radiogroup" aria-label="Tipo de huésped">
              {(
                [
                  { id: 'existing', label: 'Huésped existente', icon: UserRound },
                  { id: 'new', label: 'Huésped nuevo', icon: UserPlus },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={guestMode === o.id}
                  onClick={() => setGuestMode(o.id)}
                  className={cn(
                    'flex h-10 items-center justify-center gap-2 rounded-md text-label-md transition-colors',
                    guestMode === o.id ? 'bg-surface-lowest text-primary shadow-card' : 'text-on-surface-variant hover:text-primary',
                  )}
                >
                  <o.icon size={16} aria-hidden />
                  {o.label}
                </button>
              ))}
            </div>

            {guestMode === 'existing' ? (
              selectedGuest ? (
                <div className="flex items-center gap-3 rounded-md border border-secondary bg-secondary-container/40 p-3">
                  <Avatar name={selectedGuest.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label-md text-primary">{selectedGuest.name}</p>
                    <p className="truncate text-body-sm text-on-surface-variant">
                      {[selectedGuest.email, selectedGuest.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'} · {selectedGuest.language === 'en' ? 'inglés' : 'español'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setGuestId('')}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <SearchInput value={guestQuery} onChange={setGuestQuery} placeholder="Nombre, correo o teléfono" label="Buscar huésped" />
                  {!guests ? (
                    <p className="text-body-sm text-on-surface-variant">Cargando huéspedes…</p>
                  ) : guestMatches.length === 0 ? (
                    <div className="flex flex-col items-start gap-2 rounded-md bg-surface-low p-3">
                      <p className="text-body-sm text-on-surface-variant">
                        <Search size={14} className="mr-1 inline" aria-hidden />
                        No hay huéspedes con «{guestQuery}».
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={UserPlus}
                        onClick={() => {
                          setGuestMode('new');
                          setNewGuest((g) => ({ ...g, name: guestQuery }));
                        }}
                      >
                        Crear «{guestQuery}»
                      </Button>
                    </div>
                  ) : (
                    <ul className="divide-y divide-outline-variant/60 rounded-md border border-outline-variant/60" aria-label="Huéspedes">
                      {guestMatches.map((g) => (
                        <li key={g.id}>
                          <button type="button" onClick={() => setGuestId(g.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-low">
                            <Avatar name={g.name} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-label-md text-primary">{g.name}</span>
                              <span className="block truncate text-body-sm text-on-surface-variant">
                                {g.stays ? `${g.stays} ${g.stays === 1 ? 'estadía' : 'estadías'}` : 'Sin estadías'} · {g.language === 'en' ? 'inglés' : 'español'}
                              </span>
                            </span>
                            {g.doNotRent && (
                              <Badge tone="bad" icon={AlertTriangle}>
                                No volver a alquilar
                              </Badge>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {show(errors.guest) && <p className="text-label-sm text-error">{errors.guest}</p>}
                  {!guestQuery && guests && guests.length > guestMatches.length && (
                    <p className="text-label-sm font-normal text-on-surface-variant">Escribe para buscar entre {guests.length} huéspedes.</p>
                  )}
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <TextInput
                  label="Nombre completo"
                  value={newGuest.name}
                  onChange={(e) => setNewGuest((g) => ({ ...g, name: e.target.value }))}
                  error={show(errors.guest)}
                  autoComplete="off"
                  data-testid="huesped-nombre"
                />
                <Select
                  label="Idioma de los mensajes"
                  value={newGuest.language}
                  onChange={(e) => setNewGuest((g) => ({ ...g, language: e.target.value as Lang }))}
                  options={[
                    { value: 'es', label: 'Español (ES)' },
                    { value: 'en', label: 'Inglés (EN)' },
                  ]}
                />
                <TextInput label="Correo (opcional)" type="email" value={newGuest.email} onChange={(e) => setNewGuest((g) => ({ ...g, email: e.target.value }))} autoComplete="off" />
                <TextInput label="Teléfono (opcional)" type="tel" value={newGuest.phone} onChange={(e) => setNewGuest((g) => ({ ...g, phone: e.target.value }))} autoComplete="off" />
              </div>
            )}

            {guestMode === 'existing' && selectedGuest?.doNotRent && (
              <Banner tone="bad" icon={AlertTriangle} className="mt-3">
                <strong>{selectedGuest.name} está marcado «No volver a alquilar».</strong> Si sigues, te pediremos confirmar.
              </Banner>
            )}
          </Card>

          <Card>
            <CardHeader title="Canal y precio" subtitle={property ? `Tarifa y limpieza de ${property.name}; puedes cambiarlas.` : undefined} />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="col-span-2 md:col-span-1">
                <Select label="Canal" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} options={CHANNEL_OPTIONS} />
              </div>
              <TextInput
                label={`Tarifa por noche${property ? ` (${property.currency})` : ''}`}
                inputMode="decimal"
                value={rateText ?? String(property?.nightlyRate ?? '')}
                onChange={(e) => setRateText(e.target.value)}
                error={show(errors.rate)}
              />
              <TextInput
                label={`Limpieza${property ? ` (${property.currency})` : ''}`}
                inputMode="decimal"
                value={cleaningText ?? String(property?.cleaningFee ?? '')}
                onChange={(e) => setCleaningText(e.target.value)}
                error={show(errors.cleaning)}
              />
            </div>
            <div className="mt-4">
              <TextArea label="Nota interna (opcional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ej.: llegan en vuelo nocturno" />
            </div>
          </Card>
        </div>

        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardHeader title="Resumen" subtitle={property ? property.name : 'Elige una propiedad para ver los montos.'} />
            {preview && property ? (
              <>
                <p className="mb-2 text-body-sm text-on-surface-variant">
                  {formatRange(checkIn, checkOut)} · {n} {n === 1 ? 'noche' : 'noches'} · {people || 0} {people === 1 ? 'persona' : 'personas'}
                </p>
                <MoneyBreakdown m={{ ...preview, nightlyRate: rate, nights: n, currency: property.currency, channel }} taxRate={property.taxRate} />
              </>
            ) : (
              <p className="text-body-sm text-on-surface-variant">Completa la propiedad, las fechas y la tarifa.</p>
            )}
            {error && (
              <Banner tone="bad" icon={CalendarX} className="mt-4">
                {error}
              </Banner>
            )}
            {tried && !valid && !error && (
              <p className="mt-4 text-label-sm text-error" role="alert">
                Revisa los datos marcados en rojo.
              </p>
            )}
            <Button fullWidth size="lg" icon={Check} className="mt-4" onClick={() => submit()} loading={busy} data-testid="crear-reserva">
              Crear reserva
            </Button>
            <p className="mt-2 text-center text-label-sm font-normal text-on-surface-variant">La reserva queda confirmada y se abre su conversación.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
