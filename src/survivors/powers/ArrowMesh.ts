import { Color, Mesh } from 'three';
import type { SceneHost } from '../../engine/three/SceneHost';
import { createBox, createCylinder } from '../../engine/three/primitives';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';

/**
 * Stable cache key for an arrow's shared material, derived from its color.
 * Arrow geometry is identical across every shot, so the material only varies by
 * color — keying by color bounds the cache to the handful of arrow tints in use
 * (fire/frost/seek/pierce/lightning) instead of growing one entry per shot.
 */
export function arrowMaterialKey(color: Color): string {
    return `arrowMat_${color.r.toFixed(2)}_${color.g.toFixed(2)}_${color.b.toFixed(2)}`;
}

/**
 * Builds an arrow mesh: shaft cylinder + tip cone + fletch box,
 * all parented under the shaft. The shaft's rotation.x = PI/2 so
 * "forward" is the +Z axis (matching headingToYaw orientation in the observers).
 *
 * `key` names the (transient, disposed-per-shot) meshes and may be unique per
 * shot. The shared material is keyed by COLOR via the module-level material
 * cache, so repeated shots reuse one material rather than leaking one
 * cache entry per shot.
 */
export function buildArrowMesh(scene: SceneHost, key: string, color: Color): Mesh {
    const shaft = createCylinder(
        `${key}_shaft`,
        { height: 0.6, diameterTop: 0.05, diameterBottom: 0.05, tessellation: 6 },
        scene,
    );
    const tip = createCylinder(
        `${key}_tip`,
        { height: 0.18, diameterTop: 0, diameterBottom: 0.12, tessellation: 6 },
    );
    tip.position.y = 0.39;
    shaft.add(tip);
    const fletch = createBox(
        `${key}_fletch`,
        { width: 0.13, height: 0.13, depth: 0.03 },
    );
    fletch.position.y = -0.30;
    shaft.add(fletch);
    shaft.rotation.order = 'YXZ'; // Babylon Euler order: yaw (set per-frame) then this pitch
    shaft.rotation.x = Math.PI / 2;
    const mat = getCachedMaterial(arrowMaterialKey(color), m => {
        m.emissive.copy(color);
        m.color.set(0, 0, 0);
    });
    shaft.material = mat;
    tip.material = mat;
    fletch.material = mat;
    return shaft;
}
