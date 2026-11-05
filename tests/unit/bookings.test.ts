import { beforeEach, describe, expect, it } from 'vitest';
import { data } from '@/data';
import { findConflict, rangesOverlap } from '@/domain/rules';
import { svc } from '@/services';
import { as, seedAt, TODAY } from './helpers';
import { addDays } from '@/lib/dates';

describe('reservas: nunca se cruzan', () => {
  beforeEach(async () => seedAt());

  it('rangos: la salida de una puede ser la entrada de otra', () => {
    expect(rangesOverlap('2026-11-10', '2026-11-15', '2026-11-15', '2026-11-18')).toBe(false);
    expect(rangesOverlap('2026-11-10', '2026-11-15', '2026-11-14', '2026-11-18')).toBe(true);
    expect(rangesOverlap('2026-11-10', '2026-11-15', '2026-11-11', '2026-11-12')).toBe(true);
  });

  it('el servicio rechaza una reserva que se cruza en la misma propiedad', async () => {
    const admin = await as('u-admin');
    // Daniel Kim llega mañana a Miami (seed): intentar cruzar sus fechas
    const input = { propertyId: 'p-miami', channel: 'direct' as const, checkIn: addDays(TODAY, 2), checkOut: addDays(TODAY, 4), guests: 2, newGuest: { name: 'Prueba Cruce', language: 'es' as const } };
    await expect(svc.bookings.createBooking(admin, input)).rejects.toThrow(/Se cruza/);
  });

  it('permite la misma fecha en otra propiedad y el cambio de huésped el mismo día', async () => {
    const admin = await as('u-admin');
    const bookings = await data().bookings.all();
    const daniel = bookings.find((b) => b.guestId === 'g-daniel')!;
    // mismo día de salida = entrada: no se cruza
    const next = bookings.filter((b) => b.propertyId === 'p-miami' && b.checkIn > daniel.checkOut).sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
    const free = findConflict('p-miami', daniel.checkOut, next.checkIn, bookings, await data().blocks.all());
    expect(free).toBeNull();
    const created = await svc.bookings.createBooking(admin, { propertyId: 'p-miami', channel: 'direct', checkIn: daniel.checkOut, checkOut: next.checkIn, guests: 1, newGuest: { name: 'Huésped Puente', language: 'es' } });
    expect(created.status).toBe('confirmed');
    // en Tampa las fechas de Daniel están libres (otra propiedad)… salvo el bloqueo: se usa un rango posterior
    const other = await svc.bookings.createBooking(admin, { propertyId: 'p-sanjuan', channel: 'airbnb', checkIn: addDays(TODAY, 40), checkOut: addDays(TODAY, 43), guests: 2, newGuest: { name: 'Otra Propiedad', language: 'en' } });
    expect(other.propertyId).toBe('p-sanjuan');
  });

  it('los bloqueos y los contratos también cuentan como ocupado', async () => {
    const admin = await as('u-admin');
    await expect(
      svc.bookings.createBooking(admin, { propertyId: 'p-tampa', channel: 'direct', checkIn: TODAY, checkOut: addDays(TODAY, 2), guests: 2, newGuest: { name: 'Bloqueo', language: 'es' } }),
    ).rejects.toThrow(/bloqueo/i);
    await expect(
      svc.bookings.createBooking(admin, { propertyId: 'p-atlanta', channel: 'direct', checkIn: addDays(TODAY, 3), checkOut: addDays(TODAY, 6), guests: 1, newGuest: { name: 'Contrato', language: 'es' } }),
    ).rejects.toThrow(/contrato/i);
  });

  it('una reserva cancelada libera las fechas', async () => {
    const admin = await as('u-admin');
    const daniel = (await data().bookings.all()).find((b) => b.guestId === 'g-daniel')!;
    await svc.bookings.cancelBooking(admin, daniel.id, 'prueba');
    const again = await svc.bookings.createBooking(admin, { propertyId: 'p-miami', channel: 'direct', checkIn: daniel.checkIn, checkOut: daniel.checkOut, guests: 2, newGuest: { name: 'Reemplazo', language: 'es' } });
    expect(again.status).toBe('confirmed');
  });

  it('marca «no volver a alquilar» exige confirmar', async () => {
    const admin = await as('u-admin');
    const input = { propertyId: 'p-sanjuan', guestId: 'g-kevin', channel: 'direct' as const, checkIn: addDays(TODAY, 60), checkOut: addDays(TODAY, 62), guests: 2 };
    await expect(svc.bookings.createBooking(admin, input)).rejects.toThrow(/no volver a alquilar/);
    const ok = await svc.bookings.createBooking(admin, { ...input, allowDoNotRent: true });
    expect(ok.guestId).toBe('g-kevin');
  });
});
