import { beforeEach, describe, expect, it } from 'vitest';
import { data } from '@/data';
import { svc } from '@/services';
import { as, seedAt, TODAY } from './helpers';

const img = () => new Blob(['foto'], { type: 'image/webp' });

describe('limpieza de salida: se crea sola', () => {
  beforeEach(async () => seedAt());

  it('al registrar la salida se crea una sola limpieza de salida, asignada a la limpieza de la propiedad', async () => {
    const admin = await as('u-admin');
    const tour = (await data().bookings.all()).find((b) => b.guestId === 'g-lucia')!;
    expect(tour.checkOut).toBe(TODAY);
    expect(tour.status).toBe('in_progress');
    const { booking, cleaningTask } = await svc.bookings.checkOutBooking(admin, tour.id);
    expect(booking.status).toBe('completed');
    expect(cleaningTask.type).toBe('checkout');
    expect(cleaningTask.assigneeId).toBe('u-clean-1');
    expect(cleaningTask.guestName).toBe('Lucía Fernández');
    expect(cleaningTask.nextCheckIn).toBeDefined();
    // idempotente
    const again = await svc.bookings.checkOutBooking(admin, tour.id);
    expect(again.cleaningTask.id).toBe(cleaningTask.id);
    expect((await data().cleaningTasks.find((t) => t.bookingId === tour.id)).length).toBe(1);
    // ingreso y comisión registrados una sola vez
    const txs = await data().transactions.find((t) => t.source.id === tour.id);
    expect(txs.filter((t) => t.type === 'income')).toHaveLength(1);
  });

  it('el avance automático cierra las estadías que terminaron ayer y crea su limpieza', async () => {
    await seedAt(`${TODAY}T10:00:00`);
    const { clock } = await import('@/lib/clock');
    clock.setFixed('2026-11-06T09:00:00', 'America/New_York');
    await svc.system.tick();
    const tour = (await data().bookings.all()).find((b) => b.guestId === 'g-lucia')!;
    expect(tour.status).toBe('completed');
    expect((await data().cleaningTasks.find((t) => t.bookingId === tour.id && t.type === 'checkout')).length).toBe(1);
  });

  it('no se puede cerrar sin fotos de antes y después y la checklist completa; al cerrar, el pago va a gastos', async () => {
    const admin = await as('u-admin');
    const rosa = await as('u-clean-1');
    const tour = (await data().bookings.all()).find((b) => b.guestId === 'g-lucia')!;
    const { cleaningTask } = await svc.bookings.checkOutBooking(admin, tour.id);
    await expect(svc.operations.completeCleaning(rosa, cleaningTask.id)).rejects.toThrow(/foto de «antes»/);
    await svc.operations.addCleaningPhoto(rosa, cleaningTask.id, 'before', img());
    await expect(svc.operations.completeCleaning(rosa, cleaningTask.id)).rejects.toThrow(/«después»/);
    await svc.operations.addCleaningPhoto(rosa, cleaningTask.id, 'after', img());
    await expect(svc.operations.completeCleaning(rosa, cleaningTask.id)).rejects.toThrow(/checklist/);
    const task = (await data().cleaningTasks.get(cleaningTask.id))!;
    for (let i = 0; i < task.items.length; i++) await svc.operations.setCleaningItem(rosa, task.id, i, true);
    const done = await svc.operations.completeCleaning(rosa, task.id);
    expect(done.status).toBe('done');
    const exp = await data().transactions.get(done.expenseId!);
    expect(exp?.category).toBe('cleaning');
    expect(exp?.amount).toBe(75);
  });

  it('el daño reportado en la limpieza se vuelve incidencia y, si es urgente, orden de mantenimiento urgente', async () => {
    const admin = await as('u-admin');
    const rosa = await as('u-clean-1');
    const tour = (await data().bookings.all()).find((b) => b.guestId === 'g-lucia')!;
    const { cleaningTask } = await svc.bookings.checkOutBooking(admin, tour.id);
    const { incident, order } = await svc.operations.reportDamage(rosa, cleaningTask.id, { title: 'Fuga bajo el lavamanos', description: 'Gotea el sifón', category: 'plumbing', severity: 'urgent', kind: 'damage' }, img());
    expect(incident.source).toBe('cleaning');
    expect(order?.priority).toBe('urgent');
    expect(order?.assigneeUserId).toBe('u-tech');
    expect(order?.photos).toHaveLength(1);
    const low = await svc.operations.reportDamage(rosa, cleaningTask.id, { title: 'Falta una toalla', description: '', category: 'general', severity: 'low', kind: 'missing' });
    expect(low.order).toBeUndefined();
  });
});
