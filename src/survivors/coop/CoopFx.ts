import { Scene, Vector3, MeshBuilder, Color3 } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';

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
