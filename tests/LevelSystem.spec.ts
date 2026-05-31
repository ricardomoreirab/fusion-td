import { describe, it, expect } from 'vitest';
import { LevelSystem, XP_CONFIG } from '../src/survivors/LevelSystem';

describe('LevelSystem', () => {
  it('starts at level 1 with zero bonus and zero progress', () => {
    const ls = new LevelSystem();
    expect(ls.getLevel()).toBe(1);
    expect(ls.getBonusFraction()).toBe(0);
    expect(ls.getProgress()).toBe(0);
    expect(ls.isMaxLevel()).toBe(false);
  });

  it('has a strictly increasing per-level cost curve', () => {
    const ls = new LevelSystem();
    for (let L = 1; L < XP_CONFIG.maxLevel - 1; L++) {
      expect(ls.xpToNext(L + 1)).toBeGreaterThan(ls.xpToNext(L));
    }
  });

  it('does not level up below the threshold, but advances progress', () => {
    const ls = new LevelSystem();
    const need = ls.xpToNext(1);
    const ups = ls.addXp(Math.floor(need / 2));
    expect(ups).toBe(0);
    expect(ls.getLevel()).toBe(1);
    expect(ls.getProgress()).toBeGreaterThan(0);
    expect(ls.getProgress()).toBeLessThan(1);
  });

  it('levels up once when the threshold is crossed', () => {
    const ls = new LevelSystem();
    const ups = ls.addXp(ls.xpToNext(1));
    expect(ups).toBe(1);
    expect(ls.getLevel()).toBe(2);
    expect(ls.getBonusFraction()).toBeCloseTo(0.005, 6);
  });

  it('rolls a large grant into multiple level-ups and reports the count', () => {
    const ls = new LevelSystem();
    const huge = 10_000_000; // far beyond total-to-max
    const ups = ls.addXp(huge);
    expect(ls.getLevel()).toBe(XP_CONFIG.maxLevel);
    expect(ups).toBe(XP_CONFIG.maxLevel - 1);
    expect(ls.isMaxLevel()).toBe(true);
  });

  it('caps at max level: further XP is a no-op and progress stays full', () => {
    const ls = new LevelSystem();
    ls.addXp(10_000_000);
    const before = ls.getTotalXp();
    const ups = ls.addXp(5000);
    expect(ups).toBe(0);
    expect(ls.getLevel()).toBe(XP_CONFIG.maxLevel);
    expect(ls.getTotalXp()).toBe(before); // surplus discarded at cap
    expect(ls.getProgress()).toBe(1);
    expect(ls.getBonusFraction()).toBeCloseTo((XP_CONFIG.maxLevel - 1) * 0.005, 6);
  });

  it('bonus fraction equals (level-1) * bonusPerLevel', () => {
    const ls = new LevelSystem();
    ls.addXp(ls.xpToNext(1) + ls.xpToNext(2)); // -> level 3
    expect(ls.getLevel()).toBe(3);
    expect(ls.getBonusFraction()).toBeCloseTo(2 * 0.005, 6);
  });

  it('applies the gain multiplier to incoming XP', () => {
    const fast = new LevelSystem({ ...XP_CONFIG, gainMultiplier: 1000 });
    const ups = fast.addXp(fast.xpToNext(1) / 1000 + 0.001);
    expect(ups).toBeGreaterThanOrEqual(1);
  });
});
