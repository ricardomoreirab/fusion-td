/**
 * locomotionDirection - decide whether the champion's run cycle plays forwards
 * or in reverse this frame.
 *
 * Facing and travel are the same thing until an attack locks the model onto its
 * target; from then on the hero can move in any direction relative to where it
 * is pointing, and the forward run cycle played while retreating is a moonwalk
 * - feet striding one way, body going the other. The rigs ship no backpedal
 * clip, so the cycle is played backwards instead: the push-off lands on the
 * trailing foot and it reads as backing away.
 *
 * Pure (no Three/DOM) - covered by Vitest.
 */

/**
 * Cosine of the travel-vs-facing angle at which the legs flip INTO the reverse
 * cycle. Entering needs a clearly rearward heading.
 */
export const BACKPEDAL_ENTER = -0.35;

/**
 * ...and the (wider) one at which they flip back out. Leaving only needs the
 * heading to stop being rearward, so the pair straddles the perpendicular
 * strafe: held near 90 degrees - where forward and backward are equally wrong -
 * the cycle picks a direction and stays there instead of flapping every frame.
 */
export const BACKPEDAL_EXIT = -0.15;

/**
 * How closely travel agrees with facing: +1 dead ahead, 0 a pure strafe, -1
 * straight backwards. `yaw` is the mesh's `rotation.y`, whose model forward is
 * +Z (`headingToYaw` orients the champion rigs without the enemies' 180-degree
 * pre-rotation). Returns 0 for a stationary hero.
 */
export function travelAlignment(yaw: number, velX: number, velZ: number): number {
    const speedSq = velX * velX + velZ * velZ;
    if (speedSq <= 1e-6) return 0;
    return (velX * Math.sin(yaw) + velZ * Math.cos(yaw)) / Math.sqrt(speedSq);
}

/**
 * Next value of the backpedal latch. `wasBackpedalling` is the current one - the
 * decision is hysteretic, so it cannot be derived from this frame alone. A
 * stationary hero holds whatever it had rather than snapping the legs around
 * while standing still.
 */
export function nextBackpedalling(
    wasBackpedalling: boolean,
    yaw: number,
    velX: number,
    velZ: number,
): boolean {
    const speedSq = velX * velX + velZ * velZ;
    if (speedSq <= 1e-6) return wasBackpedalling;
    const alignment = travelAlignment(yaw, velX, velZ);
    return wasBackpedalling
        ? alignment < BACKPEDAL_EXIT
        : alignment < BACKPEDAL_ENTER;
}
