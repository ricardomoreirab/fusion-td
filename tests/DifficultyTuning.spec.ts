import { describe, it, expect } from 'vitest';
import { DifficultyTuning as D } from '../src/survivors/DifficultyTuning';

describe('DifficultyTuning', () => {
  it('makes enemies tankier and hit harder', () => {
    expect(D.enemyHpMult).toBeGreaterThan(1);
    expect(D.enemyDamageMult).toBeGreaterThan(1);
  });

  it('increases swarm pressure beyond the old survivors baseline (2.2 / 1.6)', () => {
    expect(D.spawnRateMult).toBeGreaterThan(2.2);
    expect(D.enemyCountMult).toBeGreaterThan(1.6);
  });

  it('makes bosses harder', () => {
    expect(D.bossHpMult).toBeGreaterThan(1);
    expect(D.bossDamageMult).toBeGreaterThan(1);
  });

  it('makes elites tankier than the old 3x baseline', () => {
    expect(D.eliteHpMult).toBeGreaterThan(3);
  });

  it('makes the player squishier but not removed', () => {
    expect(D.playerHpMult).toBeGreaterThan(0);
    expect(D.playerHpMult).toBeLessThan(1);
  });

  // Guards the module's headline intent: axes are MODEST so they aggregate to
  // "substantial" (~1.5–1.7×), not "brutal" (~3×). These upper bounds fail loudly
  // if someone bumps a knob far past the rebalance's design (e.g. enemyHpMult=3).
  it('stays substantial, not brutal (aggregate axes bounded)', () => {
    expect(D.enemyHpMult * D.eliteHpMult).toBeLessThan(6);   // tankiest enemy (elite) HP stack
    expect(D.spawnRateMult * D.enemyCountMult).toBeLessThan(6); // swarm-pressure stack
    expect(D.enemyHpMult * D.enemyDamageMult).toBeLessThan(2.5); // per-trash tankier×harder
  });
});
