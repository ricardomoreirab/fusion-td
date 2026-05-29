import { Scene, MeshBuilder, Color3, Mesh } from '@babylonjs/core';
import { getCachedMaterial } from '../../engine/rendering/MaterialCache';

/**
 * Stable cache key for an arrow's shared material, derived from its color.
 * Arrow geometry is identical across every shot, so the material only varies by
 * color — keying by color bounds the cache to the handful of arrow tints in use
 * (fire/frost/seek/pierce/lightning) instead of growing one entry per shot.
 */
export function arrowMaterialKey(color: Color3): string {
    return `arrowMat_${color.r.toFixed(2)}_${color.g.toFixed(2)}_${color.b.toFixed(2)}`;
}

/**
 * Builds an arrow mesh: shaft cylinder + tip cone + fletch box,
 * all parented under the shaft. The shaft's rotation.x = PI/2 so
 * "forward" is the +Z axis (matching atan2 orientation in the observers).
 *
 * `key` names the (transient, disposed-per-shot) meshes and may be unique per
 * shot. The shared material is keyed by COLOR via the module-level material
 * cache, so repeated shots reuse one frozen material rather than leaking one
 * cache entry per shot.
 */
export function buildArrowMesh(scene: Scene, key: string, color: Color3): Mesh {
    const shaft = MeshBuilder.CreateCylinder(
        `${key}_shaft`,
        { height: 0.6, diameterTop: 0.05, diameterBottom: 0.05, tessellation: 6 },
        scene,
    ) as Mesh;
    const tip = MeshBuilder.CreateCylinder(
        `${key}_tip`,
        { height: 0.18, diameterTop: 0, diameterBottom: 0.12, tessellation: 6 },
        scene,
    ) as Mesh;
    tip.position.y = 0.39;
    tip.parent = shaft;
    const fletch = MeshBuilder.CreateBox(
        `${key}_fletch`,
        { width: 0.13, height: 0.13, depth: 0.03 },
        scene,
    ) as Mesh;
    fletch.position.y = -0.30;
    fletch.parent = shaft;
    shaft.rotation.x = Math.PI / 2;
    const mat = getCachedMaterial(scene, arrowMaterialKey(color), m => {
        m.emissiveColor = color;
        m.diffuseColor = new Color3(0, 0, 0);
    });
    shaft.material = mat;
    tip.material = mat;
    fletch.material = mat;
    return shaft;
}
