import { Color, DoubleSide, Mesh, Vector3 } from 'three';
import { SceneHost } from '../../engine/three/SceneHost';
import { createDisc, createPlane, createSphere, createTorus, disposeMesh } from '../../engine/three/primitives';
import { headingToYaw } from '../../engine/three/math';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';
import {
    spawnHurricaneVisual, spawnWhirlwindRing,
    spawnMultishotAura, spawnCosmeticVolleyArrow,
} from '../abilities/AbilityVisuals';

/**
 * Cosmetic-FX replication glue (co-op). Combat-visual sites (basic-attack projectiles,
 * power/ult casts) call emitCoopFx() so the gameplay layer can broadcast the visual to
 * the teammate, who replays it with NO gameplay effect. A module-level hook keeps the
 * FX-producing code (HeroBasicAttack, PowerEffects, …) decoupled from CoopSession —
 * mirrors how Enemy.onDamageCallback bridges enemies → the gameplay HUD.
 *
 * No-op in single-player (the hook stays null), so there is zero SP overhead.
 */
export type CoopFxEmit = (kind: string, x: number, z: number, tx?: number, tz?: number, hint?: string) => void;

let _emit: CoopFxEmit | null = null;
export function setCoopFxEmit(fn: CoopFxEmit | null): void { _emit = fn; }
export function emitCoopFx(kind: string, x: number, z: number, tx?: number, tz?: number, hint?: string): void {
    _emit?.(kind, x, z, tx, tz, hint);
}
/** True only while a co-op session has wired an emitter. Callers use this as the
 *  cheap gate BEFORE building hint payloads (JSON), so single-player pays nothing. */
export function isCoopFxActive(): boolean { return _emit !== null; }

// ── replay re-entrancy guard ─────────────────────────────────────────────────
// A REPLAYED effect runs the same primitive code as a local cast, which would
// re-emit and echo the FX back to its sender forever. The receiver wraps every
// replay in withFxReplay(); emitting sites skip while isReplayingFx() is true.
// Depth counter (not a boolean) so a nested withFxReplay can't clear the guard
// before the outer replay finishes.
let _replayDepth = 0;
export function isReplayingFx(): boolean { return _replayDepth > 0; }
export function withFxReplay(fn: () => void): void {
    _replayDepth++;
    try { fn(); } finally { _replayDepth--; }
}

/** Element → emissive colour for cosmetic projectiles/casts. Bounded set → cached mats. */
const FX_COLOR: Record<string, Color> = {
    fire:     new Color(1.0, 0.45, 0.15),
    ice:      new Color(0.5, 0.8, 1.0),
    arcane:   new Color(0.7, 0.4, 1.0),
    physical: new Color(1.0, 0.9, 0.4),
    storm:    new Color(0.6, 0.9, 1.0),
};

/**
 * Replay a teammate's basic-attack projectile: a small emissive orb flying from (fromX,
 * fromZ) to (toX,toZ), then gone. Cosmetic only — never touches an enemy. Leak-safe: the
 * material is cached by a BOUNDED key (shape+element), so the plain disposeMesh() that
 * frees the mesh leaves the shared material alone (cleared on run teardown).
 */
export function spawnCosmeticProjectile(
    host: SceneHost,
    shape: string,
    fromX: number, fromZ: number,
    toX: number, toZ: number,
    element = 'physical',
): void {
    const diameter = shape === 'arrow' ? 0.22 : shape === 'mageBolt' ? 0.4 : 0.3;
    const mesh = createSphere('coopFxProj', { diameter, segments: 4 }, host);
    mesh.position.set(fromX, 1, fromZ);
    const color = FX_COLOR[element] ?? FX_COLOR.physical;
    mesh.material = getCachedMaterial(`coopFxProjMat_${element}`, m => {
        m.emissive.copy(color);
        m.color.setRGB(0, 0, 0); // black diffuse + emissive = unlit look
    });

    const target = new Vector3(toX, 1, toZ);
    const speed = 22;
    const startMs = performance.now();
    const dir = new Vector3();
    const token = host.onBeforeRender.add(() => {
        dir.subVectors(target, mesh.position);
        const dist = dir.length();
        if (dist < 0.4 || performance.now() - startMs > 2000) {
            disposeMesh(mesh); // material is cached/shared — keep it
            host.onBeforeRender.remove(token);
            return;
        }
        const dt = host.deltaSeconds;
        dir.normalize().multiplyScalar(Math.min(dist, speed * dt));
        mesh.position.add(dir);
    });
}

