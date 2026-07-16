/**
 * ItemFx — leak-safe transient visuals for item effects (procs, ricochets,
 * rage aura).
 *
 * Material rules (project invariant): every material here goes through
 * getCachedMaterial with a BOUNDED key (color hex / fixed name — finitely
 * many). Fades are mesh-local via setMeshOpacity (clone-on-write; the shared
 * cached material is never mutated), and disposeMesh frees the owned fade
 * clone while skipping cache-owned resources. Per-frame callbacks remove
 * themselves and guard against the mesh being disposed mid-animation
 * (scene teardown).
 */

import { Color, Mesh, MeshPhongMaterial, Vector3 } from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import { createBox, createDisc, createTorus, disposeMesh, isMeshDisposed } from '../../engine/three/primitives';
import { headingToYaw } from '../../engine/three/math';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';
import { setMeshOpacity } from '../../engine/rendering/LowPolyMaterial';

/** Shared setup for the flat unlit-emissive look used by all ItemFx meshes. */
function emissiveSetup(colorHex: string): (m: MeshPhongMaterial) => void {
    return m => {
        m.emissive.copy(new Color(colorHex));
        m.color.set(0, 0, 0);
        m.specular.set(0, 0, 0);
    };
}

/**
 * Spawn a flat expanding ring at (x, z) that grows to `maxRadius` and fades
 * out over `durationS`. Material is cache-owned (bounded key = colorHex);
 * the fade clones it into a mesh-owned copy that disposeMesh frees.
 * @param colorHex MUST be a lowercase literal from a finite palette — never a
 *   computed/lerped hex (unbounded cache keys are THE recurring freeze bug).
 */
export function spawnExpandingRing(
    scene: SceneHost, x: number, z: number,
    colorHex: string, maxRadius: number, durationS = 0.45,
): void {
    const ring = createTorus('itemfx_ring', {
        diameter: 1, thickness: 0.18, tessellation: 32,
    }, scene);
    ring.position.set(x, 0.25, z);
    ring.material = getCachedMaterial(`itemfx_ring_${colorHex}`, emissiveSetup(colorHex));
    let elapsed = 0;
    const token = scene.onBeforeRender.add(() => {
        if (isMeshDisposed(ring)) {
            scene.onBeforeRender.remove(token);
            return;
        }
        elapsed += scene.deltaSeconds;
        const f = Math.min(1, elapsed / durationS);
        const d = 0.5 + f * maxRadius * 2; // unit torus — scaling IS the diameter
        ring.scale.set(d, 1, d);
        setMeshOpacity(ring, 1 - f);
        if (f >= 1) {
            scene.onBeforeRender.remove(token);
            disposeMesh(ring); // cached/shared material — kept; owned fade clone freed
        }
    });
}

/**
 * Quick straight trail beam between two points (ricochet visual). Fades out
 * over `durationS`. Cache-owned material — disposeMesh keeps it.
 * @param colorHex MUST be a lowercase literal from a finite palette — never a
 *   computed/lerped hex (unbounded cache keys are THE recurring freeze bug).
 */
export function spawnTrail(
    scene: SceneHost, fromX: number, fromZ: number, toX: number, toZ: number,
    colorHex: string, durationS = 0.25,
): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return;
    const beam = createBox('itemfx_trail', { width: 0.12, height: 0.12, depth: len }, scene);
    beam.position.set((fromX + toX) / 2, 0.8, (fromZ + toZ) / 2);
    beam.rotation.y = headingToYaw(dx, dz);
    beam.material = getCachedMaterial(`itemfx_trail_${colorHex}`, emissiveSetup(colorHex));
    let elapsed = 0;
    const token = scene.onBeforeRender.add(() => {
        if (isMeshDisposed(beam)) {
            scene.onBeforeRender.remove(token);
            return;
        }
        elapsed += scene.deltaSeconds;
        const f = Math.min(1, elapsed / durationS);
        setMeshOpacity(beam, 1 - f);
        if (f >= 1) {
            scene.onBeforeRender.remove(token);
            disposeMesh(beam); // cached/shared material — kept; owned fade clone freed
        }
    });
}

/**
 * Persistent rage glow: ONE lazily-created emissive disc that follows the
 * hero while active. Toggled with `visible` (no per-toggle allocation);
 * material is cache-owned (fixed key), so disposeMesh keeps it.
 */
export class RageGlow {
    private disc: Mesh | null = null;

    constructor(
        private scene: SceneHost,
        private getHeroPos: () => Vector3 | null,
    ) {}

    public setActive(on: boolean): void {
        if (on && !this.disc) {
            this.disc = createDisc('itemfx_rage_disc', { radius: 1.4, tessellation: 24 }, this.scene);
            this.disc.rotation.x = -Math.PI / 2; // face up (+Y); sign flips with the RH handedness
            this.disc.material = getCachedMaterial('itemfx_rage', emissiveSetup('#ff2818'));
            setMeshOpacity(this.disc, 0.45);
        }
        if (this.disc) this.disc.visible = on;
    }

    /** Call per frame while active — follows the hero. */
    public update(): void {
        if (!this.disc || !this.disc.visible) return;
        const p = this.getHeroPos();
        if (p) this.disc.position.set(p.x, 0.15, p.z);
    }

    public dispose(): void {
        if (this.disc) disposeMesh(this.disc); // cached material kept; owned fade clone freed
        this.disc = null;
    }
}
