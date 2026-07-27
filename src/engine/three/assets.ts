/**
 * assets.ts - GLB loading + per-instance cloning, replacing Babylon's
 * LoadAssetContainerAsync + AssetContainer.instantiateModelsToScene.
 *
 * Containers are cached module-level by URL (same lifetime as the old
 * `_glbAssets` cache in SurvivorsGameplayState). instantiate() gives each
 * caller an independent skinned clone via SkeletonUtils.clone plus its own
 * AnimationMixer and one AnimGroup per clip.
 *
 * Materials are SHARED with the container by default and cloned only on demand
 * (ensureOwnMaterials) - see the comment on that method for why the default
 * matters at horde scale.
 *
 * Disposal invariants (see glb_skeleton_and_lifecycle_leaks):
 *   - instance dispose: materials this instance CLONED are disposed (clones
 *     share the source textures - those are container-owned and must NOT be
 *     freed per instance), every SkinnedMesh's skeleton is disposed (frees the
 *     per-clone bone matrix texture), the mixer is fully uncached, and the
 *     mixer's update hook leaves the SceneHost animation bus. An instance that
 *     never took ownership has nothing of its own to free.
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
import { installFlatSkeletonUpdate } from './flatSkeletonMatrices';
import { hideBoneSubtrees } from './hideBoneSubtrees';
import { pruneStaticTracks } from './pruneStaticTracks';
import type { SceneHost, UpdateToken } from './SceneHost';

/**
 * Per-instance animation budget tier.
 *   full    - mixer.update every frame (whatever the player is actually reading).
 *   half    - mixer.update at HALF_ANIM_HZ. For a VISIBLE entity far enough away
 *             that a two-frame pose hold is below the threshold of noticing.
 *   reduced - mixer.update at REDUCED_ANIM_HZ, folding the skipped frames into
 *             one larger step so the clip never drifts out of phase.
 *   off     - frozen pose; the elapsed time is still carried, and the FIRST
 *             update after resuming advances the mixer by the whole frozen
 *             interval. Clip time is therefore linear in wall time no matter how
 *             long the freeze lasted, so the resumed pose is exactly the one a
 *             never-frozen mixer would be holding. For an entity that is not in
 *             the scene graph at all this is strictly free.
 */
export type AnimationLod = 'full' | 'half' | 'reduced' | 'off';

/** Update rate of the `reduced` tier - for an entity that is still IN the scene
 *  graph but whose pose the player cannot resolve. An entity the owner has
 *  detached belongs on `off` instead: throttling costs a tenth of the posing to
 *  produce a pose nothing can read. */
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
     * the renderer's frustum culling only skips DRAWING, never posing. An owner
     * that has taken the instance OUT of the scene graph should drop it to 'off'
     * (nothing can read the pose, and resuming replays the frozen interval);
     * visible but distant entities belong on 'half'.
     *
     * Resuming is only seamless because the owner un-parks BEFORE the animation
     * bus runs for that frame - Game.frameTick is state update, then
     * SceneHost.tick - so the catch-up lands on the same frame the entity is
     * drawn again.
     */
    setAnimationLod(lod: AnimationLod): void;
    /**
     * Discard time banked by a throttled/frozen tier without applying it.
     *
     * The tiers are time-preserving by design: whatever they skip is replayed on
     * the next update, so a resumed clip is exactly where a full-rate one would
     * be. That is right for the looping clips an entity holds indefinitely and
     * wrong for a ONE-SHOT clip the owner is starting right now - replaying a
     * long freeze would run it to its clamped end on the frame it began. Call
     * this immediately before starting such a clip.
     */
    resetAnimationClock(): void;
    /**
     * Replace this instance's materials with private clones.
     *
     * Instances SHARE the container's materials by default, because at horde
     * scale the material IDENTITY is one of the largest costs in the frame:
     * three's renderer re-uploads a draw's whole uniform list whenever
     * `material.id` differs from the previous draw, so 250 clones mean 250 full
     * uniform refreshes per frame instead of one. (It also unblocks the depth
     * sort — the opaque list orders by `renderOrder`, then `material.id`, and
     * only then by depth, so distinct ids mean the horde draws in spawn order.
     * That part turns out to be worth nothing on a tile-based deferred GPU,
     * which resolves visibility before shading; the uniform refresh is the win.)
     *
     * Measured at ~260 enemies by flipping the variant on EVERY frame and
     * bucketing that frame's wall clock by variant, then repeating with the
     * parity inverted: 8.99 -> 8.01 ms/frame, -10.8%, reproduced in two
     * sessions. Block-level A/B cannot see this — see CLAUDE.md.
     *
     * Call this from any owner that MUTATES its materials (the hero tints its
     * weapon emissive and injects a rim-light `onBeforeCompile`). Idempotent.
     * Enemies deliberately do not: their only material mutation is the hit
     * flash, which swaps to a shared flash variant instead (see Enemy.flashHit).
     */
    ensureOwnMaterials(): void;
    dispose(): void;
}

