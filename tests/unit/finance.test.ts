import { beforeEach, describe, expect, it } from 'vitest';
import { data } from '@/data';
import { convert, MissingRateError, MixedCurrencyError, occupancyStats, rateFor, sumSameCurrency } from '@/domain/rules';
import type { FxRate } from '@/domain/types';
import { round2 } from '@/lib/money';
import { svc } from '@/services';
import { as, seedAt } from './helpers';

const RATES: FxRate[] = [
  { id: 'a', currency: 'EUR', rate: 1.05, date: '2026-01-01' },
  { id: 'b', currency: 'EUR', rate: 1.1, date: '2026-10-01' },
  { id: 'c', currency: 'MXN', rate: 0.05, date: '2026-10-01' },
];

describe('monedas', () => {
  it('usa la tasa manual vigente en la fecha y convierte pasando por la base', () => {
    expect(rateFor('EUR', 'USD', RATES, '2026-06-15')).toBe(1.05);
    expect(rateFor('EUR', 'USD', RATES, '2026-11-02')).toBe(1.1);
    expect(convert(100, 'EUR', 'USD', 'USD', RATES, '2026-11-02')).toBe(110);
    expect(convert(110, 'USD', 'EUR', 'USD', RATES, '2026-11-02')).toBe(100);
    expect(convert(1000, 'MXN', 'EUR', 'USD', RATES, '2026-11-02')).toBe(round2((1000 * 0.05) / 1.1));
  });

  it('sin tasa no convierte y nunca suma monedas distintas', () => {
    expect(() => rateFor('COP', 'USD', RATES, '2026-11-02')).toThrow(MissingRateError);
    expect(() => sumSameCurrency([{ amount: 1, currency: 'USD' }, { amount: 1, currency: 'EUR' }])).toThrow(MixedCurrencyError);
    expect(sumSameCurrency([{ amount: 1.1, currency: 'USD' }, { amount: 2.2, currency: 'USD' }])).toEqual({ amount: 3.3, currency: 'USD' });
  });
});

describe('ocupación, ADR y RevPAR', () => {
  it('calcula con noches disponibles menos bloqueos', () => {
    const bookings = [
      { checkIn: '2026-11-01', checkOut: '2026-11-05', nightlyRate: 200, status: 'completed' as const },
      { checkIn: '2026-11-28', checkOut: '2026-12-03', nightlyRate: 100, status: 'confirmed' as const },
      { checkIn: '2026-11-10', checkOut: '2026-11-12', nightlyRate: 999, status: 'cancelled' as const },
    ];
    const blocks = [{ start: '2026-11-20', end: '2026-11-25' }];
    const s = occupancyStats(bookings, blocks, '2026-11-01', '2026-12-01');
    expect(s.availableNights).toBe(25);
    expect(s.nightsSold).toBe(4 + 3);
    expect(s.roomRevenue).toBe(4 * 200 + 3 * 100);
    expect(s.adr).toBe(round2(1100 / 7));
    expect(s.revpar).toBe(round2(1100 / 25));
    expect(s.occupancy).toBeCloseTo(7 / 25);
  });
});

describe('ganancias por propiedad y del portafolio', () => {
  beforeEach(async () => seedAt());

  it('el portafolio es la suma de las propiedades más los gastos generales, en moneda base', async () => {
    const owner = await as('u-owner');
    const month = '2026-10';
    const total = await svc.finance.monthSummary(owner, month);
    const rows = await svc.finance.propertyPerformance(owner, month);
    const general = (await data().transactions.find((t) => !t.propertyId && t.status === 'posted' && t.date.startsWith(month))).reduce((s, t) => s + (t.type === 'income' ? t.amountBase : -t.amountBase), 0);
    const sum = round2(rows.reduce((s, r) => s + r.net, 0) + general);
    expect(total.net).toBe(sum);
    expect(total.income).toBeGreaterThan(total.expenses * 0.5);
    const miami = await svc.finance.monthSummary(owner, month, 'p-miami');
    expect(miami.net).toBe(rows.find((r) => r.propertyId === 'p-miami')!.net);
  });

  it('una propiedad en otra moneda se consolida convertida con la tasa manual', async () => {
    const owner = await as('u-owner');
    const p = (await data().properties.get('p-sanjuan'))!;
    await data().properties.put({ ...p, id: 'p-madrid', name: 'Piso Madrid (prueba)', currency: 'EUR', timezone: 'Europe/Madrid' });
    const before = await svc.finance.monthSummary(owner, '2026-11');
    const tx = await svc.finance.recordManual(owner, { propertyId: 'p-madrid', type: 'income', category: 'other_income', amount: 100, date: '2026-11-03', description: 'Ingreso en euros' });
    expect(tx.currency).toBe('EUR');
    expect(tx.fxRate).toBe(1.08);
    expect(tx.amountBase).toBe(108);
    const after = await svc.finance.monthSummary(owner, '2026-11');
    expect(round2(after.income - before.income)).toBe(108);
    // sin tasa: no se registra
    await data().properties.put({ ...p, id: 'p-jpy', name: 'Prueba yen', currency: 'JPY' });
    await expect(svc.finance.recordManual(owner, { propertyId: 'p-jpy', type: 'income', category: 'other_income', amount: 1000, date: '2026-11-03', description: 'Sin tasa' })).rejects.toThrow(/tasa/);
  });
});
