/**
 * ItemFx — leak-safe transient visuals for item effects (procs, ricochets,
 * rage aura).
 *
 * Material rules (project invariant): every material here goes through
 * getCachedMaterial with a BOUNDED key (color hex / fixed name — finitely
 * many), so meshes are disposed with dispose(false, false): the material is
 * cache-owned and shared. Fades are mesh-local (mesh.visibility), never via
 * mutating the shared frozen material's alpha. Per-frame observers remove
 * themselves and guard against the mesh being disposed mid-animation
 * (scene teardown).
 */

import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';

/** Shared setup for the flat unlit-emissive look used by all ItemFx meshes. */
function emissiveSetup(colorHex: string): (m: StandardMaterial) => void {
    return m => {
        m.emissiveColor = Color3.FromHexString(colorHex);
        m.diffuseColor = new Color3(0, 0, 0);
        m.specularColor = new Color3(0, 0, 0);
        m.disableLighting = true;
    };
}

/**
 * Spawn a flat expanding ring at (x, z) that grows to `maxRadius` and fades
 * out over `durationS`. Material is cache-owned (bounded key = colorHex),
 * so dispose(false, false).
 * @param colorHex MUST be a lowercase literal from a finite palette — never a
 *   computed/lerped hex (unbounded cache keys are THE recurring freeze bug).
 */
export function spawnExpandingRing(
    scene: Scene, x: number, z: number,
    colorHex: string, maxRadius: number, durationS = 0.45,
): void {
    const ring = MeshBuilder.CreateTorus('itemfx_ring', {
        diameter: 1, thickness: 0.18, tessellation: 32,
    }, scene);
    ring.position.set(x, 0.25, z);
    ring.material = getCachedMaterial(scene, `itemfx_ring_${colorHex}`, emissiveSetup(colorHex));
    ring.isPickable = false;
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        if (ring.isDisposed()) {
            scene.onBeforeRenderObservable.remove(obs);
            return;
        }
        elapsed += scene.getEngine().getDeltaTime() / 1000;
        const f = Math.min(1, elapsed / durationS);
        const d = 0.5 + f * maxRadius * 2; // unit torus — scaling IS the diameter
        ring.scaling.set(d, 1, d);
        ring.visibility = 1 - f;
        if (f >= 1) {
            scene.onBeforeRenderObservable.remove(obs);
            ring.dispose(false, false); // cached/shared material — keep it
        }
    });
}

/**
 * Quick straight trail beam between two points (ricochet visual). Fades out
 * over `durationS`. Cache-owned material — dispose(false, false).
 * @param colorHex MUST be a lowercase literal from a finite palette — never a
 *   computed/lerped hex (unbounded cache keys are THE recurring freeze bug).
 */
export function spawnTrail(
    scene: Scene, fromX: number, fromZ: number, toX: number, toZ: number,
    colorHex: string, durationS = 0.25,
): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const beam = MeshBuilder.CreateBox('itemfx_trail', { width: 0.12, height: 0.12, depth: len }, scene);
    beam.position.set((fromX + toX) / 2, 0.8, (fromZ + toZ) / 2);
    beam.rotation.y = Math.atan2(dx, dz);
    beam.material = getCachedMaterial(scene, `itemfx_trail_${colorHex}`, emissiveSetup(colorHex));
    beam.isPickable = false;
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
        if (beam.isDisposed()) {
            scene.onBeforeRenderObservable.remove(obs);
            return;
        }
        elapsed += scene.getEngine().getDeltaTime() / 1000;
        const f = Math.min(1, elapsed / durationS);
        beam.visibility = 1 - f;
        if (f >= 1) {
            scene.onBeforeRenderObservable.remove(obs);
            beam.dispose(false, false); // cached/shared material — keep it
        }
    });
}

/**
 * Persistent rage glow: ONE lazily-created emissive disc that follows the
 * hero while active. Toggled with setEnabled (no per-toggle allocation);
 * material is cache-owned (fixed key), so dispose(false, false).
 */
export class RageGlow {
    private disc: Mesh | null = null;

    constructor(
        private scene: Scene,
        private getHeroPos: () => Vector3 | null,
    ) {}

    public setActive(on: boolean): void {
        if (on && !this.disc) {
            this.disc = MeshBuilder.CreateDisc('itemfx_rage_disc', { radius: 1.4, tessellation: 24 }, this.scene);
            this.disc.rotation.x = Math.PI / 2;
            this.disc.material = getCachedMaterial(this.scene, 'itemfx_rage', emissiveSetup('#ff2818'));
            this.disc.visibility = 0.45;
            this.disc.isPickable = false;
        }
        if (this.disc) this.disc.setEnabled(on);
    }

    /** Call per frame while active — follows the hero. */
    public update(): void {
        if (!this.disc || !this.disc.isEnabled()) return;
        const p = this.getHeroPos();
        if (p) this.disc.position.set(p.x, 0.15, p.z);
    }

    public dispose(): void {
        this.disc?.dispose(false, false); // cached/shared material — keep it
        this.disc = null;
    }
}
