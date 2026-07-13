/**
 * math.ts - small math helpers for the Three.js engine layer.
 *
 * RGBA replaces Babylon's Color4 (Three separates color and alpha); the
 * heading helpers are THE single left-handed -> right-handed conversion
 * point for the migration - every yaw/facing computation must go through
 * them so a handedness fix is a one-line change, not a codebase audit.
 */

import { Color, Object3D, Vector3 } from 'three';

/** Color-with-alpha value type (Babylon Color4 replacement). */
export class RGBA {
    constructor(
        public r = 0,
        public g = 0,
        public b = 0,
        public a = 1,
    ) {}

    public set(r: number, g: number, b: number, a: number): this {
        this.r = r; this.g = g; this.b = b; this.a = a;
        return this;
    }

    public copy(c: RGBA): this {
        return this.set(c.r, c.g, c.b, c.a);
    }

    public clone(): RGBA {
        return new RGBA(this.r, this.g, this.b, this.a);
    }

    /** this = a + (b - a) * t, component-wise. */
    public lerpColors(a: RGBA, b: RGBA, t: number): this {
        this.r = a.r + (b.r - a.r) * t;
        this.g = a.g + (b.g - a.g) * t;
        this.b = a.b + (b.b - a.b) * t;
        this.a = a.a + (b.a - a.a) * t;
        return this;
    }
}

export function rgba(r: number, g: number, b: number, a = 1): RGBA {
    return new RGBA(r, g, b, a);
}

/** Readonly axis constants - never mutate these. */
export const V3_UP: Readonly<Vector3> = new Vector3(0, 1, 0);
export const V3_ZERO: Readonly<Vector3> = new Vector3(0, 0, 0);

/**
 * Yaw (rotation.y) that makes a model face the world-space direction
 * (dx, dz). Babylon (left-handed) used `atan2(dx, dz)`; glTF models load
 * into Three facing +Z without Babylon's __root__ Z-flip, so the same
 * formula holds until the Phase D handedness audit says otherwise.
 * ALL facing math must call this - do not inline atan2 headings.
 */
export function headingToYaw(dx: number, dz: number): number {
    return Math.atan2(dx, dz);
}

/** Inverse of headingToYaw: unit direction (out.x, out.z) for a yaw. */
export function yawToHeading(yaw: number, out: Vector3): Vector3 {
    out.set(Math.sin(yaw), 0, Math.cos(yaw));
    return out;
}

/**
 * Position an object on a spherical orbit around `target` and aim it at the
 * target - the Babylon ArcRotateCamera (alpha, beta, radius) contract.
 * alpha = longitude around Y from +X toward +Z, beta = polar angle from +Y.
 */
export function setArcPosition(
    obj: Object3D,
    alpha: number,
    beta: number,
    radius: number,
    target: Vector3,
): void {
    const sinBeta = Math.sin(beta);
    obj.position.set(
        target.x + radius * sinBeta * Math.cos(alpha),
        target.y + radius * Math.cos(beta),
        target.z + radius * sinBeta * Math.sin(alpha),
    );
    obj.lookAt(target);
}

/** `new Color('#rrggbb')` with the Babylon Color3.FromHexString name, for mechanical conversion. */
export function colorFromHex(hex: string): Color {
    return new Color(hex);
}
