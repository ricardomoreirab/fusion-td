import { GLOBE_RADIUS } from './constants';

/** Pure globe-curvature drop: how far below the flat plane a point (dx, dz)
 *  away from the curve origin (the hero) RENDERS. d²/2R is the small-angle
 *  approximation of a sphere of radius R. Render-only — gameplay math always
 *  stays flat; never feed this back into a gameplay position. */
export function curveDrop(dx: number, dz: number, radius: number = GLOBE_RADIUS): number {
    return (dx * dx + dz * dz) / (2 * radius);
}

// Module-level curve origin (the hero's flat position). Set once per frame by
// SurvivorsGameplayState.update and cleared in exit(), so render-only consumers
// (Enemy mesh sync, drops, props) can read the drop without threading hero refs.
let originX = 0;
let originZ = 0;
let originSet = false;

export function setCurveOrigin(x: number, z: number): void {
    originX = x;
    originZ = z;
    originSet = true;
}

export function clearCurveOrigin(): void {
    originSet = false;
}

/** Drop at world (x, z) relative to the current origin; 0 when no origin set
 *  (menu, tests, or after exit()) so every consumer degrades to flat. */
export function curveDropAt(x: number, z: number): number {
    return originSet ? curveDrop(x - originX, z - originZ) : 0;
}
