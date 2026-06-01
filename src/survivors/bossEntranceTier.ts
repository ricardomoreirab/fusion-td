/**
 * Pure (Babylon-free, so unit-testable) mapping from an absolute wave number to
 * the boss-entrance tier whose cinematic should play, or null when no entrance
 * applies. Only the first three milestone bosses (waves 5/10/15) have entrance
 * assets; every other wave — including milestone waves 20+ — returns null and
 * spawns normally.
 */
export function entranceTierForWave(wave: number): 1 | 2 | 3 | null {
  if (wave <= 0 || wave % 5 !== 0) return null;
  const tier = wave / 5;
  return tier === 1 || tier === 2 || tier === 3 ? tier : null;
}
