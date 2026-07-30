/**
 * Which signature moves each milestone-boss tier has.
 *
 * Pure predicates, no Three, no Enemy — so `tests/bossTiers.spec.ts` can assert
 * the rules that actually define the roster rather than trusting a table to be
 * edited consistently. Two rules do that work:
 *
 *   1. **Apex is "all of the above"** over the capabilities it INHERITS. That was
 *      previously spelled out as a `|| tier >= 4` clause repeated in every
 *      predicate, which is exactly the kind of thing that silently loses a
 *      capability when a new one is added and the clause is forgotten.
 *   2. Anything NOT inherited is an EXCLUSIVE capability with a named owner tier
 *      and a stated reason, and the spec proves no other tier can reach it.
 *
 * Bosses spawn every 5th wave as tiers 1..N (wave 5 = tier 1):
 *
 *   Tier 1 — Ravager            (wave  5): leaps the gap and slashes through.
 *   Tier 2 — Warden             (wave 10): reels the hero in while still closing.
 *   Tier 3 — Gemini             (wave 15): fights as a pair; frenzies when the twin dies.
 *   Tier 4 — Apex Tyrant        (wave 20): every inherited signature, on one double-sized body.
 *   Tier 5 — Guardian of Nature (wave 25): the fast one — a flurry of quick swings
 *                                          punctuated by a verdant AoE pulse.
 *   Tier 6 — Elemental Lord     (wave 30): the last authored boss. Adds the
 *                                          elemental nova and the all-element barrage.
 *
 * Past tier 6 the ladder keeps the Elemental Lord and only its stats grow — see
 * MAX_AUTHORED_TIER.
 */

/** Highest tier with a hand-authored identity. Tiers past it re-run the last
 *  boss with the stat curve continuing, so `Math.min(tier, MAX_AUTHORED_TIER)`
 *  is how a caller picks a model, a label or a behaviour set. */
export const MAX_AUTHORED_TIER = 6;

/** Highest tier that is "all of the inherited signatures on one body". Later
 *  tiers build ON Apex, never replace it. */
export const APEX_TIER = 4;

/** Tier 5, the Guardian. Named because three separate things key off it (speed,
 *  attack cadence, the verdant nova) and a bare 5 in each is how they drift. */
export const GUARDIAN_TIER = 5;

/** Tier 6, the Elemental Lord — the last authored boss. */
export const LORD_TIER = 6;

/** Tier 2+ leads the hero by their velocity when aiming a special. */
export function hasSidestepPredict(tier: number): boolean {
    return tier >= 2;
}

/**
 * Tier 3 (Gemini) ONLY: spawns a twin and enrages when it dies.
 *
 * The one signature Apex does NOT inherit, and the reason is the fight rather
 * than the tier table: two of the hardest boss on screen at once is a different
 * encounter from a hard boss, and it made the later fights read as a crowd
 * instead of a duel. Every tier above is a single body carrying the twin's share
 * in stats and size instead (TIER_HP_MULT / BOSS_SCALE in MilestoneBoss).
 * Doubling itself stays Gemini's whole identity.
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

/**
 * Tier 5 (Guardian of Nature) ONLY: a verdant AoE pulse, and the pay-off for a
 * boss built around closing distance fast.
 *
 * Deliberately not inherited, unlike every other late capability: the Elemental
 * Lord's own nova is the SAME move with a different colour, and a boss running
 * both would pulse twice as often for no added read. One nova per body — which
 * one it is, is the tier's identity.
 */
export function hasVerdantNova(tier: number): boolean {
    return tier === GUARDIAN_TIER;
}

/**
 * Tier 6+ (Elemental Lord): a periodic telegraphed AoE pulse around it.
 *
 * Inherited upward rather than pinned to 6 — the Lord is the last authored boss,
 * so every tier past it IS the Lord and must keep its whole kit.
 */
export function hasElementalNova(tier: number): boolean {
    return tier >= LORD_TIER;
}

/** Tier 6+ (Elemental Lord): one bolt of every element, all converging on the
 *  point the hero stood on at launch. Its ranged answer to a kiting hero. */
export function hasElementalBarrage(tier: number): boolean {
    return tier >= LORD_TIER;
}

export interface BossCapability { name: string; has: (tier: number) => boolean }

/** A capability deliberately confined to ONE tier, with the reason it is not
 *  inherited. `owner` is what the spec checks every other tier against. */
export interface ExclusiveCapability extends BossCapability { owner: number }

/**
 * The capabilities Apex INHERITS — "tier 4 is all of the above" is asserted over
 * exactly this list, at Apex and at every tier past it. A new predicate belongs
 * here unless it is deliberately confined to one tier (→ EXCLUSIVE_CAPABILITIES)
 * or introduced by a tier ABOVE Apex (→ LORD_CAPABILITIES).
 */
export const APEX_CAPABILITIES: ReadonlyArray<BossCapability> = [
    { name: 'sidestepPredict', has: hasSidestepPredict },
    { name: 'leapDash', has: hasLeapDash },
    { name: 'runningPull', has: hasRunningPull },
];

/** One tier each, and no other tier may reach them. The twin is traded for size
 *  and stats (see `hasClone`), the frenzy rides on the twin's death so it cannot
 *  outlive it, and the verdant nova would double up with the Lord's own. */
export const EXCLUSIVE_CAPABILITIES: ReadonlyArray<ExclusiveCapability> = [
    { name: 'clone', owner: 3, has: hasClone },
    { name: 'frenziedEnrage', owner: 3, has: hasFrenziedEnrage },
    { name: 'verdantNova', owner: GUARDIAN_TIER, has: hasVerdantNova },
];

/** Introduced by the Elemental Lord and carried by every tier past it, since
 *  those tiers ARE the Lord with a bigger stat block. */
export const LORD_CAPABILITIES: ReadonlyArray<BossCapability> = [
    { name: 'elementalNova', has: hasElementalNova },
    { name: 'elementalBarrage', has: hasElementalBarrage },
];

/** Extra movement-speed multiplier a frenzied twin-death enrage applies. */
export const FRENZY_SPEED_FACTOR = 1.5;

/** Every capability above, for the totality check. Adding a predicate without
 *  adding it to one of the three lists is what the spec guards against, so keep
 *  this complete. */
export const BOSS_CAPABILITIES: ReadonlyArray<BossCapability> = [
    ...APEX_CAPABILITIES,
    ...EXCLUSIVE_CAPABILITIES,
    ...LORD_CAPABILITIES,
];
