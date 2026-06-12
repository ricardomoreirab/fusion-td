import { PlayerStats } from '../PlayerStats';
import { EquipmentAggregates } from './Equipment';

/** Tracks the equipment contribution currently sitting inside the two additive
 *  fields that are SHARED with RunItems (which +=s them and is never re-run).
 *  Everything else is either re-assigned by applyLevelBonuses() each recompute
 *  (safe to multiply/add onto) or owned exclusively by equipment (assigned). */
export interface EquipFoldTracker {
    lifesteal: number;
    knockback: number;
}

export function newEquipFoldTracker(): EquipFoldTracker {
    return { lifesteal: 0, knockback: 0 };
}

/** Fold equipment aggregates into PlayerStats. MUST be called immediately after
 *  applyLevelBonuses() re-assigns the level-derived fields — it multiplies/adds
 *  on top of those assignments, which makes the whole recompute idempotent.
 *  Max-HP is NOT handled here (the state applies it as a hero-controller delta,
 *  mirroring the level system's appliedMaxHpBonus pattern). */
export function foldEquipmentStats(
    ps: PlayerStats,
    agg: EquipmentAggregates,
    t: EquipFoldTracker,
): void {
    // Fields re-assigned by applyLevelBonuses() every recompute:
    ps.moveSpeedMultiplier        *= agg.moveSpeedMult;
    ps.basicAttackSpeedMultiplier *= agg.attackSpeedMult;
    ps.powerDamageMultiplier      *= agg.powerDamageMult;
    ps.powerCooldownMultiplier    *= agg.cooldownMult;
    ps.damageReductionMultiplier  *= agg.damageTakenMult;
    ps.critChance                 += agg.critChance;
    ps.critDamageMultiplier       += agg.critDamage;

    // Fields owned exclusively by equipment (nothing else writes them):
    ps.basicDamageMultiplier = agg.basicDamageMult;
    ps.goldGainMultiplier    = agg.goldGainMult;
    ps.hpRegenPctPerSec      = agg.hpRegenPctPerSec;

    // Shared additive fields (RunItems +=s them) — exact delta swap:
    ps.lifestealPct   += agg.lifesteal - t.lifesteal;
    t.lifesteal = agg.lifesteal;
    ps.knockbackOnHit += agg.knockback - t.knockback;
    t.knockback = agg.knockback;
}