/**
 * Replay a RedWizard bolt seen by the guest: a magenta/arcane orb travelling from the
 * enemy position to the hero target at the same speed as the host bolt (14 u/s).
 * Cosmetic only — damage is authoritative via snapshot/damageResult.
 * Leak-safe: material cached by bounded key ('arcane'), plain disposeMesh() leaves it.
 */
export function spawnCosmeticEnemyProjectile(
    host: SceneHost,
    fromX: number, fromZ: number,
    toX: number, toZ: number,
): void {
    const mesh = createSphere('coopFxEnemyProj', { diameter: 0.4, segments: 4 }, host);
    mesh.position.set(fromX, 1.4, fromZ); // match fireBolt y-offset (staff-orb height)
    mesh.material = getCachedMaterial('coopFxProjMat_arcane', m => {
        m.emissive.copy(FX_COLOR.arcane);
        m.color.setRGB(0, 0, 0);
    });

    const target = new Vector3(toX, 1.4, toZ);
    const speed = 14; // matches RedWizard.BOLT_SPEED
    const startMs = performance.now();
    const dir = new Vector3();
    const token = host.onBeforeRender.add(() => {
        dir.subVectors(target, mesh.position);
        const dist = dir.length();
        if (dist < 0.4 || performance.now() - startMs > 3000) {
            disposeMesh(mesh); // material is cached/shared — keep it
            host.onBeforeRender.remove(token);
            return;
        }
        const dt = host.deltaSeconds;
        dir.normalize().multiplyScalar(Math.min(dist, speed * dt));
        mesh.position.add(dir);
    });
}

/**
 * Replay a MilestoneBoss dash or pull telegraph on the guest's screen so the player
 * can read and dodge the special move. hint='dash' → red lane rectangle; 'pull' → purple
 * disc. Fades over TELEGRAPH_DURATION (0.6s) to match the host side.
 *
 * Leak-safe: materials cached by bounded keys ('coopFxTelegraphDash' /
 * 'coopFxTelegraphPull'); setMeshOpacity clones the shared material on first fade
 * (ownedMaterial), which disposeMesh() then frees with the mesh (per CLAUDE.md FX rules).
 */
