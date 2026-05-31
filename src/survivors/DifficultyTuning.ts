/**
 * Single source of truth for the survivors-mode difficulty rebalance.
 *
 * Each enemy axis carries a literal 1.5× bump (HP, damage, spawn cadence, count,
 * elite/boss mults). Because the axes compound multiplicatively
 * (tankier × more-of-them × hit-harder), this stacks to a deliberately BRUTAL
 * ~3× overall difficulty — an intentional choice, not the earlier "modest"
 * ~1.5–1.7× aggregate. Player HP is left untouched. Tune here; every consumer
 * reads from this object.
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
