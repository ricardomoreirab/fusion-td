/**
 * Single source of truth for the survivors-mode difficulty rebalance.
 *
 * Per-axis numbers are deliberately MODEST: the four axes compound
 * multiplicatively (tankier × more-of-them × hit-harder), so these aggregate to
 * a "substantial" (~1.5–1.7×) overall difficulty, not 1.5× on each (which would
 * stack to ~3× = brutal). Tune here; every consumer reads from this object.
 *
 * Baselines being replaced: survivors spawn cadence was 2.2, enemy count 1.6,
 * elite HP 3.0, hero HP per-champion (barb 140 / ranger 90 / mage 80).
 */
export const DifficultyTuning = {
  /** Global max-HP multiplier on every non-milestone-boss enemy at spawn. */
  enemyHpMult: 1.30,
  /** Global contact + melee damage multiplier on every non-milestone-boss enemy. */
  enemyDamageMult: 1.25,
  /** Survivors spawn cadence (delays divided by this). Was 2.2. */
  spawnRateMult: 2.6,
  /** Enemies per wave (group counts multiplied by this). Was 1.6. */
  enemyCountMult: 1.9,
  /** Extra HP on milestone bosses, layered on top of their tier mults. */
  bossHpMult: 1.30,
  /** Extra contact + melee damage on milestone bosses, on top of tier mults. */
  bossDamageMult: 1.20,
  /** Elite HP multiplier. Was 3.0. */
  eliteHpMult: 3.5,
  /** Hero starting/max HP multiplier applied to per-champion variant.hp (~-8%). */
  playerHpMult: 0.92,
} as const;
