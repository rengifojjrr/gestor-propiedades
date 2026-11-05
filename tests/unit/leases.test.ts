import { describe, expect, it } from 'vitest';
import { data } from '@/data';
import { lateFeeFor, leaseLedger } from '@/domain/rules';
import type { Lease } from '@/domain/types';
import { svc } from '@/services';
import { as, seedAt, TODAY } from './helpers';

const lease: Lease = {
  id: 'l1',
  code: 'C-1',
  propertyId: 'p',
  tenantId: 't',
  start: '2026-08-01',
  end: '2027-07-31',
  rent: 2000,
  currency: 'USD',
  dueDay: 1,
  deposit: 2000,
  lateFee: { kind: 'percent', value: 5, graceDays: 3 },
  status: 'active',
  notes: '',
  createdAt: '2026-07-20T00:00:00Z',
};

describe('recargo por atraso', () => {
  it('no se cobra dentro de la gracia y se cobra después', () => {
    expect(lateFeeFor(lease, '2026-11-01', '2026-11-04')).toBe(0);
    expect(lateFeeFor(lease, '2026-11-01', '2026-11-05')).toBe(100);
    expect(lateFeeFor({ ...lease, lateFee: { kind: 'fixed', value: 75, graceDays: 5 } }, '2026-11-05', '2026-11-11')).toBe(75);
  });

  it('el libro marca pagado, atrasado y próximo', () => {
    const rows = leaseLedger(lease, [
      { id: 'p8', leaseId: 'l1', period: '2026-08', amount: 2000, lateFee: 0, paidOn: '2026-08-01', method: 'transfer', reference: '', recordedBy: 'x', createdAt: '' },
      { id: 'p9', leaseId: 'l1', period: '2026-09', amount: 2000, lateFee: 100, paidOn: '2026-09-09', method: 'transfer', reference: '', recordedBy: 'x', createdAt: '' },
    ], '2026-11-05');
    expect(rows.map((r) => [r.period, r.status])).toEqual([
      ['2026-08', 'paid'],
      ['2026-09', 'paid_late'],
      ['2026-10', 'overdue'],
      ['2026-11', 'overdue'],
      ['2026-12', 'upcoming'],
    ]);
    expect(rows[2].lateFee).toBe(100);
  });

  it('la semilla deja exactamente un mes atrasado al inquilino de Houston y registrar el pago lo salda con recargo', async () => {
    await seedAt();
    const admin = await as('u-admin');
    const [houston] = (await svc.leases.listLeases(admin)).filter((l) => l.id === 'ls-houston');
    expect(houston.overdue.count).toBe(1);
    const row = houston.ledger.find((r) => r.status === 'overdue')!;
    const pay = await svc.leases.recordLeasePayment(admin, 'ls-houston', { period: row.period, amount: 2800, paidOn: TODAY, method: 'zelle', reference: 'ZL-1', includeLateFee: true });
    expect(pay.lateFee).toBe(140);
    const after = (await svc.leases.listLeases(admin)).find((l) => l.id === 'ls-houston')!;
    expect(after.overdue.count).toBe(0);
    const txs = await data().transactions.find((t) => t.source.id === pay.id);
    expect(txs.map((t) => t.category).sort()).toEqual(['late_fee', 'rent']);
    await expect(svc.leases.recordLeasePayment(admin, 'ls-houston', { period: row.period, amount: 2800, paidOn: TODAY, method: 'zelle', reference: 'ZL-2', includeLateFee: false })).rejects.toThrow(/ya tiene un pago/);
  });
});
