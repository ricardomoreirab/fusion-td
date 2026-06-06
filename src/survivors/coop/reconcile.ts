// Pure position reconciliation math for co-op guest-side prediction correction.
// No Babylon, no DOM — safe for Vitest.

export interface Vec2 { x: number; z: number }

/**
 * Decide how the guest's predicted local hero position reconciles toward the
 * host-authoritative snapshot position. Hard-snap when far, lerp when near.
 *
 * @param local         Guest's current predicted position.
 * @param snap          Host-authoritative snapshot position.
 * @param snapThreshold Distance (world units) above which we hard-snap.
 *                      At exactly the threshold we lerp (boundary is non-inclusive).
 * @param lerpFraction  Fraction [0..1] of the delta to close per call when lerping.
 * @returns             { pos: new position, snapped: true if hard-snap occurred }
 */
export function reconcilePosition(
    local: Vec2,
    snap: Vec2,
    snapThreshold: number,
    lerpFraction: number,
): { pos: Vec2; snapped: boolean } {
    const dx = snap.x - local.x;
    const dz = snap.z - local.z;
    const dist = Math.hypot(dx, dz);
    if (dist > snapThreshold) {
        return { pos: { x: snap.x, z: snap.z }, snapped: true };
    }
    return {
        pos: { x: local.x + dx * lerpFraction, z: local.z + dz * lerpFraction },
        snapped: false,
    };
}
