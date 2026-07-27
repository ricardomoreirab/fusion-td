/**
 * ParticleEffect - thin SceneHost-aware wrapper around
 * @newkrok/three-particles' createParticleSystem, replacing the old
 * hand-rolled ParticleSystem class.
 *
 * The library drives its own simulation off a caller-supplied millisecond
 * clock (externalNow at creation, then `now` on every update() call - NOT
 * Date.now()). Each ParticleEffect owns a synthetic clock seeded at
 * creation and advanced by tick(dt) so headless SceneHost.tick(dt) drives
 * it deterministically, exactly like the rest of the engine/three layer.
 */

import { AdditiveBlending, DataTexture, type Material, NormalBlending, type Object3D, RGBAFormat, type ShaderMaterial, Texture, Vector3 } from 'three';
import {
    createParticleSystem,
    type ParticleSystemConfig,
    type ParticleSystem as LibParticleSystem,
    type Renderer as LibRenderer,
} from '@newkrok/three-particles';
import type { SceneHost, SceneParticleSystem } from '../SceneHost';
import type { PooledBurstRecipe } from './BurstPool';

/**
 * Converts a world-unit particle size to the library's point-size scale.
 * The lib shader computes gl_PointSize = size * 100 / distance; the game
 * camera (fov 0.55 rad, ~1080p) needs ~x19 to reproduce the former
 * world-unit sizing used by the old ParticleSystem class.
 */
export function fxSize(worldUnits: number): number {
    return worldUnits * 19;
}

/** Full Renderer config for either blend mode; all 7 base fields are required by the lib's type. */
export function fxRenderer(blending: 'additive' | 'normal'): LibRenderer {
    return {
        blending: blending === 'additive' ? AdditiveBlending : NormalBlending,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        discardBackgroundColor: false,
        backgroundColorTolerance: 1,
        backgroundColor: { r: 0, g: 0, b: 0 },
    };
}

let softParticleTexture: Texture | null = null;

/** Shared soft-circle sprite texture (cached, never disposed). Headless-safe: no document -> 1x1 DataTexture. */
export function getSoftParticleTexture(): Texture {
    if (softParticleTexture) return softParticleTexture;

    if (typeof document === 'undefined') {
        const data = new Uint8Array([255, 255, 255, 255]);
        const tex = new DataTexture(data, 1, 1, RGBAFormat);
        tex.needsUpdate = true;
        softParticleTexture = tex;
        return softParticleTexture;
    }

    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        const data = new Uint8Array([255, 255, 255, 255]);
        const tex = new DataTexture(data, 1, 1, RGBAFormat);
        tex.needsUpdate = true;
        softParticleTexture = tex;
        return softParticleTexture;
    }
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const tex = new Texture(canvas);
    tex.needsUpdate = true;
    softParticleTexture = tex;
    return softParticleTexture;
}

/**
 * One material per RECIPE, shared by every live effect built from it.
 *
 * @newkrok/three-particles builds a fresh ShaderMaterial per system, so at
 * endgame scale (a maxed 4-fusion loadout against ~250 enemies spawns ~780
 * one-shot bursts per SECOND and keeps ~500 alive) the frame draws ~500
 * particle systems through ~500 DISTINCT material ids. Every one of them is a
 * material THREE has never seen: `setProgram` finds no cached program record,
 * so it runs `getParameters` + builds the (long) program cache key + linearly
 * scans the program list, and every draw re-uploads the whole uniform list
 * because `material.id` never repeats. Sharing collapses that to one material
 * per recipe. Measured live at ~250 enemies with 4 maxed fusions, A/B/A/B over
 * 20s windows: render phase 9.727 / 9.806 ms per frame with private materials
 * vs 9.368 / 9.375 shared - a 0.40 ms (4.0%) cut with non-overlapping groups,
 * and 1021-1034 frames per window vs 1053.
 *
 * This is only legal because a particle system's per-instance state lives
 * ENTIRELY in its geometry attributes (size, color, lifetime, startLifetime,
 * rotation, startFrame). The uniforms are recipe constants - map, tiles, fps,
 * useFPSForFrameIndex, backgroundColor + tolerance + discard flag, the soft-
 * particle trio, cameraNearFar - plus `elapsed`, which all four shipped
 * shaders DECLARE and none READS (asserted in tests/particleSharedMaterial.spec.ts,
 * so a library upgrade that starts reading it fails loudly rather than
 * silently animating every effect off one system's clock).
 *
 * Keys must be BOUNDED (recipe names - finitely many; never instance ids or
 * random values), same contract as MaterialCache.getCachedMaterial. A key that
 * is ever reused for a DIFFERENT recipe is not a correctness hazard: the
 * candidate is compared field by field against the cached one and simply keeps
 * its private material when they differ.
 */
