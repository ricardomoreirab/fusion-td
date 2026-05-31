/**
 * LevelSystem — pure-logic hero leveling (no Babylon, no PlayerStats import, so it
 * is unit-testable). The gameplay state owns the instance and wires its effects:
 * on each level-up it pushes the per-level attribute bonus onto PlayerStats —
 * applyLevelBonuses doubles this system's rate to +1%/level for every attribute
 * except crit chance, which stays at the +0.5%/level returned here — and shows
 * feedback. XP is fed from the former gold-income stream (kills + wave/perfect
 * bonuses) via PlayerStats.setXpSink. See
 * docs/superpowers/specs/2026-05-31-xp-leveling-system-design.md.
 */
export interface XpConfig {
  /** Hard level cap. */
  maxLevel: number;
  /** Bonus fraction added per level: 0.005 = +0.5% per level. This is the crit-
   *  chance rate; applyLevelBonuses doubles it (+1%/level, ≈+100% at level 100)
   *  for every other attribute. */
  bonusPerLevel: number;
  /** XP needed to go from level 1 → 2. */
  curveBase: number;
  /** Linear growth of the per-level cost: xpToNext(L) = curveBase + curveStep*(L-1). */
  curveStep: number;
  /** Global scalar applied to every addXp() amount — the calibration knob. */
  gainMultiplier: number;
}

/**
 * PROVISIONAL — calibrated post-build via the [xp] wave-clear log (see plan Task 8).
 * Defaults size total-to-max ≈ 35k XP so a full clear lands near wave 30.
 */
export const XP_CONFIG: XpConfig = {
  maxLevel: 100,
  bonusPerLevel: 0.005,
  curveBase: 60,
  curveStep: 6,
  gainMultiplier: 1.0,
};

export class LevelSystem {
  private cfg: XpConfig;
  private level = 1;
  private xpIntoLevel = 0; // XP accumulated toward the NEXT level
  private totalXp = 0;     // lifetime XP actually consumed (excludes surplus at cap)

  constructor(cfg: XpConfig = XP_CONFIG) {
    this.cfg = cfg;
  }

  getLevel(): number { return this.level; }
  getTotalXp(): number { return this.totalXp; }
  isMaxLevel(): boolean { return this.level >= this.cfg.maxLevel; }

  /** Bonus fraction at the current level: (level-1) * bonusPerLevel. */
  getBonusFraction(): number {
    return (this.level - 1) * this.cfg.bonusPerLevel;
  }

  /** 0..1 fill of the current level (1 when maxed). */
  getProgress(): number {
    if (this.isMaxLevel()) return 1;
    const need = this.xpToNext(this.level);
    return need > 0 ? Math.min(1, this.xpIntoLevel / need) : 0;
  }

  /** XP required to advance FROM `level` to `level+1`. */
  xpToNext(level: number): number {
    return Math.round(this.cfg.curveBase + this.cfg.curveStep * (level - 1));
  }

  /**
   * Add XP (scaled by gainMultiplier). Returns the number of level-ups gained so
   * the caller can fire per-level side effects/feedback. Surplus XP at the cap is
   * discarded.
   */
  addXp(amount: number): number {
    if (this.isMaxLevel() || amount <= 0) return 0;
    let remaining = amount * this.cfg.gainMultiplier;
    let ups = 0;
    while (remaining > 0 && !this.isMaxLevel()) {
      const need = this.xpToNext(this.level) - this.xpIntoLevel;
      if (remaining >= need) {
        remaining -= need;
        this.totalXp += need;
        this.xpIntoLevel = 0;
        this.level++;
        ups++;
      } else {
        this.xpIntoLevel += remaining;
        this.totalXp += remaining;
        remaining = 0;
      }
    }
    if (this.isMaxLevel()) this.xpIntoLevel = 0; // surplus discarded
    return ups;
  }
}
