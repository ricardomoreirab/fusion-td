// Pure nearest-alive target resolver. No Babylon, no DOM — safe for Vitest.

export interface TargetProvider {
    getPosition(): { x: number; z: number };
    isAlive?(): boolean;
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
