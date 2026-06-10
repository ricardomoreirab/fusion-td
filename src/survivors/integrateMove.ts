// Pure hero-movement integration math — the single source of truth shared by:
//   • HeroController.update      (local prediction: input cap + arena clamp)
//   • SurvivorsGameplayState._driveGuestGhostFromInput (host's guest-hero sim)
//   • coop/reconcile.replayInputs (guest input-replay reconciliation, M6 E2)
// No Babylon, no DOM — safe for Vitest. Every op here must stay byte-identical
// to what the live controller previously inlined (dx /= len, k = limit/dist),
// so single-player behavior is unchanged and the network replay reproduces the
// exact same positions the local/host simulation computes.

/** Distance kept between the hero and the arena wall (the controller's `- 0.5`). */
export const ARENA_EDGE_BUFFER = 0.5;

/**
 * Cap a movement-input vector at magnitude 1 (keyboard diagonals normalize;
 * analog joystick input below 1 passes through). Writes into `out` so per-frame
 * callers can reuse a scratch object (no allocation).
 */
export function capInputLen(dx: number, dz: number, out: { dx: number; dz: number }): void {
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    out.dx = dx;
    out.dz = dz;
}

/**
 * Radial arena clamp: returns the factor k to multiply (x, z) by so the point
 * stays within `arenaRadius - ARENA_EDGE_BUFFER` of the center. Returns exactly
 * 1 when already inside (callers can skip the write).
 */
export function arenaClampScale(x: number, z: number, arenaRadius: number): number {
    const dist = Math.hypot(x, z);
    const limit = arenaRadius - ARENA_EDGE_BUFFER;
    return dist > limit ? limit / dist : 1;
}

// Module-level scratch for integrateMove (replay runs once per snapshot, but
// keep it allocation-free anyway — it's trivial).
const _cap = { dx: 0, dz: 0 };

/**
 * One simulation step of hero movement: cap input at magnitude 1, integrate
 * velocity (dx·speed)·dt, then clamp radially inside the arena. Composes the
 * exact math the live path performs across HeroController.update (cap + clamp)
 * and Champion.update's player branch (position += velocity·dt).
 *
 * Note on clamp ordering: the live loop clamps at the START of the next frame
 * (clamp(prev) → integrate), while this composes integrate → clamp. The chains
 * are identical except the final position of a sequence, which the live path
 * leaves unclamped for one frame — a sub-deadzone difference at the arena edge.
 */
export function integrateMove(
    x: number,
    z: number,
    dx: number,
    dz: number,
    speed: number,
    dt: number,
    arenaRadius: number,
): { x: number; z: number } {
    capInputLen(dx, dz, _cap);
    const nx = x + (_cap.dx * speed) * dt;
    const nz = z + (_cap.dz * speed) * dt;
    const k = arenaClampScale(nx, nz, arenaRadius);
    return { x: nx * k, z: nz * k };
}
