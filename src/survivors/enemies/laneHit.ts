/**
 * Is a point inside a rectangular attack lane?
 *
 * Pure — no Three, no Enemy — so `tests/laneHit.spec.ts` can pin the one
 * property the move depends on: **the painted lane IS the hitbox**. A lane attack
 * is telegraphed by a rectangle drawn on the ground (`spawnLaneTelegraph`), and
 * the player's entire counterplay is reading that rectangle and standing outside
 * it. If the test that resolves the hit is a circle approximating the rectangle,
 * or disagrees with it by any margin, the attack lands where nothing was drawn —
 * which reads as the game cheating rather than as a missed dodge.
 *
 * Split out rather than inlined for the same reason `leapMotion` and `meleeLunge`
 * were: the geometry is where these moves go subtly wrong, and it is the part a
 * headless test can actually cover.
 */

/**
 * @param relX  target position minus the attacker's, X
 * @param relZ  target position minus the attacker's, Z
 * @param dirX  lane heading, X (must be unit length)
 * @param dirZ  lane heading, Z (must be unit length)
 * @param length     how far down the heading the lane reaches
 * @param halfWidth  how far to either side of the centre line it reaches
 */
export function isInLane(
    relX: number, relZ: number,
    dirX: number, dirZ: number,
    length: number, halfWidth: number,
): boolean {
    // Distance ALONG the lane. Negative means behind the attacker, which is
    // never hit — a lane is directional, and a symmetric test would make
    // stepping through the attacker a way to take the hit twice as often.
    const along = relX * dirX + relZ * dirZ;
    if (along < 0 || along > length) return false;

    // Distance ACROSS it: whatever is left of the offset once the along-lane
    // component is removed.
    const acrossX = relX - dirX * along;
    const acrossZ = relZ - dirZ * along;
    return acrossX * acrossX + acrossZ * acrossZ <= halfWidth * halfWidth;
}
