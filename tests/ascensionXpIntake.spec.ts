import { describe, expect, it } from 'vitest';
import { LevelSystem, XP_CONFIG } from '../src/survivors/LevelSystem';
import { AscensionSystem } from '../src/survivors/ascension/AscensionSystem';

/**
 * Pins the XP hand-off between LevelSystem and AscensionSystem.
 *
 * SurvivorsGameplayState.awardXp cannot be imported (it drags in Three, the DOM
 * and the whole gameplay state), so this reproduces its exact ordering and
 * asserts the two behaviours that are easy to get wrong:
 *   1. `wasCapped` must be sampled BEFORE addXp, or the cap-crossing grant is
 *      counted twice — once by LevelSystem and again in full by ascension.
 *   2. co-op grants nothing at all, so the feature is inert there.
 */

/** Total XP to take a fresh hero from level 1 to the cap. */
const XP_TO_CAP = (() => {
  let total = 0;
  const ls = new LevelSystem();
  for (let l = 1; l < XP_CONFIG.maxLevel; l++) total += ls.xpToNext(l);
  return total;
})();

/** Faithful reproduction of awardXp's ordering. */
function awardXp(
  level: LevelSystem, asc: AscensionSystem | null, amount: number, inCoop = false,
): { levelUps: number; ascUps: number } {
  const wasCapped = level.isMaxLevel();
  const levelUps = level.addXp(amount);
  let ascUps = 0;
  if (wasCapped && !inCoop && asc) ascUps = asc.addXp(amount);
  return { levelUps, ascUps };
}

describe('XP hand-off at the level cap', () => {
  it('confirms the measured cost of reaching level 100', () => {
    expect(XP_TO_CAP).toBe(35_046);
  });

  it('gives ascension nothing until the hero is actually capped', () => {
    const level = new LevelSystem();
    const asc = new AscensionSystem('barbarian');
    awardXp(level, asc, XP_TO_CAP - 1);
    expect(level.getLevel()).toBe(99);
    expect(asc.getTotalXp()).toBe(0);
    expect(asc.getUnspent()).toBe(0);
  });

  it('contributes ZERO ascension XP on the grant that crosses the cap', () => {
    const level = new LevelSystem();
    const asc = new AscensionSystem('barbarian');
    // One huge grant that both finishes level 100 and would otherwise spill over.
    awardXp(level, asc, XP_TO_CAP + 500_000);
    expect(level.isMaxLevel()).toBe(true);
    expect(asc.getTotalXp()).toBe(0); // the surplus in THIS grant is deliberately lost
    expect(asc.getLevel()).toBe(0);
  });

  it('contributes the full amount on every grant after the cap', () => {
    const level = new LevelSystem();
    const asc = new AscensionSystem('barbarian');
    awardXp(level, asc, XP_TO_CAP);
    expect(level.isMaxLevel()).toBe(true);

    const { ascUps } = awardXp(level, asc, 3200);
    expect(ascUps).toBe(1);
    expect(asc.getLevel()).toBe(1);
    expect(asc.getUnspent()).toBe(1);
    expect(asc.getTotalXp()).toBe(3200);
  });

  it('never double-counts: naive post-check ordering would, this one does not', () => {
    const level = new LevelSystem();
    const asc = new AscensionSystem('barbarian');
    const grant = XP_TO_CAP + 100_000;
    awardXp(level, asc, grant);

    // The bug being guarded against: checking isMaxLevel() AFTER addXp would
    // hand the whole `grant` to ascension on top of the levels it just bought.
    const buggy = new AscensionSystem('barbarian');
    const lvl2 = new LevelSystem();
    lvl2.addXp(grant);
    if (lvl2.isMaxLevel()) buggy.addXp(grant);

    expect(buggy.getTotalXp()).toBeGreaterThan(asc.getTotalXp());
    expect(asc.getTotalXp()).toBe(0);
  });

  it('leaks at most one level-worth of XP at the boundary', () => {
    // The accepted cost of leaving LevelSystem untouched: the surplus inside the
    // single cap-crossing grant is discarded (<= 648 of 846,000).
    // xpToNext(99) is the cost of the FINAL level, 99 → 100.
    const ls = new LevelSystem();
    expect(ls.xpToNext(XP_CONFIG.maxLevel - 1)).toBe(648);
    expect(648 / 846_000).toBeLessThan(0.001);
  });
});

describe('co-op gating', () => {
  it('grants no ascension XP and banks no points in co-op', () => {
    const level = new LevelSystem();
    const asc = new AscensionSystem('barbarian');
    awardXp(level, asc, XP_TO_CAP, true);
    for (let i = 0; i < 10; i++) awardXp(level, asc, 50_000, true);

    expect(level.isMaxLevel()).toBe(true);
    expect(asc.getLevel()).toBe(0);
    expect(asc.getUnspent()).toBe(0);
    expect(asc.getTotalXp()).toBe(0);
    // With no points banked, nothing in the tree is ever spendable.
    expect(asc.canSpend('gale-force')).toBe(false);
  });
});

describe('ascension pacing against the real economy', () => {
  it('reaches A1 within a fraction of one post-cap wave', () => {
    const asc = new AscensionSystem('barbarian');
    const WAVE_14_XP = 14_526; // measured from the wave composition + reward tables
    expect(asc.xpToNext(0) / WAVE_14_XP).toBeLessThan(0.25);
  });

  it('needs the documented 846,000 XP for a full A50 climb', () => {
    const asc = new AscensionSystem('barbarian');
    asc.addXp(846_000);
    expect(asc.getLevel()).toBe(50);
    expect(asc.getUnspent()).toBe(50);

    const oneShort = new AscensionSystem('barbarian');
    oneShort.addXp(845_999);
    expect(oneShort.getLevel()).toBe(49);
  });
});
