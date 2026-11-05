/** Cancelar una reserva confirmada (con motivo opcional, que queda como nota). */
import { useState } from 'react';
import { useBusyAction } from '@/app/hooks';
import { useActor } from '@/app/session';
import { formatRange } from '@/lib/dates';
import { svc, type BookingView } from '@/services';
import { Button, Modal, TextArea } from '@/ui';

export function CancelBookingModal({ booking, onClose, onDone }: { booking: BookingView; onClose: () => void; onDone?: () => void }) {
  const actor = useActor();
  const [run, busy] = useBusyAction();
  const [reason, setReason] = useState('');
  const submit = async () => {
    const ok = await run(() => svc.bookings.cancelBooking(actor, booking.id, reason.trim()), { success: `Reserva ${booking.code} cancelada: las fechas quedan libres.` });
    if (ok) {
      onDone?.();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`¿Cancelar la reserva ${booking.code}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} data-testid="confirmar-cancelacion">
            Cancelar reserva
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-body-md text-on-surface-variant">
          {booking.guestName} · {booking.propertyName} · {formatRange(booking.checkIn, booking.checkOut)}. Las fechas quedan libres para otra reserva.
        </p>
        <TextArea label="Motivo (opcional)" hint="Queda anotado en la reserva." value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Ej.: el huésped cambió de planes" />
      </div>
    </Modal>
  );
}
