// Pure position reconciliation math for co-op guest-side prediction correction.
// No Babylon, no DOM — safe for Vitest.

import { integrateMove } from '../integrateMove';

export interface Vec2 { x: number; z: number }

/** One recorded local-input frame for replay (seq is tracked by the ring, not here). */
export interface InputFrame { dx: number; dz: number; dt: number }

/**
 * M6 E2 input-replay prediction: starting from the host-authoritative pose,
 * re-apply every input the host has NOT yet acknowledged through the exact
 * same integration math the local prediction uses (integrateMove). The result
 * is where the local hero SHOULD be if the host had already applied those
 * inputs — the reconcile target for the dead-zone/lerp.
 *
 * Speed-divergence limitation: the host integrates the guest at the champion's
 * BASE speed (it doesn't know the guest's level/slow multipliers — see
 * CHAMP_BASE_SPEED in SurvivorsGameplayState); the caller passes the guest's
 * CURRENT effective speed so the replay matches the guest's own prediction
 * (residual ≈ 0 frame-to-frame). Any host/guest speed mismatch shows up as a
 * small steady gap absorbed by the dead zone + lerp, never as jitter.
 */
export function replayInputs(
    start: Vec2,
    inputs: readonly InputFrame[],
    speed: number,
    arenaRadius: number,
): Vec2 {
    let x = start.x;
    let z = start.z;
    for (const inp of inputs) {
        const r = integrateMove(x, z, inp.dx, inp.dz, speed, inp.dt, arenaRadius);
        x = r.x;
        z = r.z;
    }
    return { x, z };
}

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
