import { Scene, Vector3, MeshBuilder, Color3 } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
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
const FX_COLOR: Record<string, Color3> = {
    fire:     new Color3(1.0, 0.45, 0.15),
    ice:      new Color3(0.5, 0.8, 1.0),
    arcane:   new Color3(0.7, 0.4, 1.0),
    physical: new Color3(1.0, 0.9, 0.4),
    storm:    new Color3(0.6, 0.9, 1.0),
};

/**
 * Replay a teammate's basic-attack projectile: a small emissive orb flying from (fromX,
 * fromZ) to (toX,toZ), then gone. Cosmetic only — never touches an enemy. Leak-safe: the
 * material is cached by a BOUNDED key (shape+element), so the plain mesh.dispose() that
 * frees the mesh leaves the shared material alone (cleared on run teardown).
 */
export function spawnCosmeticProjectile(
    scene: Scene,
    shape: string,
    fromX: number, fromZ: number,
    toX: number, toZ: number,
    element = 'physical',
): void {
    const diameter = shape === 'arrow' ? 0.22 : shape === 'mageBolt' ? 0.4 : 0.3;
    const mesh = MeshBuilder.CreateSphere('coopFxProj', { diameter, segments: 4 }, scene);
    mesh.position.set(fromX, 1, fromZ);
    const color = FX_COLOR[element] ?? FX_COLOR.physical;
    mesh.material = getCachedMaterial(scene, `coopFxProjMat_${element}`, m => {
        m.emissiveColor = color;
        m.diffuseColor = new Color3(0, 0, 0);
        m.disableLighting = true;
    });

    const target = new Vector3(toX, 1, toZ);
    const speed = 22;
    const startMs = performance.now();
    const dir = new Vector3();
    const observer = scene.onBeforeRenderObservable.add(() => {
        target.subtractToRef(mesh.position, dir);
        const dist = dir.length();
        if (dist < 0.4 || performance.now() - startMs > 2000) {
            mesh.dispose(); // material is cached/shared — keep it
            scene.onBeforeRenderObservable.remove(observer);
            return;
        }
        const dt = scene.getEngine().getDeltaTime() / 1000;
        dir.normalize().scaleInPlace(Math.min(dist, speed * dt));
        mesh.position.addInPlace(dir);
    });
}

/**
 * Replay a RedWizard bolt seen by the guest: a magenta/arcane orb travelling from the
 * enemy position to the hero target at the same speed as the host bolt (14 u/s).
 * Cosmetic only — damage is authoritative via snapshot/damageResult.
 * Leak-safe: material cached by bounded key ('arcane'), plain mesh.dispose() leaves it.
 */
export function spawnCosmeticEnemyProjectile(
    scene: Scene,
    fromX: number, fromZ: number,
    toX: number, toZ: number,
): void {
    const mesh = MeshBuilder.CreateSphere('coopFxEnemyProj', { diameter: 0.4, segments: 4 }, scene);
    mesh.position.set(fromX, 1.4, fromZ); // match fireBolt y-offset (staff-orb height)
    mesh.material = getCachedMaterial(scene, 'coopFxProjMat_arcane', m => {
        m.emissiveColor = FX_COLOR.arcane;
        m.diffuseColor = new Color3(0, 0, 0);
        m.disableLighting = true;
    });

    const target = new Vector3(toX, 1.4, toZ);
    const speed = 14; // matches RedWizard.BOLT_SPEED
    const startMs = performance.now();
    const dir = new Vector3();
    const observer = scene.onBeforeRenderObservable.add(() => {
        target.subtractToRef(mesh.position, dir);
        const dist = dir.length();
        if (dist < 0.4 || performance.now() - startMs > 3000) {
            mesh.dispose(); // material is cached/shared — keep it
            scene.onBeforeRenderObservable.remove(observer);
            return;
        }
        const dt = scene.getEngine().getDeltaTime() / 1000;
        dir.normalize().scaleInPlace(Math.min(dist, speed * dt));
        mesh.position.addInPlace(dir);
    });
}

/**
 * Replay a MilestoneBoss dash or pull telegraph on the guest's screen so the player
 * can read and dodge the special move. hint='dash' → red lane rectangle; 'pull' → purple
 * disc. Fades over TELEGRAPH_DURATION (0.6s) to match the host side.
 *
 * Leak-safe: materials cached by bounded keys ('coopFxTelegraphDash' /
 * 'coopFxTelegraphPull'), plain mesh.dispose() leaves the shared materials alone, fade
 * via mesh.visibility not the material's alpha (per CLAUDE.md FX rules).
 */
