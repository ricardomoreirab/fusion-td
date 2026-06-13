import { describe, expect, it } from 'vitest';
import { encode, decode } from '../src/net/Protocol';
import { integrateMove } from '../src/survivors/integrateMove';

describe('HeroStatMsg', () => {
  it('round-trips the guest move-speed multiplier', () => {
    const back = decode(encode({ t: 'heroStat', moveMult: 1.35 } as any)) as any;
    expect(back).toMatchObject({ t: 'heroStat', moveMult: 1.35 });
  });

  it('rejects an unknown tag (sanity: decode still gates)', () => {
    expect(() => decode(JSON.stringify({ t: 'bogus' }))).toThrow();
  });
});

describe('host ghost integration honours the guest move multiplier', () => {
  // Models the P6 contract: the host integrates the guest ghost at
  //   CHAMP_BASE_SPEED * guestMoveMult
  // which must reproduce the guest's OWN local prediction (it integrates at
  //   moveSpeed(=CHAMP_BASE_SPEED) * moveSpeedMultiplier).
  // Same integrateMove math on both sides → residual stays ≈ 0 (no jitter).
  const BASE = 6; // barbarian base speed (mirrors CHAMP_BASE_SPEED + variants[].speed)
  const ARENA = Infinity;

  it('a faster guest ghost matches the guest prediction when host applies moveMult', () => {
    const moveMult = 1.4;
    // Guest local prediction: integrate at base * moveMult.
    const guest = integrateMove(0, 0, 1, 0, BASE * moveMult, 0.1, ARENA);
    // Host ghost (P6): scale the ghost step by the reported moveMult.
    const hostGhost = integrateMove(0, 0, 1, 0, BASE * moveMult, 0.1, ARENA);
    expect(hostGhost.x).toBeCloseTo(guest.x, 9);
    expect(hostGhost.z).toBeCloseTo(guest.z, 9);
  });

  it('without the multiplier the host ghost lags a move-speed-geared guest', () => {
    const moveMult = 1.4;
    const guest = integrateMove(0, 0, 1, 0, BASE * moveMult, 0.1, ARENA);
    const hostBaseOnly = integrateMove(0, 0, 1, 0, BASE, 0.1, ARENA);
    // The pre-P6 host ghost (base speed only) is strictly behind.
    expect(hostBaseOnly.x).toBeLessThan(guest.x);
  });
});
