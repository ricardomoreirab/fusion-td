// Pure nearest-alive target resolver. No Babylon, no DOM — safe for Vitest.
// The Vector3 import is type-only, so nothing from three survives compilation.

import type { Vector3 } from 'three';

export interface TargetProvider {
    getPosition(): { x: number; z: number };
    isAlive?(): boolean;
}

/**
 * A hero as an enemy sees it: somewhere to walk toward, plus the channels an
 * enemy can act on it through.
 *
 * Everything past `getPosition` is optional because the co-op ghost provider
 * (the teammate the host simulates) supplies position and liveness only — an
 * enemy special that pulls, slows or shoves must therefore be written to no-op
 * against a teammate rather than assume the channel is there.
 *
 * This is ONE declaration on purpose: the same shape used to be spelled out
 * inline in `Enemy.seekTarget`, in `EnemyManager.heroProvider` and again in
 * `configureSurvivorsMode`'s parameter, and adding a channel meant remembering
 * all three.
 */
export interface HeroProvider extends TargetProvider {
    getPosition(): Vector3;
    takeDamage?(amount: number, sourcePos?: Vector3): void;
    /** Drag the hero toward a world point over durationS (boss grab). */
    applyPull?(towardX: number, towardZ: number, speed: number, durationS: number): void;
    /** Temporarily slow the hero's move speed (multiplier < 1). */
    applySlow?(multiplier: number, durationS: number): void;
    /** Shove the hero along a normalized heading (dragon-turtle quake). */
    applyKnockback?(dirX: number, dirZ: number, speed: number, durationS: number): void;
}

/** Returns the nearest provider whose isAlive() is not false.
 *  Returns null when the list is empty or all providers are dead.
 *  Ties resolve to the earliest entry in the array (strict less-than). */
export function pickNearestAlive(
    fromX: number,
    fromZ: number,
    providers: TargetProvider[],
): TargetProvider | null {
    let best: TargetProvider | null = null;
    let bestDist = Infinity;
    for (const p of providers) {
        if (p.isAlive && p.isAlive() === false) continue;
        const pos = p.getPosition();
        const dx = pos.x - fromX, dz = pos.z - fromZ;
        const d = dx * dx + dz * dz;
        if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
}
