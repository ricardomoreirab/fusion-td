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

  // The tuning is INTENTIONALLY brutal: each enemy axis carries a literal 1.5×
  // bump, which compounds multiplicatively to ~3× overall (a deliberate choice,
  // see the module header). These upper bounds still fail loudly if someone fat-
  // fingers a knob far past even the brutal design (e.g. enemyHpMult=30).
  it('is brutal-by-design but bounded against runaway typos', () => {
    expect(D.enemyHpMult * D.eliteHpMult).toBeLessThan(15);     // tankiest enemy (elite) HP stack
    expect(D.spawnRateMult * D.enemyCountMult).toBeLessThan(15); // swarm-pressure stack
    expect(D.enemyHpMult * D.enemyDamageMult).toBeLessThan(5);   // per-trash tankier×harder
  });
});
