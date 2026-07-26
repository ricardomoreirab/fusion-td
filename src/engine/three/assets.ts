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

import { AnimationMixer, Group, Material, Mesh, Object3D, SkinnedMesh, Texture, WebGLRenderer } from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
// Imported from meshoptimizer rather than three/examples/jsm/libs, which three
// vendors from this same package: @types/three re-exports that module from a
// `meshoptimizer/decoder` subpath the package does not expose, so the vendored
// copy has no usable types. This also pins the decoder to the exact version
// tools/assets/optimize.mjs encodes with.
import { MeshoptDecoder } from 'meshoptimizer/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimGroup } from './AnimGroup';
import type { SceneHost, UpdateToken } from './SceneHost';

/**
 * Per-instance animation budget tier.
 *   full    - mixer.update every frame (whatever the player is actually reading).
 *   half    - mixer.update at HALF_ANIM_HZ. For a VISIBLE entity far enough away
 *             that a two-frame pose hold is below the threshold of noticing.
 *   reduced - mixer.update at REDUCED_ANIM_HZ, folding the skipped frames into
 *             one larger step so the clip never drifts out of phase.
 *   off     - frozen pose; the elapsed time is still carried so resuming does
 *             not lose the clip's position.
 */
export type AnimationLod = 'full' | 'half' | 'reduced' | 'off';

/** Update rate of the `reduced` tier. Off-screen skeletons are never sampled by
 *  the renderer, so their only visible artefact is the pose they resume on. */
const REDUCED_ANIM_HZ = 10;
const REDUCED_ANIM_STEP = 1 / REDUCED_ANIM_HZ;

/** Update rate of the `half` tier — for entities that ARE drawn, so unlike
 *  `reduced` the held pose is on screen. 30 Hz is a one-frame hold at 60 fps,
 *  which no run cycle reads as a stutter at the distances this tier applies to. */
const HALF_ANIM_HZ = 30;
const HALF_ANIM_STEP = 1 / HALF_ANIM_HZ;

export interface ContainerInstance {
    /** Cloned model root - parent this wherever the entity lives. */
    root: Group;
    animationGroups: AnimGroup[];
    mixer: AnimationMixer;
    /**
     * Throttle this instance's skeleton evaluation. At horde scale mixer.update
     * is the dominant per-entity CPU cost and it runs regardless of visibility -
     * the renderer's frustum culling only skips DRAWING, never posing. Owners
     * that know an entity is off-screen should drop it to 'reduced'; visible but
     * distant entities belong on 'half'.
     */
    setAnimationLod(lod: AnimationLod): void;
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

        let lod: AnimationLod = 'full';
        let carried = 0;
        const tickToken: UpdateToken = host.onAnimUpdate.add(h => {
            carried += h.deltaSeconds;
            if (lod === 'off') return;
            if (lod === 'reduced' && carried < REDUCED_ANIM_STEP) return;
            if (lod === 'half' && carried < HALF_ANIM_STEP) return;
            mixer.update(carried);
            carried = 0;
        });

        let disposed = false;
        return {
            root,
            animationGroups,
            mixer,
            setAnimationLod: (next: AnimationLod) => { lod = next; },
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

/** Never wait longer than this for configureAssetLoaders(). See loadContainer. */
const LOADER_CONFIG_TIMEOUT_MS = 10_000;

// The meshopt decoder is self-contained WASM with no renderer dependency, so it
// can be wired at module scope - EXT_meshopt_compression then works even if
// configureAssetLoaders is never reached.
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

let ktx2Loader: KTX2Loader | null = null;
let markLoadersReady!: () => void;
const loadersReady = new Promise<void>(resolve => { markLoadersReady = resolve; });

/**
 * Attach the KTX2 transcoder. MUST run once after the WebGLRenderer exists and
 * BEFORE the first GLB load: KTX2Loader.detectSupport() asks the live GL context
 * which compressed formats it can transcode into, and without it every KTX2
 * texture throws "No suitable compressed texture format found".
 *
 * No setTranscoderPath() on purpose. Left empty, KTX2Loader resolves the Basis
 * transcoder through `new URL('…/basis_transcoder.wasm', import.meta.url)`,
 * which webpack rewrites into a content-hashed emitted asset. A hand-copied
 * transcoder directory would ship the same 515 KB binary a second time and
 * would break under a non-root publicPath.
 *
 * Safe to call more than once; later calls are ignored.
 */
export function configureAssetLoaders(renderer: WebGLRenderer): void {
    if (ktx2Loader) return;
    try {
        ktx2Loader = new KTX2Loader().detectSupport(renderer);
        loader.setKTX2Loader(ktx2Loader);
    } catch (err) {
        // Degrade rather than throw: a GLB whose textures cannot be transcoded
        // still yields correct geometry, animation and material colours.
        console.warn('[assets] KTX2 transcoder unavailable - compressed textures will fail to decode.', err);
    }
    markLoadersReady();
}

const containerCache = new Map<string, Promise<GlbContainer>>();

/** Load (once) and cache a GLB container by URL. */
export function loadContainer(url: string): Promise<GlbContainer> {
    let pending = containerCache.get(url);
    if (!pending) {
        // Runtime GLBs carry KHR_texture_basisu, so a load started before
        // configureAssetLoaders() would fail on every texture. Wait for it -
        // but bounded, so a boot path that never configures surfaces a normal
        // load error instead of a permanently pending loading screen.
        pending = Promise.race([
            loadersReady,
            new Promise<void>(resolve => setTimeout(resolve, LOADER_CONFIG_TIMEOUT_MS)),
        ])
            .then(() => loader.loadAsync(url))
            .then(gltf => new GlbContainer(gltf));
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
