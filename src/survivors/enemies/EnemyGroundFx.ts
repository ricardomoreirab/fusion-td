/**
 * Ground telegraphs and impacts for enemy area attacks (the lava golem's boulder,
 * the dragon turtle's quake).
 *
 * Every mesh here is transient, so the leak rules in CLAUDE.md apply in full:
 * materials come from `getCachedMaterial` under a BOUNDED key (one per effect
 * VARIANT — the `key` argument must be a module constant at the call site, never
 * anything per-instance), fades go through `setMeshOpacity` (clone-on-write), and
 * teardown always runs through `disposeMesh`.
 *
 * Timing runs on `tween`, i.e. the SceneHost animation bus, so a telegraph
 * freezes with the rest of the game when the run is paused rather than expiring
 * behind the pause menu.
 */

import { Color, DoubleSide, Vector3 } from 'three';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import type { SceneHost } from '../../engine/three/SceneHost';
import { headingToYaw } from '../../engine/three/math';
import { createDisc, createPlane, createTorus, disposeMesh } from '../../engine/three/primitives';
import { tween, type TweenHandle } from '../../engine/three/tween';
import { emitCoopFx, isCoopFxActive } from '../coop/CoopFx';

/** Lifted off the ground plane so the disc/ring never z-fight the terrain. */
const GROUND_LIFT = 0.06;

/**
 * The area attacks that draw on the ground. A closed union rather than a free
 * string because these names ARE the material-cache keys — the type is what
 * keeps the key set bounded — and because they cross the wire: the co-op host
 * broadcasts the kind and the guest replays the identical effect from it.
 */
export type GroundFxKind = 'boulder' | 'quake' | 'slam';

const GROUND_FX_COLOR: Record<GroundFxKind, Color> = {
    boulder: new Color(0.62, 0.24, 0.10),
    quake: new Color(0.85, 0.62, 0.20),
    /** Impact-only (a boss landing its leap) — never drawn as a telegraph. */
    slam: new Color(1.0, 0.42, 0.14),
};

/** True for a string that came off the wire and names a real effect. */
export function isGroundFxKind(s: string): s is GroundFxKind {
    return s === 'boulder' || s === 'quake' || s === 'slam';
}

/**
 * Directional counterpart of the radial kinds above: an attack that sweeps a
 * LANE rather than filling a circle.
 *
 * A lane is fully described by its kind plus its two endpoints, which is what
 * lets it cross the wire in one FxMsg with nothing packed into the hint — the
 * width and wind-up live here, so the enemy that charges and the guest that
 * replays the marker read the SAME duration and can never drift.
 */
export type LaneFxKind = 'charge' | 'smash';

export const LANE_FX: Record<LaneFxKind, { width: number; windupS: number; color: Color }> = {
    charge: { width: 2.4, windupS: 0.7, color: new Color(0.95, 0.35, 0.12) },
    /** The fortress titan's line smash. Wider and slower than the gore charge —
     *  the titan does not travel down the lane, so the only counterplay is to be
     *  out of it, and a wide lane needs a longer read to be leaveable. */
    smash: { width: 3.4, windupS: 0.95, color: new Color(0.85, 0.72, 0.28) },
};

export function isLaneFxKind(s: string): s is LaneFxKind {
    return s === 'charge' || s === 'smash';
}

/**
 * Broadcast a ground effect to the co-op teammate.
 *
 * The guest never ticks enemy AI, so an area attack it is not told about simply
 * does not happen on its screen — the golem would mime the throw and the turtle
 * would rear up over undisturbed ground. Replay is purely cosmetic (the impact
 * itself is host-authoritative), and `isCoopFxActive()` gates the whole thing so
 * single-player pays one null check.
 *
 * `radius` and `durationS` ride in the tx/tz slots, which are plain numbers on
 * the wire; `kind` rides in `hint` and is re-validated on arrival.
 */
export function emitGroundFx(
    channel: 'enemyTelegraph' | 'enemyImpact',
    x: number, z: number,
    radius: number, durationS: number,
    kind: GroundFxKind,
): void {
    if (!isCoopFxActive()) return;
    emitCoopFx(channel, x, z, radius, durationS, kind);
}

/** Lane counterpart. The two endpoints carry direction AND length, and the kind
 *  carries width + wind-up, so nothing has to be packed into the hint. */
export function emitLaneFx(
    fromX: number, fromZ: number,
    toX: number, toZ: number,
    kind: LaneFxKind,
): void {
    if (!isCoopFxActive()) return;
    emitCoopFx('enemyLane', fromX, fromZ, toX, toZ, kind);
}

/**
 * The "this is about to be hit" marker: a fixed outline ring at the full blast
 * radius with a disc that fills it over `durationS`. The fill IS the countdown —
 * a full disc means the hit lands now — so the player reads the danger zone and
 * its timing from one shape.
 *
 * Returns a cancel handle for the caller that owns the attack; calling it tears
 * the telegraph down early (e.g. the attacker died mid-flight).
 */