/** Flag a container's source materials as container-owned and shared by every
 *  instance. `cached` is the project-wide "only its owner may dispose this"
 *  marker that disposeMesh honours; `glbShared` additionally tells per-instance
 *  visual effects that mutating this material in place would bleed across the
 *  whole horde. */
function markSharedMaterials(scene: Object3D): void {
    scene.traverse(node => {
        const mesh = node as Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
            mat.userData.cached = true;
            mat.userData.glbShared = true;
        }
    });
}

/** Clone a shared source material into one this instance owns outright. The
 *  shared markers must not survive the clone - a private copy is exactly the
 *  thing effects are allowed to mutate, and its owner disposes it. */
function cloneOwned(source: Material, out: Material[]): Material {
    const clone = source.clone(); // shares the source textures
    delete clone.userData.cached;
    delete clone.userData.glbShared;
    out.push(clone);
    return clone;
}

export class GlbContainer {
    constructor(public readonly gltf: GLTF) {
        // Once per loaded URL (containers are cached), before any instance can
        // exist: the exported rigs carry a constant-at-bind `.scale` track for
        // every bone and a constant `.position` track for most, and every one of
        // them costs an interpolant + a property-mixer write per instance per
        // frame. See pruneStaticTracks for why removal is provably inert.
        pruneStaticTracks(this.gltf.scene, this.gltf.animations);
        markSharedMaterials(this.gltf.scene);
        // Bones are 83-95% of a rig's nodes and the renderer walks every one of
        // them - once building the render list, again per shadow update - to
        // find nothing drawable. Hiding the skeleton root prunes the subtree
        // from both walks while leaving the world-matrix pass (which skinning
        // reads) untouched. Set on the CONTAINER so every clone inherits it:
        // Object3D.copy carries `visible` across, and SkeletonUtils.clone's own
        // traversals ignore it.
        hideBoneSubtrees(this.gltf.scene);
    }

