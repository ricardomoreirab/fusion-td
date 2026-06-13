import { describe, expect, it } from 'vitest';
import { encode, decode } from '../src/net/Protocol';
import { PlayerStats } from '../src/survivors/PlayerStats';
import { LevelSystem } from '../src/survivors/LevelSystem';

describe('RewardMsg', () => {
  it('round-trips a per-hero gold delta', () => {
    const back = decode(encode({ t: 'reward', heroId: 1, gold: 42 } as any)) as any;
    expect(back).toMatchObject({ t: 'reward', heroId: 1, gold: 42 });
  });
});

describe('per-player gold attribution (raw reward → guest-scaled bank)', () => {
  // Models the host→guest contract: the host sends the RAW enemy reward; the guest
  // scales it by ITS OWN goldGainMultiplier and banks it (→ xpSink → LevelSystem).
  function makeGuest(goldFind = 1) {
    const s = new PlayerStats(120, 0);
    const l = new LevelSystem();
    s.setXpSink((amt) => l.addXp(amt));
    s.goldGainMultiplier = goldFind;
    return { s, l };
  }

  /** What the guest's onReward handler does for a heroId=1 reward. */
  function applyReward(g: ReturnType<typeof makeGuest>, rawGold: number) {
    g.s.addGold(Math.round(rawGold * (g.s.goldGainMultiplier ?? 1)));
  }

  it('banks the raw reward at 1× gold-find', () => {
    const g = makeGuest(1);
    applyReward(g, 60);
    expect(g.s.getGold()).toBe(60);
  });

  it("applies the guest's OWN gold-find multiplier, not the host's", () => {
    const g = makeGuest(1.5); // guest has +50% gold-find gear
    applyReward(g, 40);
    expect(g.s.getGold()).toBe(60); // 40 * 1.5
  });

  it('reward income folds into the guest XP/level chain', () => {
    const g = makeGuest(1);
    applyReward(g, 60); // curveBase=60 → exactly one level-up
    expect(g.l.getLevel()).toBe(2);
  });
});
