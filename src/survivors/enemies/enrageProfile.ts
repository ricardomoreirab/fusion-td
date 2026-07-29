/**
 * The milestone-boss enrage stat block, as pure data + arithmetic.
 *
 * No Three, no DOM, no Enemy import — `MilestoneBoss` applies these numbers to
 * itself and `tests/bossEnrage.spec.ts` asserts them directly, so the tuning and
 * the assertions can never drift apart (they used to be two hand-kept copies).
 */

import { StatusEffect } from '../GameTypes';

// ── Last-stand enrage ────────────────────────────────────────────────────────
// Every milestone boss flips into a final phase once its health drops below
// ENRAGE_HEALTH_FRACTION. This is the fight's shape: the boss is most dangerous
// when it is nearly dead, so the kill has to be committed to rather than
// out-attritioned. Distinct from the tier-3 twin-death enrage — both can fire
// in one fight, and each is one-shot.
export const ENRAGE_HEALTH_FRACTION = 0.30;

/** Tankiness is bought as damage REDUCTION, not extra max HP: adding HP at 30%
 *  would push the HUD boss bar backwards, and a boss bar that can rise reads as
 *  a bug. Taking 1/1.5× damage is the same 50% more effective HP, monotonically. */
export const ENRAGE_TANK_FACTOR = 1.5;

/** Movement speed and melee cadence. The last stand is meant to out-run a kiting
 *  hero, which at level 100 is the whole difficulty of the phase. */
export const ENRAGE_SPEED_FACTOR = 1.8;

export const ENRAGE_DAMAGE_FACTOR = 1.5;

/** Recurring special cadence (dash / grab / nova) while in the last stand. */
export const ENRAGE_COOLDOWN_FACTOR = 0.55;

/** Recurring special cadence while enraged by a twin's death (tier 3). */
export const TWIN_ENRAGE_COOLDOWN_FACTOR = 0.5;

/**
 * Multiplier on the boss's special-ability cooldown. The two enrages are
 * independent one-shots that can both be live in one fight, so they COMPOSE
 * rather than override — a tier-4 boss that lost its twin and then dropped below
 * the health threshold cycles specials at 0.5 × 0.55 of its base cadence.
 */
export function specialCooldownScale(twinEnraged: boolean, lastStand: boolean): number {
    return (twinEnraged ? TWIN_ENRAGE_COOLDOWN_FACTOR : 1)
        * (lastStand ? ENRAGE_COOLDOWN_FACTOR : 1);
}

/**
 * Effects an enraged boss shrugs off. "Movement impairing" is read literally:
 * anything that reduces, zeroes or hijacks the boss's ability to close on the
 * hero. BURNING / CURSE / FRAGILE are damage, not control, and still land — the
 * last stand is a race, not an invulnerability phase.
 *
 * CHILL is in the set because it both slows directly and converts to FROZEN at
 * its stack threshold; letting it accumulate would freeze a boss that is
 * nominally freeze-immune.
 */
export function isMovementImpairing(effect: StatusEffect): boolean {
    return effect === StatusEffect.SLOWED
        || effect === StatusEffect.FROZEN
        || effect === StatusEffect.STUNNED
        || effect === StatusEffect.CHILL
        || effect === StatusEffect.CONFUSED
        || effect === StatusEffect.PUSHED;
}
