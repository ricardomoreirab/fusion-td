import { describe, it, expect } from 'vitest';
import { DamageRouter, validateDamageReport } from '../src/survivors/coop/DamageRouter';

describe('DamageRouter (guest queue)', () => {
  it('queues reports and drains them once', () => {
    const r = new DamageRouter();
    r.report(7, 12, 'fire', 1);
    r.report(8, 5, 'physical', 1);
    const out = r.drain();
    expect(out).toEqual([
      { t: 'damageReport', enemyId: 7, amount: 12, element: 'fire', sourceHeroId: 1 },
      { t: 'damageReport', enemyId: 8, amount: 5, element: 'physical', sourceHeroId: 1 },
    ]);
    expect(r.drain()).toEqual([]); // drained
  });
});

describe('validateDamageReport (host)', () => {
  const report = { t: 'damageReport' as const, enemyId: 7, amount: 12, element: 'fire', sourceHeroId: 1 };
  it('rejects when the enemy does not exist', () => {
    expect(validateDamageReport(report, null, 100)).toBe(false);
  });
  it('accepts when in range', () => {
    expect(validateDamageReport(report, { x: 0, z: 0 }, 100, { x: 3, z: 4 })).toBe(true); // dist 5, max sqrt(100)=10
  });
  it('rejects when out of range', () => {
    expect(validateDamageReport(report, { x: 0, z: 0 }, 4, { x: 3, z: 4 })).toBe(false); // dist 5 > 2
  });
  it('accepts in range with no source position given (range check skipped)', () => {
    expect(validateDamageReport(report, { x: 0, z: 0 }, 100)).toBe(true);
  });
});
