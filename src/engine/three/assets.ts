/**
 * assets.ts - GLB loading + per-instance cloning, replacing Babylon's
 * LoadAssetContainerAsync + AssetContainer.instantiateModelsToScene.
 *
 * Containers are cached module-level by URL (same lifetime as the old
 * `_glbAssets` cache in SurvivorsGameplayState). instantiate() gives each
 * caller an independent skinned clone via SkeletonUtils.clone plus its own
 * AnimationMixer and one AnimGroup per clip.
 *
 * Disposal invariants (see glb_skeleton_and_lifecycle_leaks):
 *   - instance dispose: cloned MATERIALS are disposed (clones share the
 *     source textures - those are container-owned and must NOT be freed
 *     per instance), every SkinnedMesh's skeleton is disposed (frees the
 *     per-clone bone matrix texture), the mixer is fully uncached, and the
 *     mixer's update hook leaves the SceneHost animation bus.
 *   - clearContainerCache(): frees source geometries, materials, and
 *     textures. Call only when no instances are alive.
 */

import { AnimationMixer, Group, Material, Mesh, Object3D, SkinnedMesh, Texture } from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimGroup } from './AnimGroup';
import type { SceneHost, UpdateToken } from './SceneHost';

export interface ContainerInstance {
    /** Cloned model root - parent this wherever the entity lives. */
    root: Group;
    animationGroups: AnimGroup[];
    mixer: AnimationMixer;
    dispose(): void;
}

export class GlbContainer {
    constructor(public readonly gltf: GLTF) {}

    public instantiate(host: SceneHost, namePrefix = ''): ContainerInstance {
        const root = cloneSkinned(this.gltf.scene) as Group;
        // Prefix ONLY the root. THREE resolves animation tracks by node NAME
        // (PropertyBinding walks the mixer root's subtree with getObjectByName),
        // so renaming descendants — the bones — silently unbinds every clip and
        // the model T-poses. The root Group itself is never a track target.
        if (namePrefix) root.name = `${namePrefix}${root.name}`;

        // Per-instance material clones so tint/flash effects never bleed
        // across instances (Babylon's cloneMaterials: true). Clones share
        // the source textures.
        const clonedMaterials: Material[] = [];
        root.traverse(node => {
            const mesh = node as Mesh;
            if (!mesh.isMesh || !mesh.material) return;
            if (Array.isArray(mesh.material)) {
                mesh.material = mesh.material.map(m => {
                    const c = m.clone();
                    clonedMaterials.push(c);
                    return c;
                });
            } else {
                const c = mesh.material.clone();
                clonedMaterials.push(c);
                mesh.material = c;
            }
        });

        const mixer = new AnimationMixer(root);
        const animationGroups = this.gltf.animations.map(clip => new AnimGroup(mixer, clip));
        const tickToken: UpdateToken = host.onAnimUpdate.add(h => mixer.update(h.deltaSeconds));

        let disposed = false;
        return {
            root,
            animationGroups,
            mixer,
            dispose: () => {
                if (disposed) return;
                disposed = true;
                host.onAnimUpdate.remove(tickToken);
                for (const group of animationGroups) group.dispose();
                mixer.stopAllAction();
                mixer.uncacheRoot(root);
                root.removeFromParent();
                root.traverse(node => {
                    const skinned = node as SkinnedMesh;
                    if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
                });
                for (const mat of clonedMaterials) mat.dispose();
            },
        };
    }
}

const loader = new GLTFLoader();
const containerCache = new Map<string, Promise<GlbContainer>>();

/** Load (once) and cache a GLB container by URL. */
export function loadContainer(url: string): Promise<GlbContainer> {
    let pending = containerCache.get(url);
    if (!pending) {
        pending = loader.loadAsync(url).then(gltf => new GlbContainer(gltf));
        pending.catch(() => containerCache.delete(url)); // allow retry after a failed load
        containerCache.set(url, pending);
    }
    return pending;
}

export function getContainerCacheSize(): number {
    return containerCache.size;
}

/** Free all cached source assets. Only call with zero live instances. */
export async function clearContainerCache(): Promise<void> {
    const pending = [...containerCache.values()];
    containerCache.clear();
    for (const p of pending) {
        let container: GlbContainer;
        try {
            container = await p;
        } catch {
            continue;
        }
        container.gltf.scene.traverse(node => {
            const mesh = node as Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
                for (const value of Object.values(mat)) {
                    if (value && typeof value === 'object' && (value as Texture).isTexture) {
                        (value as Texture).dispose();
                    }
                }
                mat.dispose();
            }
        });
    }
}

/** Babylon getHierarchyBoundingVectors stand-in lives at call sites via Box3.setFromObject. */
export type { Object3D };
