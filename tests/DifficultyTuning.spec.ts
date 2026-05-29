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
});