export function spawnGroundTelegraph(
    host: SceneHost,
    x: number,
    z: number,
    radius: number,
    durationS: number,
    kind: GroundFxKind,
): { cancel(): void } {
    const key = kind;
    const color = GROUND_FX_COLOR[kind];
    const outline = createTorus(`${key}Outline`, {
        diameter: radius * 2, thickness: 0.16, tessellation: 28,
    }, host);
    outline.position.set(x, GROUND_LIFT, z);
    outline.material = getCachedMaterial(`${key}OutlineMat`, m => {
        m.emissive = color.clone();
        m.color.setRGB(0, 0, 0);
    });

    const fill = createDisc(`${key}Fill`, { radius: 1, tessellation: 28 }, host);
    fill.rotation.x = -Math.PI / 2; // lie flat, +Y normal
    fill.position.set(x, GROUND_LIFT * 0.5, z);
    fill.material = getCachedMaterial(`${key}FillMat`, m => {
        m.emissive = color.clone();
        m.color.setRGB(0, 0, 0);
    });
    fill.scale.set(0.001, 0.001, 0.001);

    let done = false;
    const teardown = (): void => {
        if (done) return;
        done = true;
        disposeMesh(outline);
        disposeMesh(fill);
    };

    const handle = tween(host, durationS, t => {
        const s = Math.max(0.001, radius * t);
        fill.scale.set(s, s, s);
        setMeshOpacity(fill, 0.16 + 0.24 * t);
        setMeshOpacity(outline, 0.45 + 0.4 * t);
    }, { onEnd: teardown });

    return { cancel: () => { handle.stop(); teardown(); } };
}

/**
 * The lane a charge is about to sweep: a rectangle from (fromX,fromZ) to
 * (toX,toZ) that fills from the charger outward over the wind-up. Same reading
 * as the radial telegraph — the fill IS the countdown, and here it also shows
 * which way the charge is committed, so stepping SIDEWAYS is the counterplay
 * rather than stepping back.
 */
export function spawnLaneTelegraph(
    host: SceneHost,
    fromX: number, fromZ: number,
    toX: number, toZ: number,
    kind: LaneFxKind,
): { cancel(): void } {
    const { width, windupS, color } = LANE_FX[kind];
    const dx = toX - fromX, dz = toZ - fromZ;
    const length = Math.hypot(dx, dz) || 0.001;
    const yaw = headingToYaw(dx, dz);

    // Built once at full length and SCALED along its own local axis, so the fill
    // grows away from the charger instead of out of its middle: the plane is
    // positioned by its centre, so the centre has to travel as it grows.
    const lane = createPlane(`${kind}Lane`, { width, height: length }, host);
    // Keep YXZ so the yaw still applies in the ground plane (Babylon-era order,
    // matching the boss's dash telegraph).
    lane.rotation.order = 'YXZ';
    lane.rotation.x = -Math.PI / 2;
    lane.rotation.y = yaw;
    lane.material = getCachedMaterial(`${kind}LaneMat`, m => {
        m.emissive = color.clone();
        m.color.setRGB(0, 0, 0);
        m.side = DoubleSide; // a ground-flat plane must be visible from above
    });

    const ux = dx / length, uz = dz / length;
    const place = (t: number): void => {
        const grown = Math.max(0.001, t);
        lane.scale.set(1, grown, 1);
        lane.position.set(
            fromX + ux * (length * grown) / 2,
            GROUND_LIFT,
            fromZ + uz * (length * grown) / 2,
        );
    };
    place(0);

    let done = false;
    const teardown = (): void => {
        if (done) return;
        done = true;
        disposeMesh(lane);
    };

    const handle = tween(host, windupS, t => {
        place(t);
        setMeshOpacity(lane, 0.22 + 0.35 * t);
    }, { onEnd: teardown });

    return { cancel: () => { handle.stop(); teardown(); } };
}

/** The hit itself: a ring snapping outward from nothing to `radius` and fading. */
export function spawnGroundShockwave(
    host: SceneHost,
    x: number,
    z: number,
    radius: number,
    kind: GroundFxKind,
): void {
    const key = kind;
    const color = GROUND_FX_COLOR[kind];
    const ring = createTorus(`${key}Wave`, {
        diameter: 2, thickness: 0.34, tessellation: 28,
    }, host);
    ring.position.set(x, GROUND_LIFT * 2, z);
    ring.material = getCachedMaterial(`${key}WaveMat`, m => {
        m.emissive = color.clone();
        m.color.setRGB(0, 0, 0);
    });

    // Ease-out: the wave leaves fast and settles, which reads as force. Scale is
    // on X/Z only — a torus scaled on Y would thicken into a tube.
    tween(host, 0.42, t => {
        const s = Math.max(0.001, radius * t);
        ring.scale.set(s, 1, s);
        setMeshOpacity(ring, 0.9 * (1 - t));
    }, {
        ease: t => 1 - (1 - t) * (1 - t),
        onEnd: () => disposeMesh(ring),
    });
}

/**
 * Straight-line flight along a parabola from `from` to `to` over `durationS`,
 * driving `onStep` with the world position each frame. The caller owns the mesh
 * (so it can pool it) and `onLand` fires once at the end.
 *
 * Returns the tween handle: the flight lives on the scene's animation bus, NOT
 * on the thrower, so it keeps ticking after the thrower is gone. That is
 * deliberate for a kill (the rock is already in the air) but wrong for run
 * teardown, and `stop()` is how the owner distinguishes the two.
 */
export function arcProjectile(
    host: SceneHost,
    from: Vector3,
    to: { x: number; z: number },
    peakHeight: number,
    durationS: number,
    onStep: (x: number, y: number, z: number) => void,
    onLand: () => void,
): TweenHandle {
    const x0 = from.x, y0 = from.y, z0 = from.z;
    return tween(host, durationS, t => {
        // 4t(1−t) peaks at 1 when t = 0.5 and is 0 at both ends, so the arc starts
        // at the muzzle height and lands exactly on the ground plane.
        onStep(
            x0 + (to.x - x0) * t,
            y0 + (0 - y0) * t + peakHeight * 4 * t * (1 - t),
            z0 + (to.z - z0) * t,
        );
    }, { onEnd: onLand });
}
