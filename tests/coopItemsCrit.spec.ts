import { describe, expect, it } from 'vitest';
import { encode, decode, DamageReportMsg } from '../src/net/Protocol';
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
