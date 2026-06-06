import { describe, it, expect } from 'vitest';
import { PlayerStats } from '../src/survivors/PlayerStats';
import { LevelSystem } from '../src/survivors/LevelSystem';

describe('per-player progression independence', () => {
  /** Factory: wire a fresh PlayerStats to a fresh LevelSystem via xpSink. */
  function makePlayer() {
    const s = new PlayerStats();
    const l = new LevelSystem();
    s.setXpSink((amt) => l.addXp(amt));
    return { s, l };
  }

  it('gold to player 0 raises only player 0 level/xp', () => {
    const p0 = makePlayer();
    const p1 = makePlayer();
    const before0 = p0.l.getLevel();
    const before1 = p1.l.getLevel();
    expect(before0).toBe(1);
    expect(before1).toBe(1);

    // Award enough gold to p0 to guarantee at least one level-up
    for (let i = 0; i < 50; i++) p0.s.addMoney(100);

    expect(p0.l.getLevel()).toBeGreaterThan(before0); // p0 progressed
    expect(p1.l.getLevel()).toBe(before1);             // p1 untouched
  });

  it('xpSink routes exactly through addMoney (gold income path)', () => {
    const p0 = makePlayer();
    const p1 = makePlayer();
    // p0 earns 60 gold — exactly xpToNext(1) for default config (curveBase=60)
    p0.s.addMoney(60);
    expect(p0.l.getLevel()).toBe(2);
    expect(p1.l.totalXp ?? p1.l.getTotalXp()).toBe(0);
  });

  it('clearing the xpSink stops forwarding xp', () => {
    const p0 = makePlayer();
    p0.s.setXpSink(null);
    p0.s.addMoney(10_000);
    expect(p0.l.getLevel()).toBe(1); // sink was removed; no XP forwarded
  });

  it('two independent sinks never share state', () => {
    const p0 = makePlayer();
    const p1 = makePlayer();
    // Drive them to different levels
    for (let i = 0; i < 30; i++) p0.s.addMoney(100);
    for (let i = 0; i < 5; i++) p1.s.addMoney(100);
    expect(p0.l.getLevel()).toBeGreaterThan(p1.l.getLevel());
    expect(p0.l.getTotalXp()).toBeGreaterThan(p1.l.getTotalXp());
  });
});
