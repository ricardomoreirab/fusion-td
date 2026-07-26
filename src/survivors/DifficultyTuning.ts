/**
 * Wave-INDEPENDENT base constants for survivors-mode difficulty. Each enemy axis
 * carries a literal 1.5× bump (HP, damage, spawn cadence, count, elite/boss
 * mults) over the pre-rebalance baseline, and because the axes compound
 * multiplicatively (tankier × more-of-them × hit-harder) they stack to a
 * deliberately BRUTAL ~3× aggregate.
 *
 * These are only HALF the picture: every axis below except `eliteHpMult` and
 * `playerHpMult` is multiplied by the per-wave scalars in `DifficultyCurve.ts`,
 * which sit at ~0.6-0.7 through the opening waves and climb past 1 from wave ~10
 * on. Read a constant here as "the value once the curve reaches 1.0", not as
 * what wave 1 feels like. Retune the SHAPE of the run in DifficultyCurve; retune
 * the OVERALL level here.
 *
 * Baselines being replaced: survivors spawn cadence was 2.2, enemy count 1.6,
 * elite HP 3.0, hero HP per-champion (barb 140 / ranger 90 / mage 80).
 */
export const DifficultyTuning = {
  /** Global max-HP multiplier on every non-milestone-boss enemy at spawn. */
  enemyHpMult: 1.95,
  /** Global contact + melee damage multiplier on every non-milestone-boss enemy. */
  enemyDamageMult: 1.875,
  /** Survivors spawn cadence (delays divided by this). Was 2.2. */
  spawnRateMult: 3.9,
  /** Enemies per wave (group counts multiplied by this). Was 1.6. */
  enemyCountMult: 2.85,
  /** Extra HP on milestone bosses, layered on top of their tier mults. */
  bossHpMult: 1.95,
  /** Extra contact + melee damage on milestone bosses, on top of tier mults. */
  bossDamageMult: 1.80,
  /** Elite HP multiplier. Was 3.0. */
  eliteHpMult: 5.25,
  /** Hero starting/max HP multiplier applied to per-champion variant.hp (~-8%). */
  playerHpMult: 0.92,
} as const;
