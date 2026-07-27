/**
 * The pounce's geometry, as pure arithmetic. No Three, no DOM — safe for Vitest.
 *
 * The property this module exists to guarantee is the one that makes a lunge
 * read as a lunge rather than as a bug: an enemy must only commit a leap it can
 * actually finish. A swing that starts from further than the leap can carry it
 * lands the enemy short, mid-air-biting nothing, and a leap longer than the
 * wind-up can cover strands it mid-pounce when the strike frame arrives.
 *
 * `resolveLungeReach` closes both by DERIVING the trigger range from the leap
 * instead of leaving two hand-tuned numbers to agree with each other, and
 * `tests/meleeLunge.spec.ts` asserts the resulting invariant over the whole
 * distance band.
 */

export interface LungeReach {
    /** Furthest the leap may travel. Never more than the wind-up can cover. */
    maxDistance: number;
    /** Distance at which the swing may START. Never more than the leap can close
     *  to within hit range. */
    triggerRange: number;
}

/**
 * @param speed          leap speed, world units/sec
 * @param requestedMax   the leap length the caller wants
 * @param windupDuration seconds the leap has to travel in (the attack wind-up)
 * @param meleeRange     the caller's authored swing-trigger distance
 * @param meleeHitRange  distance at which the strike connects
 */
export function resolveLungeReach(
    speed: number,
    requestedMax: number,
    windupDuration: number,
    meleeRange: number,
    meleeHitRange: number,
): LungeReach {
    const maxDistance = Math.max(0, Math.min(requestedMax, speed * windupDuration));
    return {
        maxDistance,
        // Past maxDistance the leap is capped, so the post-leap gap is
        // (distance − maxDistance); it stays inside hit range exactly while
        // distance ≤ maxDistance + meleeHitRange.
        triggerRange: Math.min(meleeRange, maxDistance + meleeHitRange),
    };
}

/**
 * How far the leap actually travels, given the gap at the moment of commitment.
 * Stops `stopShort` of the target so the enemy lands in front of the hero rather
 * than inside them; 0 means "already on top of them — swing in place".
 */
export function lungeTravel(distance: number, maxDistance: number, stopShort: number): number {
    return Math.max(0, Math.min(maxDistance, distance - stopShort));
}

/**
 * The gap remaining once a leap committed at `distance` has landed — assuming
 * the target has not moved. `resolveLungeReach` exists so that this is ≤ the
 * hit range for every distance up to the trigger range.
 */
export function postLungeGap(distance: number, maxDistance: number, stopShort: number): number {
    return distance - lungeTravel(distance, maxDistance, stopShort);
}
