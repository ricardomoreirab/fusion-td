/**
 * Which signature moves each milestone-boss tier has.
 *
 * Pure predicates, no Three, no Enemy — so `tests/bossTiers.spec.ts` can assert
 * the rule that actually defines the roster: **tier 4 (Apex) is "all of the
 * above"**. That was previously spelled out as a `|| tier >= 4` clause repeated
 * in every predicate, which is exactly the kind of thing that silently loses a
 * capability when a fifth one is added and the clause is forgotten.
 *
 * Bosses spawn at waves 5/10/15/20/25 as tiers 1..5; tier 5 (Elemental Lord)
 * inherits everything Apex has and adds its own nova on top.
 */

/** Highest tier with a hand-authored identity. 5+ all read as Apex-and-more. */
export const APEX_TIER = 4;

/** Tier 2+ leads the hero by their velocity when aiming a special. */
export function hasSidestepPredict(tier: number): boolean {
    return tier >= 2;
}

/** Tier 3+ spawns a twin and enrages when it dies. */
export function hasClone(tier: number): boolean {
    return tier >= 3;
}

/**
 * Tier 1 (Ravager): the dash opens with a LEAP instead of a rooted telegraph —
 * it jumps the gap and slashes on the way through. No painted lane: a boss that
 * is already flying at you reads its own intent, and the marker would flatten
 * the move into "stand still, then move".
 */
export function hasLeapDash(tier: number): boolean {
    return tier === 1 || tier >= APEX_TIER;
}

/**
 * Tier 2 (Warden): the grab no longer roots it. It reels the hero in while still
 * closing, so backing off during the pull stops buying the distance the rooted
 * version gave away for free.
 */
export function hasRunningPull(tier: number): boolean {
    return tier === 2 || tier >= APEX_TIER;
}

/**
 * Tier 3 (Gemini): losing its twin drives it into a frenzy rather than merely
 * speeding it up — an extra half again on top of the movement speed the
 * twin-death enrage already grants.
 */
export function hasFrenziedEnrage(tier: number): boolean {
    return tier === 3 || tier >= APEX_TIER;
}

/** Extra movement-speed multiplier a frenzied twin-death enrage applies. */
export const FRENZY_SPEED_FACTOR = 1.5;

/** Every capability above, for the "Apex has all of them" assertion. Adding a
 *  predicate without adding it here is what the test is guarding against, so
 *  keep this list complete. */
export const BOSS_CAPABILITIES: ReadonlyArray<{ name: string; has: (tier: number) => boolean }> = [
    { name: 'sidestepPredict', has: hasSidestepPredict },
    { name: 'clone', has: hasClone },
    { name: 'leapDash', has: hasLeapDash },
    { name: 'runningPull', has: hasRunningPull },
    { name: 'frenziedEnrage', has: hasFrenziedEnrage },
];
