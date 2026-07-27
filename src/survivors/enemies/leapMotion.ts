/**
 * The shape of a leap, shared by everything that jumps (the tier-1/Apex boss's
 * charge-dash, the dragon turtle's slam).
 *
 * Pure arithmetic plus one Object3D write — the `three` import is type-only, so
 * nothing survives compilation and `tests/leapMotion.spec.ts` can drive it
 * headless. What lives here is specifically the parts that were easy to get
 * subtly wrong and would have been copied per leaper:
 *
 *  - air time derived from distance rather than fixed, so a short hop does not
 *    crawl across a window sized for a long one;
 *  - speed derived back from the air time, so the leap ALWAYS lands exactly as
 *    its window closes and nothing follows it with a pause;
 *  - the arc scaling with ground covered, so a short hop is not a vertical pop;
 *  - the body coil compensating its own ground offset, which is the one that
 *    silently sinks or floats a model if you forget it.
 */

import type { Object3D } from 'three';

/** Authored per leaper; the flight is resolved from it and the gap to close. */
export interface LeapSpec {
    /** Furthest the leap carries, however big the gap. */
    maxDistance: number;
    /** Top travel speed. The air time comes from this, not the other way round. */
    topSpeed: number;
    /** Floor on air time — a leap lasting two frames has no arc to read. */
    minAirTime: number;
    /** Lands this far short of the target so the leaper arrives in front of it
     *  rather than inside it. */
    stopShort: number;
    /** Peak height of a FULL-distance arc. */
    arcHeight: number;
    /** Fraction of that height a zero-distance leap still gets (0..1). */
    arcMinFraction: number;
}

export interface LeapFlight {
    /** Ground distance this leap will actually travel. */
    distance: number;
    airTime: number;
    /** distance ÷ airTime — at most `topSpeed`, less when the floor applies. */
    speed: number;
    /** Peak of this leap's arc, scaled between arcMinFraction and arcHeight. */
    arcHeight: number;
}

/** Resolve a leap that closes `gap` under `spec`. Safe for gap 0 (a leaper on
 *  top of its target still coils, arcs and lands, it just goes nowhere). */
export function resolveLeapFlight(gap: number, spec: LeapSpec): LeapFlight {
    const distance = Math.max(0, Math.min(spec.maxDistance, gap - spec.stopShort));
    const airTime = Math.max(spec.minAirTime, distance / spec.topSpeed);
    const reach = spec.maxDistance > 0 ? Math.min(1, distance / spec.maxDistance) : 0;
    return {
        distance,
        airTime,
        speed: distance / airTime,
        arcHeight: spec.arcHeight * (spec.arcMinFraction + (1 - spec.arcMinFraction) * reach),
    };
}

/**
 * Height above the ground plane at `progress` (0 = launch, 1 = landing).
 *
 * 4t(1−t) peaks at 1 halfway and is 0 at both ends, so the leaper leaves and
 * meets the ground exactly. Progress must be driven by the TIMER, not by
 * distance travelled, or a zero-distance leap never arcs.
 */
export function leapHeightAt(progress: number, arcHeight: number): number {
    const t = Math.max(0, Math.min(1, progress));
    return arcHeight * 4 * t * (1 - t);
}

/**
 * Coil (negative) / stretch (positive) a body, 0 = neutral. Volume-preserving-ish:
 * what Y loses, XZ gains at half the rate.
 *
 * MUST be applied to the model root, never to the transform host — the host is
 * what gameplay scales (boss enrage, elite treatment), and writing here would
 * either be clobbered by that or bake the pose permanently into its multiplier.
 *
 * `baseRootY` is the root's ground offset as built. It scales with the model's
 * height, so it is re-derived alongside: without that a squashed model's feet
 * lift off the floor and a stretched one's sink through it.
 */
export function applyBodyCoil(
    root: Object3D,
    baseScale: number,
    baseRootY: number,
    amount: number,
    coil: number,
): void {
    const a = Math.max(-1, Math.min(1, amount));
    const sy = 1 + coil * a;
    const sxz = 1 - coil * a * 0.5;
    root.scale.set(baseScale * sxz, baseScale * sy, baseScale * sxz);
    root.position.y = baseRootY * sy;
}

/** Quadratic ease — slow to start, snapping tight at the launch. */
export function easeInCoil(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c;
}
