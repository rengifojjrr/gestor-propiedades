import { describe, expect, it } from 'vitest';
import { svc } from '@/services';
import { as, seedAt } from './helpers';

describe('servicios: humo', () => {
  it('cargan la semilla y responden para cada rol', async () => {
    await seedAt();
    await svc.system.tick();
    const owner = await as('u-owner');
    const dash = await svc.dashboard.ownerDashboard(owner);
    expect(dash.counts.total).toBe(6);
    expect(dash.finance?.income).toBeGreaterThan(0);
    const support = await svc.dashboard.supportDashboard(await as('u-support'));
    expect(support.inHouse.length).toBeGreaterThanOrEqual(3);
    expect((await svc.properties.listProperties(owner)).length).toBe(6);
    expect((await svc.bookings.calendarData(owner, '2026-11-01', '2026-12-01')).bookings.length).toBeGreaterThan(5);
    expect((await svc.leases.listLeases(owner)).length).toBe(2);
    expect((await svc.operations.listCleaning(await as('u-clean-1'))).length).toBeGreaterThan(0);
    expect((await svc.operations.listOrders(await as('u-tech'))).length).toBeGreaterThan(0);
    expect((await svc.people.guestRegistry(owner)).length).toBeGreaterThan(5);
    expect((await svc.people.listThreads(owner)).length).toBeGreaterThan(3);
    expect((await svc.finance.series(owner, '2026-11', 6)).length).toBe(6);
    expect((await svc.finance.propertyPerformance(owner, '2026-11')).length).toBe(6);
    expect((await svc.documents.listDocuments(owner)).length).toBeGreaterThan(10);
    expect((await svc.system.listNotifications(owner)).length).toBeGreaterThan(3);
    expect((await svc.system.calendarEvents(owner, '2026-11-01', '2026-12-01')).length).toBeGreaterThan(10);
    expect((await svc.system.listTeam(owner)).length).toBe(9);
    expect((await svc.system.listAudit(owner)).length).toBeGreaterThan(3);
    const guest = await svc.bookings.guestHome(await as('u-guest'));
    expect(guest.stay).toBe('during');
    expect(guest.codes.some((c) => c.value)).toBe(true);
    const tenant = await svc.leases.tenantHome(await as('u-tenant'));
    expect(tenant.lease?.overdue.count).toBe(1);
    const st = await svc.finance.ownerStatement(owner, '2026-10');
    expect(st.rows.length).toBeGreaterThan(5);
    const csv = await svc.finance.exportCsv(owner, { month: '2026-10' });
    expect(csv.split('\n').length).toBeGreaterThan(20);
  });
});
