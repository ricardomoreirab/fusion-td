import { describe, it, expect } from 'vitest';
import { encode, decode, type DamageReportMsg } from '../src/net/Protocol';
import { DamageRouter, validateDamageReport } from '../src/survivors/coop/DamageRouter';

describe('DamageReportMsg optional status field', () => {
  it('round-trips without a status field (backward-compatible)', () => {
    const msg: DamageReportMsg = {
      t: 'damageReport',
      enemyId: 5,
      amount: 25,
      element: 'fire',
      sourceHeroId: 0,
    };
    const decoded = decode(encode(msg)) as DamageReportMsg;
    expect(decoded).toEqual(msg);
    expect(decoded.status).toBeUndefined();
  });

  it('round-trips with a status field present', () => {
    const msg: DamageReportMsg = {
      t: 'damageReport',
      enemyId: 7,
      amount: 10,
      element: 'ice',
      sourceHeroId: 1,
      status: { kind: 'freeze', duration: 2.5, magnitude: 1.0 },
    };
    const decoded = decode(encode(msg)) as DamageReportMsg;
    expect(decoded).toEqual(msg);
    expect(decoded.status).toEqual({ kind: 'freeze', duration: 2.5, magnitude: 1.0 });
  });

  it('deep-equal: decoded report WITHOUT status has no status key', () => {
    const noStatus: DamageReportMsg = {
      t: 'damageReport', enemyId: 1, amount: 5, element: 'arcane', sourceHeroId: 0,
    };
    expect(decode(encode(noStatus))).toEqual(noStatus);
  });

  it('status survives a non-standard kind string', () => {
    const msg: DamageReportMsg = {
      t: 'damageReport', enemyId: 2, amount: 8, element: 'storm', sourceHeroId: 0,
      status: { kind: 'stun', duration: 1.0, magnitude: 0 },
    };
    expect(decode(encode(msg))).toEqual(msg);
  });
});

describe('validateDamageReport unaffected by status field', () => {
  it('validates correctly when status is absent', () => {
    const report: DamageReportMsg = {
      t: 'damageReport', enemyId: 1, amount: 10, element: 'fire', sourceHeroId: 0,
    };
    expect(validateDamageReport(report, { x: 0, z: 0 }, 100, { x: 0, z: 0 })).toBe(true);
    expect(validateDamageReport(report, null, 100)).toBe(false);
  });

  it('validates correctly when status is present', () => {
    const report: DamageReportMsg = {
      t: 'damageReport', enemyId: 3, amount: 15, element: 'ice', sourceHeroId: 1,
      status: { kind: 'slow', duration: 3.0, magnitude: 0.5 },
    };
    // Within range
    expect(validateDamageReport(report, { x: 0, z: 0 }, 100, { x: 5, z: 0 })).toBe(true);
    // Out of range
    expect(validateDamageReport(report, { x: 0, z: 0 }, 1, { x: 5, z: 0 })).toBe(false);
  });
});