    public instantiate(host: SceneHost, namePrefix = ''): ContainerInstance {
        const root = cloneSkinned(this.gltf.scene) as Group;
        // Prefix ONLY the root. THREE resolves animation tracks by node NAME
        // (PropertyBinding walks the mixer root's subtree with getObjectByName),
        // so renaming descendants — the bones — silently unbinds every clip and
        // the model T-poses. The root Group itself is never a track target.
        if (namePrefix) root.name = `${namePrefix}${root.name}`;

        // Bones are ~83% of the scene graph and the one full-graph walk they
        // cannot be pruned from is the world-matrix pass skinning reads. Swap
        // THREE's recursion over this clone's skeleton for the equivalent flat
        // loop (bit-identical output, ~40% of the pass). Per INSTANCE, not per
        // container: Object3D.copy carries data fields across a clone but not
        // own methods.
        installFlatSkeletonUpdate(root);

        // Materials stay shared with the container until an owner asks for its
        // own — see ensureOwnMaterials for what that default is worth.
        const clonedMaterials: Material[] = [];
        let ownsMaterials = false;
        const ensureOwnMaterials = (): void => {
            if (ownsMaterials) return;
            ownsMaterials = true;
            root.traverse(node => {
                const mesh = node as Mesh;
                if (!mesh.isMesh || !mesh.material) return;
                mesh.material = Array.isArray(mesh.material)
                    ? mesh.material.map(m => cloneOwned(m, clonedMaterials))
                    : cloneOwned(mesh.material, clonedMaterials);
            });
        };

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
            resetAnimationClock: () => { carried = 0; },
            ensureOwnMaterials,
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
 * A 4x4 ETC1S KTX2, 369 bytes, produced by `ktx create --encode basis-lz`.
 *
 * Transcoding this is the only way to drive KTX2Loader's cold path to
 * completion from outside: `init()` alone stops at "wasm fetched, worker
 * factory registered" — the Worker itself, the 515 KB transcoder binary copy
 * into it, and `initializeBasis()` all wait for the first transcode job.
 * See prewarmTranscoder.
 */
const TRANSCODER_PROBE_KTX2 =
    'q0tUWCAyMLsNChoKAAAAAAEAAAAEAAAABAAAAAAAAAAAAAAAAQAAAAEAAAABAAAAaAAAACwAAACUAAAA' +
    'XAAAAPAAAAAAAAAAgAAAAAAAAABwAQAAAAAAAAEAAAAAAAAAAAAAAAAAAAAsAAAAAAAAAAIAKACjAQIA' +
    'AwMAAAgAAAAAAAAAAAA/AAAAAAAAAAAA/////ywAAABLVFh3cml0ZXIAa3R4IGNyZWF0ZSB2NC40LjIg' +
    'LyBsaWJrdHggdjQuNC4yACgAAABLVFh3cml0ZXJTY1BhcmFtcwAtLWNsZXZlbCAwIC0tcWxldmVsIDEA' +
    'AQABACgAAAAFAAAAKwAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAHABAAAAAAAAAIEmAgAAAAAAEBS' +
    'BAATAAAAAAAACAFgAkAAAAAAADFUVVVVBQDBRAAAAAAAAPJfLQCYAAAAAAAAQAgAEwACAAAAAIgBwAQA' +
    'AAAAAAACCAAA';

/**
 * Drag the Basis transcoder through its entire cold path while the player is
 * still on the menu, instead of paying for it inside the first GLB load.
 *
 * Lazily, that cold path is: fetch basis_transcoder.js + the 515 KB .wasm,
 * concatenate them into a ~600 KB worker source string, `createObjectURL` it,
 * spawn the Worker, copy the wasm binary into it and compile+`initializeBasis()`
 * it — all serialized ahead of the first texture the game actually wants.
 *
 * Fire-and-forget and silent by contract. Every failure mode (no transcodable
 * format on this GPU, blocked Worker construction, a 404 on the wasm) leaves
 * the lazy path exactly as it was, so a broken prewarm can only cost the boot
 * two wasted requests — never a boot failure.
 */
function prewarmTranscoder(ktx2: KTX2Loader): void {
    try {
        const b64 = atob(TRANSCODER_PROBE_KTX2);
        const probe = new Uint8Array(b64.length);
        for (let i = 0; i < b64.length; i++) probe[i] = b64.charCodeAt(i);
        // parse() transfers the buffer and reports through callbacks rather than
        // a promise, so onError is mandatory — without it the internal .catch()
        // is `catch(undefined)` and any failure surfaces as an unhandled rejection.
        ktx2.parse(probe.buffer, texture => texture.dispose(), () => { /* silent */ });
    } catch {
        /* silent — the lazy path is the fallback */
    }
}

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
        prewarmTranscoder(ktx2Loader);
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
