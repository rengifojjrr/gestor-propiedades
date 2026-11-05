import { describe, expect, it } from 'vitest';
import { codesVisibleForStay } from '@/domain/rules';
import { codesForStay } from '@/services/properties';

const stay = { checkIn: '2026-11-03', checkOut: '2026-11-08', status: 'in_progress' as const };
const codes = [
  { id: '1', kind: 'door' as const, label: 'Puerta', value: '123456' },
  { id: '2', kind: 'wifi' as const, label: 'Red-Demo', value: 'Clave123' },
];

describe('códigos visibles solo durante la estadía', () => {
  it('antes, durante y después', () => {
    expect(codesVisibleForStay({ ...stay, status: 'confirmed' }, '2026-11-02')).toBe(false);
    expect(codesVisibleForStay({ ...stay, status: 'confirmed' }, '2026-11-03')).toBe(true);
    expect(codesVisibleForStay(stay, '2026-11-08')).toBe(true);
    expect(codesVisibleForStay(stay, '2026-11-09')).toBe(false);
    expect(codesVisibleForStay({ ...stay, status: 'completed' }, '2026-11-08')).toBe(false);
    expect(codesVisibleForStay({ ...stay, status: 'cancelled' }, '2026-11-05')).toBe(false);
  });

  it('fuera de la estadía llegan tapados, incluso el nombre del wifi', () => {
    const before = codesForStay(codes, stay, '2026-11-01');
    expect(before.every((c) => c.value === null)).toBe(true);
    expect(before.find((c) => c.kind === 'wifi')?.label).toBe('Wifi');
    const during = codesForStay(codes, stay, '2026-11-05');
    expect(during.map((c) => c.value)).toEqual(['123456', 'Clave123']);
  });
});
