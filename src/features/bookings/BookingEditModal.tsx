/** Editar una reserva: fechas, personas, tarifa, limpieza y canal. Los cruces llegan como aviso. */
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { bookingMoney, nights as countNights } from '@/domain/rules';
import type { Channel } from '@/domain/types';
import { addDays } from '@/lib/dates';
import { parseAmount } from '@/lib/money';
import type { BookingView } from '@/services';
import { svc } from '@/services';
import { Button, Card, Modal, Select, TextInput } from '@/ui';
import { CHANNEL_OPTIONS, MoneyBreakdown } from './shared';

export function BookingEditModal({ booking, taxRate, capacity, onClose }: { booking: BookingView; taxRate?: number; capacity?: number; onClose: () => void }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [checkIn, setCheckIn] = useState(booking.checkIn);
  const [checkOut, setCheckOut] = useState(booking.checkOut);
  const [guests, setGuests] = useState(String(booking.guests));
  const [rate, setRate] = useState(String(booking.nightlyRate));
  const [cleaning, setCleaning] = useState(String(booking.cleaningFee));
  const [channel, setChannel] = useState<Channel>(booking.channel);

  const n = checkIn && checkOut && checkOut > checkIn ? countNights(checkIn, checkOut) : 0;
  const nightlyRate = parseAmount(rate);
  const cleaningFee = parseAmount(cleaning);
  const guestCount = Number(guests);
  const errors = {
    checkOut: checkIn && checkOut && checkOut <= checkIn ? 'La salida debe ser después de la entrada' : undefined,
    guests: !Number.isInteger(guestCount) || guestCount < 1 ? 'Al menos 1 persona' : capacity && guestCount > capacity ? `Máximo ${capacity} personas` : undefined,
    rate: !(nightlyRate > 0) ? 'Escribe la tarifa' : undefined,
    cleaning: !(cleaningFee >= 0) ? 'Escribe la limpieza (0 si no se cobra)' : undefined,
  };
  const valid = n > 0 && !errors.checkOut && !errors.guests && !errors.rate && !errors.cleaning;
  const preview = valid && taxRate != null ? bookingMoney({ nightlyRate, nights: n, cleaningFee, channel, taxRate }) : null;

  const submit = async () => {
    if (!valid) return;
    const ok = await run(
      () => svc.bookings.updateBooking(actor, booking.id, { checkIn, checkOut, guests: guestCount, nightlyRate, cleaningFee, channel }),
      { success: `Reserva ${booking.code} actualizada` },
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`Editar ${booking.code}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!valid} data-testid="guardar-reserva">
            Guardar cambios
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextInput
              label="Entrada"
              type="date"
              value={checkIn}
              onChange={(e) => {
                setCheckIn(e.target.value);
                if (e.target.value && checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1));
              }}
            />
            <TextInput label="Salida" type="date" value={checkOut} min={checkIn ? addDays(checkIn, 1) : undefined} onChange={(e) => setCheckOut(e.target.value)} error={errors.checkOut} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Personas" type="number" inputMode="numeric" min={1} max={capacity} value={guests} onChange={(e) => setGuests(e.target.value)} error={errors.guests} hint={capacity ? `Máximo ${capacity}` : undefined} />
            <Select label="Canal" value={channel} onChange={(e) => setChannel(e.target.value as Channel)} options={CHANNEL_OPTIONS} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label={`Tarifa por noche (${booking.currency})`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} error={errors.rate} />
            <TextInput label={`Limpieza (${booking.currency})`} inputMode="decimal" value={cleaning} onChange={(e) => setCleaning(e.target.value)} error={errors.cleaning} />
          </div>
          {booking.needsDetails && <p className="text-body-sm text-on-surface-variant">Al guardar, la reserva deja de estar «por completar».</p>}
        </div>
        {preview && (
          <Card tone="muted" padding="sm" className="self-start">
            <p className="mb-1 text-label-md text-primary">
              Así queda: {n} {n === 1 ? 'noche' : 'noches'}
            </p>
            <MoneyBreakdown m={{ ...preview, nightlyRate, nights: n, currency: booking.currency, channel }} taxRate={taxRate} />
          </Card>
        )}
      </div>
    </Modal>
  );
}
