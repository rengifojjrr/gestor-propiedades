/**
 * Pruebas por rol: cada una intenta algo prohibido y tiene que fallar.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { data } from '@/data';
import { can, subjectFor, svc } from '@/services';
import { as, seedAt } from './helpers';

const DENIED = /permiso|solo mirar|no es tuya/i;

describe('permisos por rol', () => {
  beforeEach(async () => seedAt());

  it('la limpieza no ve finanzas ni reservas, y solo ve sus tareas y sus propiedades', async () => {
    const rosa = await as('u-clean-1');
    await expect(svc.finance.monthSummary(rosa, '2026-11')).rejects.toThrow(DENIED);
    await expect(svc.finance.listTransactions(rosa)).rejects.toThrow(DENIED);
    expect(await svc.bookings.listBookings(rosa)).toEqual([]);
    const tasks = await svc.operations.listCleaning(rosa);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((t) => t.assigneeId === 'u-clean-1')).toBe(true);
    const carlosTask = (await data().cleaningTasks.find((t) => t.assigneeId === 'u-clean-2'))[0];
    await expect(svc.operations.getCleaning(rosa, carlosTask.id)).rejects.toThrow(DENIED);
    await expect(svc.operations.addCleaningPhoto(rosa, carlosTask.id, 'before', new Blob(['x']))).rejects.toThrow(DENIED);
    const props = await svc.properties.listProperties(rosa);
    expect(props.map((p) => p.id).sort()).toEqual([...new Set(tasks.map((t) => t.propertyId))].sort());
    expect(props.every((p) => p.ownerPrivate === undefined && p.nightlyRate === undefined)).toBe(true);
    await expect(svc.properties.getProperty(rosa, 'p-houston')).rejects.toThrow(DENIED);
    await expect(svc.people.listPeople(rosa)).rejects.toThrow(DENIED);
  });

  it('el huésped solo ve su reserva y los códigos solo durante su estadía', async () => {
    const emily = await as('u-guest');
    const mine = await svc.bookings.listBookings(emily);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((b) => b.guestId === 'g-emily')).toBe(true);
    const other = (await data().bookings.find((b) => b.guestId === 'g-lucia'))[0];
    await expect(svc.bookings.getBooking(emily, other.id)).rejects.toThrow(DENIED);
    await expect(svc.properties.getProperty(emily, 'p-miami')).rejects.toThrow(DENIED);
    await expect(svc.properties.listAccessCodes(emily, 'p-orlando')).rejects.toThrow(DENIED);
    await expect(svc.finance.monthSummary(emily, '2026-11')).rejects.toThrow(DENIED);
    const home = await svc.bookings.guestHome(emily);
    expect(home.stay).toBe('during');
    expect(home.codes.find((c) => c.kind === 'gate')?.value).toBe('7316');
    const otherThread = (await data().threads.find((t) => t.personId !== 'g-emily'))[0];
    await expect(svc.people.getThread(emily, otherThread.id)).rejects.toThrow(DENIED);
  });

  it('el inquilino solo ve su contrato', async () => {
    const javier = await as('u-tenant');
    const leases = await svc.leases.listLeases(javier);
    expect(leases.map((l) => l.id)).toEqual(['ls-houston']);
    await expect(svc.leases.getLease(javier, 'ls-atlanta')).rejects.toThrow(DENIED);
    await expect(svc.leases.recordLeasePayment(javier, 'ls-houston', { period: '2026-11', amount: 1, paidOn: '2026-11-05', method: 'cash', reference: '', includeLateFee: false })).rejects.toThrow(DENIED);
    expect(await svc.bookings.listBookings(javier)).toEqual([]);
    const docs = await svc.documents.listDocuments(javier);
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((d) => d.visibility === 'tenant' && d.propertyId === 'p-houston')).toBe(true);
  });

  it('el técnico solo ve sus órdenes, sin finanzas', async () => {
    const tomas = await as('u-tech');
    const orders = await svc.operations.listOrders(tomas);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every((o) => o.assigneeUserId === 'u-tech')).toBe(true);
    const vendorOrder = (await data().maintenanceOrders.find((o) => o.vendorId === 'v-piscinas'))[0];
    await expect(svc.operations.getOrder(tomas, vendorOrder.id)).rejects.toThrow(DENIED);
    await expect(svc.finance.listTransactions(tomas)).rejects.toThrow(DENIED);
    await expect(svc.operations.listCleaning(tomas)).resolves.toEqual([]);
    await expect(svc.operations.approveOrder(tomas, vendorOrder.id)).rejects.toThrow(DENIED);
  });

  it('atención al cliente no ve finanzas ni documentos privados, pero sí reservas y mensajes', async () => {
    const diego = await as('u-support');
    await expect(svc.finance.monthSummary(diego, '2026-11')).rejects.toThrow(DENIED);
    await expect(svc.finance.exportCsv(diego)).rejects.toThrow(DENIED);
    const docs = await svc.documents.listDocuments(diego);
    expect(docs.some((d) => d.visibility === 'owner' || d.visibility === 'finance')).toBe(false);
    expect((await svc.bookings.listBookings(diego)).length).toBeGreaterThan(10);
    expect((await svc.people.listThreads(diego)).length).toBeGreaterThan(3);
    const b = (await data().bookings.all())[0];
    await expect(svc.bookings.cancelBooking(diego, b.id)).rejects.toThrow(DENIED);
    await expect(svc.bookings.addBookingNote(diego, b.id, 'Nota de atención')).resolves.toBeTruthy();
    const props = await svc.properties.listProperties(diego);
    expect(props.every((p) => p.ownerPrivate === undefined)).toBe(true);
  });

  it('contabilidad lee finanzas y exporta, pero no registra', async () => {
    const patricia = await as('u-accountant');
    await expect(svc.finance.monthSummary(patricia, '2026-11')).resolves.toBeTruthy();
    await expect(svc.finance.exportCsv(patricia)).resolves.toContain('fecha');
    await expect(svc.finance.recordManual(patricia, { type: 'expense', category: 'utilities', amount: 10, date: '2026-11-05', description: 'No debería' })).rejects.toThrow(DENIED);
    const docs = await svc.documents.listDocuments(patricia);
    expect(docs.every((d) => d.visibility === 'finance')).toBe(true);
  });

  it('administración no ve los datos privados del propietario salvo que los comparta, ni aprueba gastos', async () => {
    const mariana = await as('u-admin');
    const owner = await as('u-owner');
    expect((await svc.properties.getProperty(mariana, 'p-miami')).ownerPrivate).toBeUndefined();
    expect((await svc.properties.getProperty(owner, 'p-miami')).ownerPrivate?.purchasePrice).toBe(520000);
    await expect(svc.system.updateSettings(mariana, { approvalThreshold: 99999 })).rejects.toThrow(DENIED);
    await svc.system.updateSettings(owner, { shareOwnerFinancials: true });
    expect((await svc.properties.getProperty(mariana, 'p-miami')).ownerPrivate?.purchasePrice).toBe(520000);
  });

  it('«Ver como…» es solo mirar', async () => {
    const ownerAsCleaner = await as('u-clean-1', 'u-owner');
    expect(ownerAsCleaner.readOnly).toBe(true);
    const tasks = await svc.operations.listCleaning(ownerAsCleaner);
    expect(tasks.length).toBeGreaterThan(0);
    await expect(svc.operations.startCleaning(ownerAsCleaner, tasks[0].id)).rejects.toThrow(DENIED);
    const s = await subjectFor(ownerAsCleaner);
    expect(can(s, 'cleaning.read', { assigneeId: 'u-clean-1', propertyId: tasks[0].propertyId })).toBe(true);
    expect(can(s, 'cleaning.work', { assigneeId: 'u-clean-1', propertyId: tasks[0].propertyId })).toBe(false);
  });

  it('los códigos se destapan solo para propietario y administración, y queda en la auditoría', async () => {
    const owner = await as('u-owner');
    const codes = await svc.properties.listAccessCodes(owner, 'p-miami');
    expect(codes.every((c) => c.value === null && /^•+$/.test(c.masked))).toBe(true);
    expect(await svc.properties.revealAccessCode(owner, codes[0].id)).toBe('482913');
    const log = await svc.system.listAudit(owner);
    expect(log[0].action).toBe('property.revealCode');
    await expect(svc.properties.revealAccessCode(await as('u-support'), codes[0].id)).rejects.toThrow(DENIED);
  });

  it('la auditoría solo se agrega', async () => {
    const store = data();
    expect('put' in store.audit).toBe(false);
    expect('remove' in store.audit).toBe(false);
  });
});