const sharedMaterials = new Map<string, Material>();

/** Shallow own-property equality with a matching prototype - enough for the
 *  numbers, booleans, Vector2/Color and (identity-compared) Textures a particle
 *  material's uniforms hold. Anything nested must be the SAME object to match,
 *  which is the conservative answer. */
function sameUniformValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const k of keys) {
        if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
    }
    return true;
}

/** True when `candidate` would render identically through `cached`. */
export function particleMaterialsInterchangeable(cached: Material, candidate: Material): boolean {
    if (cached === candidate) return true;
    if (cached.type !== candidate.type) return false;
    if (cached.blending !== candidate.blending) return false;
    if (cached.transparent !== candidate.transparent) return false;
    if (cached.depthTest !== candidate.depthTest) return false;
    if (cached.depthWrite !== candidate.depthWrite) return false;
    if (cached.side !== candidate.side) return false;

    const a = cached as ShaderMaterial;
    const b = candidate as ShaderMaterial;
    if (a.vertexShader !== b.vertexShader) return false;
    if (a.fragmentShader !== b.fragmentShader) return false;
    if (!a.uniforms || !b.uniforms) return false;
    const names = Object.keys(a.uniforms);
    if (names.length !== Object.keys(b.uniforms).length) return false;
    for (const name of names) {
        const cachedUniform = a.uniforms[name];
        const candidateUniform = b.uniforms[name];
        if (!candidateUniform) return false;
        if (!sameUniformValue(cachedUniform.value, candidateUniform.value)) return false;
    }
    return true;
}

/**
 * The cache entry for a recipe: a clone of the first system's material, with
 * every TEXTURE uniform pointed back at the original.
 *
 * three's `cloneUniforms` deep-clones texture values, and a per-recipe COPY of
 * the one shared soft-particle sprite would be both a second GPU upload per
 * recipe AND fatal to the whole optimisation - the copy carries a fresh uuid,
 * so `particleMaterialsInterchangeable` would reject every later effect and
 * nothing would ever share.
 */
function cloneRecipeMaterial(own: Material): Material {
    const shared = own.clone();
    const src = (own as ShaderMaterial).uniforms;
    const dst = (shared as ShaderMaterial).uniforms;
    if (src && dst) {
        for (const name of Object.keys(src)) {
            const original = src[name]?.value as (Texture | undefined);
            if (!original || !(original as { isTexture?: boolean }).isTexture || !dst[name]) continue;
            const copy = dst[name].value as Texture | null;
            // Only ever free a copy THIS function is discarding — a three version
            // that stops cloning textures would hand back the original here, and
            // disposing that would kill the sprite every effect draws with.
            if (copy && copy !== original) copy.dispose();
            dst[name].value = original;
        }
    }
    return shared;
}

/** Frees the per-recipe materials. Run teardown only - siblings of
 *  clearMaterialCache()/clearProjectilePools(). */
export function clearParticleMaterialCache(): void {
    for (const material of sharedMaterials.values()) material.dispose();
    sharedMaterials.clear();
}

/** Live recipe count - lets specs assert the cache stays bounded. */
export function particleMaterialCacheSize(): number {
    return sharedMaterials.size;
}

/** Marks the `onComplete` hook ParticleEffect installs, so a later effect built
 *  from the same (memoised) config recovers the caller's original callback
 *  instead of wrapping the wrapper. */
const USER_ON_COMPLETE = Symbol('particleEffect.userOnComplete');
type WrappedOnComplete = (() => void) & { [USER_ON_COMPLETE]?: (() => void) | undefined };

export interface ParticleEffectOptions {
    /** Parent object the instance is added under. Defaults to the scene root. */
    parent?: Object3D;
    /**
     * Track this object's WORLD POSITION each tick without parenting (old
     * `ps.emitter = mesh` semantics). Use instead of `parent` for emitters
     * inside scaled/rotated hierarchies (GLB rigs, elite-scaled enemies) -
     * the lib multiplies emission offsets by the emitter's world scale, so
     * parenting there inflates the whole effect.
     */
    follow?: Object3D;
    /** Dispose automatically once a non-looping system completes its iteration. */
    autoDispose?: boolean;
    /** Create with the emitter paused; call start() to resume. */
    startPaused?: boolean;
    /**
     * Draw through the shared material cached under this RECIPE key instead of
     * the private one the library just built (see `sharedMaterials`). Worth it
     * for anything spawned per hit / per kill / per status; pointless for a
     * singleton like the ambient motes. The key must be bounded - a call-site
     * literal, or an enum-derived name - never an instance id.
     */
    sharedMaterial?: string;
    /**
     * Build this effect as a POOL MEMBER of the given recipe (BurstPool owns
     * these; nothing else should pass it). It is born retired - paused, out of
     * the scene and off the tick registry - and only `arm()` puts it on screen.
     */
    burst?: PooledBurstRecipe;
}