export function spawnCosmeticTelegraph(
    scene: Scene,
    fromX: number, fromZ: number,
    toX: number, toZ: number,
    hint: 'dash' | 'pull',
): void {
    const duration = 0.6; // matches TELEGRAPH_DURATION in MilestoneBoss
    let mesh: ReturnType<typeof MeshBuilder.CreatePlane> | ReturnType<typeof MeshBuilder.CreateDisc>;

    if (hint === 'pull') {
        // Purple grab-zone disc centered at boss position (matches spawnPullTelegraph).
        const pullRadius = 3.0; // PULL_TELEGRAPH_RADIUS
        mesh = MeshBuilder.CreateDisc('coopFxPullTele', { radius: pullRadius, tessellation: 24 }, scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(fromX, 0.05, fromZ);
        mesh.material = getCachedMaterial(scene, 'coopFxTelegraphPull', m => {
            m.emissiveColor = new Color3(0.55, 0.1, 0.9);
            m.diffuseColor = new Color3(0, 0, 0);
            m.disableLighting = true;
            m.alpha = 0.45;
        });
    } else {
        // Red lane rectangle pointing from origin toward dash endpoint (matches spawnDashTelegraph).
        const dashDistance = 6.0; // DASH_DISTANCE
        const dx = toX - fromX;
        const dz = toZ - fromZ;
        const angle = -Math.atan2(dz, dx) + Math.PI / 2;
        mesh = MeshBuilder.CreatePlane('coopFxDashTele', { width: 1.4, height: dashDistance }, scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.rotation.y = angle;
        const len = Math.hypot(dx, dz) || 1;
        mesh.position.x = fromX + (dx / len) * (dashDistance / 2);
        mesh.position.z = fromZ + (dz / len) * (dashDistance / 2);
        mesh.position.y = 0.05;
        mesh.material = getCachedMaterial(scene, 'coopFxTelegraphDash', m => {
            m.emissiveColor = new Color3(1, 0.1, 0.1);
            m.diffuseColor = new Color3(0, 0, 0);
            m.disableLighting = true;
            m.alpha = 0.55;
        });
    }

    let t = 0;
    const observer = scene.onBeforeRenderObservable.add(() => {
        t += scene.getEngine().getDeltaTime() / 1000;
        const k = Math.min(t / duration, 1);
        mesh.visibility = 1 - k; // fade via visibility, NOT the shared material's alpha
        if (k >= 1) { mesh.dispose(); scene.onBeforeRenderObservable.remove(observer); }
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
 * tick observer on every path, and the visuals' own dispose handles their meshes,
 * observers, and particle systems (cached materials are shared + bounded).
 */
export function startCosmeticUltChannel(
    scene: Scene,
    ability: 'whirlwind' | 'multishot',
    getCenter: () => Vector3 | null,
    getFacing: () => number,
    durationS: number,
    radius: number,
): { dispose: () => void } {
    const visual = ability === 'whirlwind'
        ? spawnHurricaneVisual(scene, getCenter, durationS, radius)
        : spawnMultishotAura(scene, getCenter);
    const tickInterval = ability === 'whirlwind' ? 0.3 : durationS / 30;

    let elapsed = 0;
    let sinceTick = 0;
    const tickObs = scene.onBeforeRenderObservable.add(() => {
        const dt = scene.getEngine().getDeltaTime() / 1000;
        elapsed += dt;
        sinceTick += dt;
        // Past the channel duration the visual has faded itself out — stop ticking
        // and just wait for 'ultStop' (or the caller's safety timeout) to dispose.
        if (elapsed > durationS || sinceTick < tickInterval) return;
        sinceTick = 0;
        const c = getCenter();
        if (!c) return;
        if (ability === 'whirlwind') {
            spawnWhirlwindRing(scene, c, radius);
            // Secondary outer ring — matches the local concentric-tornado read.
            spawnWhirlwindRing(scene, c, radius * 1.4);
        } else {
            const ang = getFacing() + (Math.random() - 0.5) * 0.9;
            spawnCosmeticVolleyArrow(scene, c, Math.sin(ang), Math.cos(ang));
        }
    });

    let disposed = false;
    return {
        dispose: () => {
            if (disposed) return;
            disposed = true;
            scene.onBeforeRenderObservable.remove(tickObs);
            visual.dispose();
        },
    };
}

/**
 * Replay a teammate's melee swing arc: a golden torus that expands + fades over ~0.3s
 * at (x,z) with the given range. Cosmetic. Leak-safe (cached material, plain dispose,
 * fade via mesh.visibility never the shared material's alpha — per CLAUDE.md FX rules).
 */
export function spawnCosmeticSwingRing(scene: Scene, x: number, z: number, range: number): void {
    const ring = MeshBuilder.CreateTorus('coopFxSwing', { diameter: range * 2, thickness: 0.4, tessellation: 24 }, scene);
    ring.position.set(x, 0.25, z);
    ring.material = getCachedMaterial(scene, 'coopFxSwingMat', m => {
        m.emissiveColor = new Color3(1, 0.85, 0.4);
        m.diffuseColor = new Color3(0, 0, 0);
        m.disableLighting = true;
        m.alpha = 0.85;
    });
    ring.scaling.setAll(0.7);
    const dur = 0.3;
    let t = 0;
    const observer = scene.onBeforeRenderObservable.add(() => {
        t += scene.getEngine().getDeltaTime() / 1000;
        const k = Math.min(t / dur, 1);
        ring.scaling.setAll(0.7 + 0.3 * k);
        ring.visibility = 1 - k; // fade via visibility, NOT the cached material's alpha
        if (k >= 1) { ring.dispose(); scene.onBeforeRenderObservable.remove(observer); }
    });
}
