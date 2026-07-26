import { PlayerStats } from '../PlayerStats';
import { AscensionSystem } from './AscensionSystem';

/**
 * Tracks the ascension contribution currently sitting inside the two additive
 * fields SHARED with RunItems (which +=s them and is never re-run) and with
 * equipment (which delta-swaps them through its own tracker). Everything else is
 * re-assigned by applyLevelBonuses() each recompute and is therefore safe to
 * multiply/add onto. Mirrors EquipFoldTracker exactly.
 */
export interface AscFoldTracker {
    lifesteal: number;
    knockback: number;
}

export function newAscFoldTracker(): AscFoldTracker {
    return { lifesteal: 0, knockback: 0 };
}

/** Power cooldown can never reach zero; mirrors the floor at applyLevelBonuses. */
const MIN_POWER_COOLDOWN_MULT = 0.05;
/** Damage-reduction floor — 75% reduction cap once ascension is stacked on. */
const MIN_DAMAGE_REDUCTION_MULT = 0.25;

/**
 * Fold ascension point counts into PlayerStats.
 *
 * MUST be called from SurvivorsGameplayState.applyLevelBonuses() ONLY, after the
 * potion fold and BEFORE the re-push to HeroController — the same contract as
 * foldEquipmentStats. A bare re-fold anywhere else compounds every multiplier,
 * and a fold placed after the re-push leaves moveSpeed/attackRange/attackSpeed
 * stale for a whole recompute cycle.
 *
 * The source of truth is always the POINT COUNT, held outside PlayerStats, so
 * every field is re-derived from scratch on each recompute: this cannot compound
 * and cannot be clobbered. That is why the contributions are `factor^points`
 * rather than an incremental delta (the RunItems Math.pow precedent).
 *
 * Fields this deliberately never writes — the types make it unrepresentable:
 *   extraAttacks / ricochetBounces  — ASSIGNED by RunItems outside the recompute,
 *                                     so an ascension write is destroyed by the
 *                                     wave-10/20 milestone drops.
 *   basicDamageMultiplier /
 *   goldGainMultiplier /
 *   hpRegenPctPerSec               — assigned only inside `if (this.equipment)`.
 */
export function foldAscensionStats(
    ps: PlayerStats,
    asc: AscensionSystem,
    t: AscFoldTracker,
): void {
    let lifesteal = 0;
    let knockback = 0;

    for (const path of asc.getTree()) {
        for (const node of path.nodes) {
            const pts = asc.getPoints(node.id);
            if (pts <= 0 || !node.stat) continue;
            const c = node.stat;
            switch (c.kind) {
                case 'multPow':
                    ps[c.field] *= Math.pow(c.factor, pts);
                    break;
                case 'multLin':
                    ps[c.field] *= 1 + c.perPoint * pts;
                    break;
                case 'addAssigned':
                    ps[c.field] += c.perPoint * pts;
                    break;
                case 'addShared':
                    if (c.field === 'lifestealPct') lifesteal += c.perPoint * pts;
                    else knockback += c.perPoint * pts;
                    break;
            }
        }
    }

    // Shared additive fields — exact delta swap, mirroring foldEquipmentStats.
    ps.lifestealPct += lifesteal - t.lifesteal;
    t.lifesteal = lifesteal;
    ps.knockbackOnHit += knockback - t.knockback;
    t.knockback = knockback;

    // The Math.max floors inside applyLevelBonuses are NOT final clamps —
    // equipment and potions already multiply past them — so re-clamp here, which
    // is the last write before the re-push.
    ps.powerCooldownMultiplier = Math.max(MIN_POWER_COOLDOWN_MULT, ps.powerCooldownMultiplier);
    ps.damageReductionMultiplier = Math.max(MIN_DAMAGE_REDUCTION_MULT, ps.damageReductionMultiplier);
}