export class ParticleEffect implements SceneParticleSystem {
    /** The library's THREE.Points/Mesh instance - exposed for positioning and scene queries. */
    public readonly object: Object3D;

    /** Optional teardown hook (parity with the old ParticleSystem.onDispose). */
    public onDispose: (() => void) | null = null;

    /** Pool members only: fired once the armed burst's last particle is gone, so
     *  BurstPool can put the effect back on its free list. */
    public onBurstFinished: ((effect: ParticleEffect) => void) | null = null;

    private readonly host: SceneHost;
    private readonly handle: LibParticleSystem;
    private readonly autoDispose: boolean;
    private readonly follow: Object3D | null;
    private readonly followOffset: Vector3 | null;

    /** The library's `creationTime` for this system: `createParticleSystem` is
     *  handed exactly this value and `startDelay` is 0 on every recipe, so
     *  `lifetime === nowMs - CREATION_NOW_MS` for the whole life of the object.
     *  arm() computes iteration boundaries off it. */
    private static readonly CREATION_NOW_MS = 1;

    private nowMs = ParticleEffect.CREATION_NOW_MS;
    private elapsed = 0;
    private completed = false;
    private disposed = false;

    private readonly burst: PooledBurstRecipe | null;
    /** Which library iteration this pool member is currently living in. Bumped
     *  by every arm(), which is what re-arms the burst states. */
    private burstIteration = 0;
    private burstFiredAtMs = 0;
    private armed = false;
    /** The library-built material this instance is NOT drawing through, held so
     *  dispose() can hand it back before the library frees it. Null when the
     *  instance kept its own. */
    private ownMaterial: Material | null = null;
    /** Reused argument for handle.update() — see tick(). */
    private readonly _updateArg = { now: 1, delta: 0, elapsed: 0 };

    constructor(
        public readonly name: string,
        host: SceneHost,
        config: ParticleSystemConfig,
        opts: ParticleEffectOptions = {}
    ) {
        this.host = host;
        this.autoDispose = opts.autoDispose ?? false;

        config.map ??= getSoftParticleTexture();
        // Recipe configs are MEMOISED per call site (see ElementParticles), so
        // this hook is installed on the SAME object once per effect. Unwrap a
        // previous installation instead of chaining onto it: the naive
        // `const user = config.onComplete` version nests one closure per spawn
        // and blows the stack after a few thousand of them. The library copies
        // whatever is here into the system's own config during construction, so
        // each effect keeps the wrapper that closes over IT.
        const previous = config.onComplete as WrappedOnComplete | undefined;
        const userOnComplete = previous && USER_ON_COMPLETE in previous
            ? previous[USER_ON_COMPLETE]
            : previous;
        const wrapper: WrappedOnComplete = () => {
            if (this.autoDispose) this.completed = true;
            userOnComplete?.();
        };
        wrapper[USER_ON_COMPLETE] = userOnComplete;
        config.onComplete = wrapper;

        this.handle = createParticleSystem(config, this.nowMs);
        this.object = this.handle.instance;
        this.object.name = name;
        if (opts.sharedMaterial) this._adoptSharedMaterial(opts.sharedMaterial);
        this.follow = opts.follow ?? null;
        this.followOffset = this.follow ? this.object.position.clone() : null;
        this.burst = opts.burst ?? null;

        if (this.burst) {
            // A pool member is born retired: nothing draws it and nothing ticks
            // it until arm() hands it to the scene.
            this.handle.pauseEmitter();
            return;
        }

        (opts.parent ?? host.scene).add(this.object);
        if (this.follow) this.syncFollow();
        host.registerParticleSystem(this);

        if (opts.startPaused) this.handle.pauseEmitter();
    }

