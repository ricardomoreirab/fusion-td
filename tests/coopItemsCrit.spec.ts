import { describe, expect, it } from 'vitest';
import { encode, decode, DamageReportMsg } from '../src/net/Protocol';
import { rollCrit } from '../src/survivors/enemies/critRoll';
describe('DamageReportMsg.isCrit', () => {
  it('round-trips the isCrit flag', () => {
    const msg: DamageReportMsg = { t:'damageReport', enemyId:7, amount:120, element:'fire', sourceHeroId:1, isCrit:true };
    expect((decode(encode(msg)) as DamageReportMsg).isCrit).toBe(true);
  });
  it('omitting isCrit decodes as undefined', () => {
    const msg: DamageReportMsg = { t:'damageReport', enemyId:1, amount:10, element:'physical', sourceHeroId:1 };
    expect((decode(encode(msg)) as DamageReportMsg).isCrit).toBeUndefined();
  });
});
describe('rollCrit', () => {
  it('multiplies + reports isCrit on a hit', () => { expect(rollCrit(100, { chance:1, damageMult:2 }, () => 0)).toEqual({ amount:200, isCrit:true }); });
  it('no crit when the roll fails', () => { expect(rollCrit(100, { chance:0.5, damageMult:2 }, () => 0.9)).toEqual({ amount:100, isCrit:false }); });
  it('passes a reported crit through without re-rolling', () => { expect(rollCrit(200, { chance:1, damageMult:2 }, () => 0, true)).toEqual({ amount:200, isCrit:true }); });
  it('reported=false passes the amount through unchanged', () => { expect(rollCrit(50, { chance:1, damageMult:2 }, () => 0, false)).toEqual({ amount:50, isCrit:false }); });
});
