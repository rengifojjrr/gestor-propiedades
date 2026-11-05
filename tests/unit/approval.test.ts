import { beforeEach, describe, expect, it } from 'vitest';
import { data } from '@/data';
import { svc } from '@/services';
import { as, seedAt } from './helpers';

const photo = () => new Blob(['ok'], { type: 'image/webp' });

describe('umbral de aprobación de gastos', () => {
  beforeEach(async () => seedAt());

  it('debajo del umbral el costo entra directo a gastos; encima queda pendiente hasta que el propietario aprueba', async () => {
    const tech = await as('u-tech');
    const owner = await as('u-owner');
    const admin = await as('u-admin');
    const [order] = await svc.operations.listOrders(tech, { status: ['open', 'scheduled'] });
    await expect(svc.operations.resolveOrder(tech, order.id, { actualCost: 200, materials: [], note: '' })).rejects.toThrow(/foto/);
    await svc.operations.addOrderPhoto(tech, order.id, 'resolved', photo());
    const small = await svc.operations.resolveOrder(tech, order.id, { actualCost: 200, materials: [], note: 'listo' });
    expect(small.expenseStatus).toBe('posted');

    const big = await svc.operations.createOrder(admin, { propertyId: 'p-houston', title: 'Cambiar calentador', description: '', category: 'plumbing', priority: 'high', assigneeUserId: 'u-tech' });
    await svc.operations.addOrderPhoto(tech, big.id, 'resolved', photo());
    const res = await svc.operations.resolveOrder(tech, big.id, { actualCost: 900, materials: [], note: '' });
    expect(res.expenseStatus).toBe('pending_approval');
    const pendingTx = await data().transactions.get(res.order.expenseId!);
    expect(pendingTx?.status).toBe('pending_approval');
    const before = await svc.finance.monthSummary(owner, pendingTx!.date.slice(0, 7));
    await expect(svc.operations.approveOrder(admin, big.id)).rejects.toThrow(/permiso/);
    await svc.operations.approveOrder(owner, big.id);
    expect((await data().transactions.get(res.order.expenseId!))?.status).toBe('posted');
    const after = await svc.finance.monthSummary(owner, pendingTx!.date.slice(0, 7));
    expect(after.expenses - before.expenses).toBeCloseTo(900);
  });

  it('un presupuesto encima del umbral pide aprobación desde el principio', async () => {
    const admin = await as('u-admin');
    const order = await svc.operations.createOrder(admin, { propertyId: 'p-miami', title: 'Pintar', description: '', category: 'general', priority: 'low', estimate: 1500 });
    expect(order.approval.status).toBe('pending');
    const cheap = await svc.operations.createOrder(admin, { propertyId: 'p-miami', title: 'Bombillo', description: '', category: 'electrical', priority: 'low', estimate: 20 });
    expect(cheap.approval.status).toBe('not_required');
  });
});
