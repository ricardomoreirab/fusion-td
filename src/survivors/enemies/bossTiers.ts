/**
 * Which signature moves each milestone-boss tier has.
 *
 * Pure predicates, no Three, no Enemy — so `tests/bossTiers.spec.ts` can assert
 * the rule that actually defines the roster: **tier 4 (Apex) is "all of the
 * above"**, over the capabilities it inherits. That was previously spelled out
 * as a `|| tier >= 4` clause repeated in every predicate, which is exactly the
 * kind of thing that silently loses a capability when a fifth one is added and
 * the clause is forgotten.
 *
 * The twin is the ONE exception, and it is a deliberate one — see `hasClone`.
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

/**
 * Tier 3 (Gemini) ONLY: spawns a twin and enrages when it dies.
 *
 * The one signature Apex does NOT inherit, and the reason is the fight rather
 * than the tier table: two of the hardest boss on screen at once is a different
 * encounter from a hard boss, and it made the wave-20 and wave-25 fights read as
 * a crowd instead of a duel. Apex and the Elemental Lord are each a single body
 * that carries the twin's share in stats and size instead (TIER_HP_MULT /
 * BOSS_SCALE in MilestoneBoss). Doubling itself stays Gemini's whole identity.
 */
export function hasClone(tier: number): boolean {
    return tier === 3;
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
 *
 * Rides on the twin's death, so it can only live where the twin does: it follows
 * `hasClone` exactly, and the spec asserts that rather than trusting the pair to
 * be edited together.
 */
export function hasFrenziedEnrage(tier: number): boolean {
    return tier === 3;
}

/** Extra movement-speed multiplier a frenzied twin-death enrage applies. */
export const FRENZY_SPEED_FACTOR = 1.5;

export interface BossCapability { name: string; has: (tier: number) => boolean }

/** The capabilities Apex INHERITS — "tier 4 is all of the above" is asserted over
 *  exactly this list. A new predicate belongs here unless it is deliberately
 *  exclusive to an earlier tier, in which case it goes below and says why. */
export const APEX_CAPABILITIES: ReadonlyArray<BossCapability> = [
    { name: 'sidestepPredict', has: hasSidestepPredict },
    { name: 'leapDash', has: hasLeapDash },
    { name: 'runningPull', has: hasRunningPull },
];

/** Gemini's exclusive pair, which Apex and the Elemental Lord do NOT get. The
 *  twin is traded for size and stats (see `hasClone`), and the frenzy rides on
 *  the twin's death, so it can only exist alongside it. */
export const GEMINI_ONLY_CAPABILITIES: ReadonlyArray<BossCapability> = [
    { name: 'clone', has: hasClone },
    { name: 'frenziedEnrage', has: hasFrenziedEnrage },
];

/** Every capability above, for the totality check. Adding a predicate without
 *  adding it to one of the two lists is what the spec guards against, so keep
 *  this complete. */
export const BOSS_CAPABILITIES: ReadonlyArray<BossCapability> = [
    ...APEX_CAPABILITIES,
    ...GEMINI_ONLY_CAPABILITIES,
];