export function spawnCosmeticTelegraph(
    host: SceneHost,
    fromX: number, fromZ: number,
    toX: number, toZ: number,
    hint: 'dash' | 'pull',
): void {
    const duration = 0.6; // matches TELEGRAPH_DURATION in MilestoneBoss
    let mesh: Mesh;
    let baseAlpha: number;

    if (hint === 'pull') {
        // Purple grab-zone disc centered at boss position (matches spawnPullTelegraph).
        const pullRadius = 3.0; // PULL_TELEGRAPH_RADIUS
        mesh = createDisc('coopFxPullTele', { radius: pullRadius, tessellation: 24 }, host);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(fromX, 0.05, fromZ);
        baseAlpha = 0.45;
        mesh.material = getCachedMaterial('coopFxTelegraphPull', m => {
            m.emissive.setRGB(0.55, 0.1, 0.9);
            m.color.setRGB(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.45;
            m.side = DoubleSide; // ground-flat plane must be visible from above
        });
    } else {
        // Red lane rectangle pointing from origin toward dash endpoint (matches spawnDashTelegraph).
        const dashDistance = 6.0; // DASH_DISTANCE
        const dx = toX - fromX;
        const dz = toZ - fromZ;
        const angle = headingToYaw(dx, dz); // == -atan2(dz,dx)+π/2 routed through the single conversion point
        mesh = createPlane('coopFxDashTele', { width: 1.4, height: dashDistance }, host);
        mesh.rotation.order = 'YXZ'; // Babylon's yaw-pitch-roll rotation order
        mesh.rotation.x = Math.PI / 2;
        mesh.rotation.y = angle;
        const len = Math.hypot(dx, dz) || 1;
        mesh.position.x = fromX + (dx / len) * (dashDistance / 2);
        mesh.position.z = fromZ + (dz / len) * (dashDistance / 2);
        mesh.position.y = 0.05;
        baseAlpha = 0.55;
        mesh.material = getCachedMaterial('coopFxTelegraphDash', m => {
            m.emissive.setRGB(1, 0.1, 0.1);
            m.color.setRGB(0, 0, 0);
            m.transparent = true;
            m.opacity = 0.55;
            m.side = DoubleSide;
        });
    }

    let t = 0;
    const token = host.onBeforeRender.add(() => {
        t += host.deltaSeconds;
        const k = Math.min(t / duration, 1);
        // Babylon faded via mesh.visibility (multiplies the material alpha);
        // reproduce alpha × (1-k) on the clone-on-write per-mesh material.
        setMeshOpacity(mesh, baseAlpha * (1 - k));
        if (k >= 1) { disposeMesh(mesh); host.onBeforeRender.remove(token); }
    });
}

/**
 * Replay a teammate's CHANNELLED ultimate (M6 C2): a persistent cosmetic visual that
 * follows the ghost's interpolated position each frame, started on 'ultStart' and
 * torn down via the returned dispose handle ('ultStop' / safety timeout / state exit).
 *
 *   - whirlwind: the hurricane (updraft + funnel from AbilityVisuals, the SAME look
 *     as the local cast) + the expanding ground rings at the local 0.3s tick cadence.
 *   - multishot: the green aura + periodic cosmetic volley arrows fired along the
 *     ghost's facing (±spread) at the local 30-arrows-per-duration cadence.
 *
 * Gameplay-inert: AbilityVisuals builders never touch enemies and never emit fx, so
 * no withFxReplay wrap is needed. Leak-safe: dispose() is idempotent, removes the
 * tick callback on every path, and the visuals' own dispose handles their meshes,
 * callbacks, and particle systems (cached materials are shared + bounded).
 */
export function startCosmeticUltChannel(
    host: SceneHost,
    ability: 'whirlwind' | 'multishot',
    getCenter: () => Vector3 | null,
    getFacing: () => number,
    durationS: number,
    radius: number,
): { dispose: () => void } {
    const visual = ability === 'whirlwind'
        ? spawnHurricaneVisual(host, getCenter, durationS, radius)
        : spawnMultishotAura(host, getCenter);
    const tickInterval = ability === 'whirlwind' ? 0.3 : durationS / 30;

    let elapsed = 0;
    let sinceTick = 0;
    const tickToken = host.onBeforeRender.add(() => {
        const dt = host.deltaSeconds;
        elapsed += dt;
        sinceTick += dt;
        // Past the channel duration the visual has faded itself out — stop ticking
        // and just wait for 'ultStop' (or the caller's safety timeout) to dispose.
        if (elapsed > durationS || sinceTick < tickInterval) return;
        sinceTick = 0;
        const c = getCenter();
        if (!c) return;
        if (ability === 'whirlwind') {
            spawnWhirlwindRing(host, c, radius);
            // Secondary outer ring — matches the local concentric-tornado read.
            spawnWhirlwindRing(host, c, radius * 1.4);
        } else {
            const ang = getFacing() + (Math.random() - 0.5) * 0.9;
            spawnCosmeticVolleyArrow(host, c, Math.sin(ang), Math.cos(ang));
        }
    });

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            host.onBeforeRender.remove(tickToken);
            visual.dispose();
        },
    };
}

/**
 * Replay a teammate's melee swing arc: a golden torus that expands + fades over ~0.3s
 * at (x,z) with the given range. Cosmetic. Leak-safe (cached material by bounded key;
 * setMeshOpacity clones it per-mesh for the fade and disposeMesh frees that clone —
 * per CLAUDE.md FX rules).
 */
export function spawnCosmeticSwingRing(host: SceneHost, x: number, z: number, range: number): void {
    const ring = createTorus('coopFxSwing', { diameter: range * 2, thickness: 0.4, tessellation: 24 }, host);
    ring.position.set(x, 0.25, z);
    ring.material = getCachedMaterial('coopFxSwingMat', m => {
        m.emissive.setRGB(1, 0.85, 0.4);
        m.color.setRGB(0, 0, 0);
        m.transparent = true;
        m.opacity = 0.85;
    });
    ring.scale.setScalar(0.7);
    const dur = 0.3;
    let t = 0;
    const token = host.onBeforeRender.add(() => {
        t += host.deltaSeconds;
        const k = Math.min(t / dur, 1);
        ring.scale.setScalar(0.7 + 0.3 * k);
        setMeshOpacity(ring, 0.85 * (1 - k)); // Babylon visibility × material alpha
        if (k >= 1) { disposeMesh(ring); host.onBeforeRender.remove(token); }
    });
}