    /**
     * POOL ONLY. Re-arm this effect at `position` and put it back on screen.
     *
     * Both library steps run while the object is DETACHED, which is not an
     * optimisation but a requirement: the library calls
     * `particleSystem.parent.updateMatrixWorld()` for every WORLD-space system,
     * and SceneHost only suppresses the scene's full-graph walk from inside its
     * own particle loop. arm() is called from gameplay code, so a parented
     * update here would walk the whole scene graph twice PER SPAWN. With no
     * parent the library falls through to `sourceWorldMatrix.copy(matrix)`,
     * which is the same matrix a scene-root child would have produced.
     */
    public arm(position: Vector3): void {
        const recipe = this.burst;
        if (this.disposed || !recipe) return;

        this.object.position.copy(position);
        this.handle.resumeEmitter();
        this.burstIteration++;

        // Step 1 - the start of a fresh iteration. Every burst time sits at
        // `leadMs > 0`, so this resets all of them and emits nothing.
        this.nowMs = ParticleEffect.CREATION_NOW_MS + this.burstIteration * recipe.periodMs;
        this._pump();
        // Step 2 - the lead. The time-0 wave fires inside this call, so the
        // effect is fully live on the frame it was asked for.
        this.nowMs += recipe.leadMs;
        this._pump();

        // A WORLD-space system's particle positions ARE its geometry, and THREE
        // computes a geometry's bounding sphere once and caches it forever. A
        // fresh system therefore gets a sphere around its own burst; a RECYCLED
        // one would keep the sphere of the burst before it and be frustum-culled
        // the moment the two are far apart. Dropping it here is what makes the
        // second use of a pooled effect render at all - and it costs one
        // recompute over `maxParticles` per spawn, not per frame.
        const geometry = (this.object as Object3D & { geometry?: { boundingSphere: unknown } }).geometry;
        if (geometry) geometry.boundingSphere = null;

        this.burstFiredAtMs = this.nowMs;
        this.armed = true;
        this.host.scene.add(this.object);
        this.host.registerParticleSystem(this);
    }

    /** POOL ONLY. Takes the effect off screen and off the tick registry without
     *  disposing it. Idempotent. */
    public retire(): void {
        if (this.disposed) return;
        this.armed = false;
        this.handle.pauseEmitter();
        this.object.removeFromParent();
        this.host.unregisterParticleSystem(this);
    }

    /** Drives the library at the current clock with no elapsed time - used by
     *  arm() to step across an iteration boundary without ageing anything. */
    private _pump(): void {
        this._updateArg.now = this.nowMs;
        this._updateArg.delta = 0;
        this._updateArg.elapsed = this.elapsed;
        this.handle.update(this._updateArg);
    }

    /**
     * Swap the freshly built private material for the one cached under `key`.
     *
     * The cache entry is a CLONE, never the first system's own material: the
     * first system still disposes what the library handed it, and a cache
     * holding a disposed material would take every later effect with it.
     */
    private _adoptSharedMaterial(key: string): void {
        const holder = this.object as Object3D & { material?: Material | Material[] };
        const own = holder.material;
        // Array materials (multi-group geometry) never occur here; the library
        // builds exactly one ShaderMaterial per system.
        if (!own || Array.isArray(own)) return;

        let shared = sharedMaterials.get(key);
        if (!shared) {
            shared = cloneRecipeMaterial(own);
            // disposeMesh() leaves cache-owned materials alone; only
            // clearParticleMaterialCache() frees these.
            shared.userData.cached = true;
            sharedMaterials.set(key, shared);
        }
        if (!particleMaterialsInterchangeable(shared, own)) return;

        holder.material = shared;
        this.ownMaterial = own;
    }

    /** Resumes emission after stop() (old ps.start() restart semantics). */
    public start(): void {
        if (this.disposed) return;
        this.handle.resumeEmitter();
    }

    /** Stops emission; live particles finish their lifetimes. Safe after dispose(). */
    public stop(): void {
        if (this.disposed) return;
        this.handle.pauseEmitter();
    }

    public tick(dtSeconds: number): void {
        if (this.disposed) return;
        if (this.completed) {
            this.dispose();
            return;
        }
        if (this.follow) this.syncFollow();
        this.nowMs += dtSeconds * 1000;
        this.elapsed += dtSeconds;
        // Mutated in place: three-particles destructures the cycle data on entry
        // ({ now, delta, elapsed }) and never retains the object, so one struct per
        // system beats an allocation per live system per frame.
        this._updateArg.now = this.nowMs;
        this._updateArg.delta = dtSeconds;
        this._updateArg.elapsed = this.elapsed;
        this.handle.update(this._updateArg);

        // Checked AFTER the update so the library has already deactivated every
        // particle whose age passed its start lifetime: `lifeMs` is the last
        // burst plus the longest start lifetime, so at this point the free list
        // is provably whole and the effect can be recycled as-is.
        if (this.armed && this.nowMs - this.burstFiredAtMs > this.burst!.lifeMs) {
            this.retire();
            this.onBurstFinished?.(this);
        }
    }

    private syncFollow(): void {
        this.follow!.getWorldPosition(this.object.position);
        if (this.followOffset) this.object.position.add(this.followOffset);
        this.object.updateMatrix();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.armed = false;
        // Hand the instance back the material the library built for it: the
        // library's teardown disposes whatever `instance.material` points at,
        // and that must never be the shared one every other effect draws with.
        if (this.ownMaterial) {
            (this.object as Object3D & { material?: Material }).material = this.ownMaterial;
            this.ownMaterial = null;
        }
        this.host.unregisterParticleSystem(this);
        this.handle.dispose();
        this.onDispose?.();
    }
}
